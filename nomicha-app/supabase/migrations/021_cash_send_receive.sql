-- ส่งเงินสด 2 ขั้น (เจ้าของสั่ง 9 ต.ค. 69) — เหมือนส่งของแต่กลับทาง · รันซ้ำได้ ไม่พัง
--   พนักงานกด "ส่งเงิน" บนเครื่องตัวเอง → ไปขึ้นจอหัวหน้าเป็น "รอรับ" → หัวหน้านับเงินจริงแล้วกด "รับเงินแล้ว" บนเครื่องหัวหน้า
--   ระบบคิดยอดที่ต้องส่งเองที่ฐานข้อมูล (ไม่เชื่อตัวเลขบนจอ) → กดเบิ้ล/กดพร้อมกันกี่ครั้งก็บันทึกได้แค่ครั้งเดียว
--   เงินที่ "หัวหน้าถืออยู่" นับจากจำนวนที่หัวหน้ากดรับจริงเท่านั้น

alter table cash_remittances add column if not exists sent_by uuid references employees(id);
alter table cash_remittances add column if not exists received_amount numeric;
alter table cash_remittances add column if not exists received_at timestamptz;
alter table cash_remittances add column if not exists received_by uuid references employees(id);
alter table cash_remittances drop constraint if exists cash_remittances_received_nonnegative;
alter table cash_remittances add constraint cash_remittances_received_nonnegative check (received_amount is null or received_amount >= 0);

-- รายการเก่าทั้งหมด (บันทึกจากปุ่มแบบเดิม ไม่มี sent_by) ถือว่าหัวหน้ารับแล้วตามจำนวนที่บันทึกไว้
update cash_remittances set received_amount = amount, received_at = created_at
 where received_at is null and sent_by is null;

-- ซ่อมข้อมูล 9 ต.ค. 69
--   บัณฑิต: บันทึกรับ 805 ซ้ำ 2 ครั้งห่างกัน 1 วินาที → ลบรายการที่ 2
delete from cash_remittances where id = '9ecf6432-62ec-4977-8e4c-c60748296160';
--   บ้านหว้า: แอปคิดยอดส่ง 4,514 (พนักงานกรอกเงินสด 8 ต.ค. เกินไป 300) แต่เงินในซองจริง 4,214
update cash_remittances set received_amount = 4214
 where id = '82d1ecc0-ce02-4919-91e6-7fb91d21f781' and received_amount = amount;

-- ยอดเงินสดค้างส่งของสาขา คิดที่ฐานข้อมูล — สูตรเดียวกับ calc.cashPending ในแอป
create or replace function branch_cash_pending(p_branch_id text)
returns table(amount numeric, through_date date, days int)
language sql stable security definer set search_path = public, pg_temp as $$
  with cut as (
    select coalesce(through_record_date, remit_date) d from cash_remittances
     where branch_id = p_branch_id order by created_at desc limit 1
  ), pend as (
    select r.record_date, r.cash, r.float_cash from daily_records r, branches b
     where r.branch_id = p_branch_id and b.id = r.branch_id and r.sent
       and r.record_date >= coalesce(b.cash_tracking_from, date '2000-01-01')
       and (not exists(select 1 from cut) or r.record_date > (select d from cut))
  )
  select coalesce(sum(greatest(0, coalesce(cash,0) - coalesce(float_cash,0))), 0),
         (select max(record_date) from pend),
         (select count(*)::int from pend where coalesce(cash,0) > coalesce(float_cash,0))
    from pend;
$$;
revoke all on function branch_cash_pending(text) from public;
grant execute on function branch_cash_pending(text) to authenticated;

-- ขั้นที่ 1: พนักงาน (หรือเจ้าของ) กดส่งเงิน — จำนวนเงินคิดใหม่ที่ฐานข้อมูลทุกครั้ง
create or replace function send_branch_cash(p_branch_id text, p_method text default 'cash')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text := coalesce(auth_role()::text, ''); p record; new_id uuid;
begin
  if not (v_role = 'owner' or (v_role = 'staff' and p_branch_id = auth_branch())) then
    raise exception 'ไม่มีสิทธิ์ส่งเงินของสาขานี้'; end if;
  if p_method not in ('cash', 'transfer') then raise exception 'วิธีส่งเงินไม่ถูกต้อง'; end if;
  perform 1 from branches where id = p_branch_id for update;   -- กดพร้อมกันหลายเครื่อง → ต่อคิวทีละครั้ง
  select * into p from branch_cash_pending(p_branch_id);
  if coalesce(p.amount, 0) <= 0 then raise exception 'ส่งเงินไปแล้ว ไม่มียอดค้างส่ง'; end if;
  insert into cash_remittances(branch_id, remit_date, amount, method, through_record_date, sent_by,
      received_amount, received_at, received_by)
    values (p_branch_id, business_today(), p.amount, p_method::remit_method, p.through_date, auth.uid(),
      -- โอนเงินเข้าบัญชีโดยตรง ไม่ผ่านมือหัวหน้า จึงไม่ต้องรอหัวหน้ารับ
      case when p_method = 'transfer' then p.amount end,
      case when p_method = 'transfer' then now() end,
      case when p_method = 'transfer' then auth.uid() end)
    returning id into new_id;
  return jsonb_build_object('id', new_id, 'amount', p.amount, 'through_date', p.through_date);
end $$;
revoke all on function send_branch_cash(text, text) from public;
grant execute on function send_branch_cash(text, text) to authenticated;

-- ขั้นที่ 2: หัวหน้า (หรือเจ้าของ) นับเงินแล้วกดรับ — รับได้รายการละครั้งเท่านั้น
create or replace function receive_branch_cash(p_remit_id uuid, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r cash_remittances%rowtype;
begin
  if coalesce(auth_role()::text, '') not in ('relief', 'owner') then raise exception 'ไม่มีสิทธิ์รับเงิน'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'จำนวนเงินที่รับต้องตั้งแต่ 0'; end if;
  select * into r from cash_remittances where id = p_remit_id for update;
  if not found then raise exception 'ไม่พบรายการส่งเงิน'; end if;
  if r.received_at is not null then raise exception 'รายการนี้รับเงินไปแล้ว'; end if;
  update cash_remittances set received_amount = p_amount, received_at = now(), received_by = auth.uid() where id = p_remit_id;
  return jsonb_build_object('received', p_amount, 'sent', r.amount);
end $$;
revoke all on function receive_branch_cash(uuid, numeric) from public;
grant execute on function receive_branch_cash(uuid, numeric) to authenticated;

-- ปิดทางบันทึกตรงลงตาราง: ส่ง/รับต้องผ่าน 2 ฟังก์ชันข้างบนเท่านั้น (เจ้าของยังเพิ่มเองได้เผื่อแก้ข้อมูล)
drop policy if exists cash_insert on cash_remittances;
create policy cash_insert on cash_remittances for insert to authenticated with check (auth_role() = 'owner');
drop policy if exists cash_owner_update on cash_remittances;
create policy cash_owner_update on cash_remittances for update to authenticated using (auth_role() = 'owner') with check (auth_role() = 'owner');
