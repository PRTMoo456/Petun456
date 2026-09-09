-- ลดความซับซ้อนของระบบ, ถอนเงินกู้/เงินเบิกล่วงหน้า, ล็อกราคาเก่า
-- และทำรายการสต๊อกที่เกี่ยวกันให้สำเร็จหรือยกเลิกพร้อมกันทั้งชุด

-- 1) ถอนระบบเงินกู้/เงินเบิกล่วงหน้าออกทั้งหมด
drop table if exists remit_loan_offsets cascade;
drop table if exists advances cascade;

delete from settings where key in ('advance_cap','loan_cap','loan_interest_pct','advance_day','settle_days');
delete from cash_remittances where method::text = 'loan';
delete from head_remittances where method::text = 'loan';

alter table cash_remittances alter column method drop default;
alter table head_remittances alter column method drop default;
alter table cash_remittances alter column method type text using method::text;
alter table head_remittances alter column method type text using method::text;
drop type if exists remit_method;
create type remit_method as enum ('cash', 'transfer');
alter table cash_remittances alter column method type remit_method using method::remit_method;
alter table head_remittances alter column method type remit_method using method::remit_method;
alter table cash_remittances alter column method set default 'cash'::remit_method;
alter table head_remittances alter column method set default 'cash'::remit_method;
drop type if exists advance_type;
drop type if exists advance_source;

-- ตัดยอดเงินสดค้างแบบสะอาด ณ วันที่ลง migration เพื่อไม่ให้รายการเก่าที่เคยผูกเงินกู้กลับมาค้างใหม่
alter table branches add column if not exists cash_tracking_from date;
update branches set cash_tracking_from = (now() at time zone 'Asia/Bangkok')::date where cash_tracking_from is null;
alter table branches alter column cash_tracking_from set default (now() at time zone 'Asia/Bangkok')::date;
alter table branches alter column cash_tracking_from set not null;

-- 2) เก็บราคาที่ใช้จริงในแต่ละรายการอัตโนมัติ ราคาใหม่ไม่ย้อนแก้รายการเก่า
alter table daily_records
  add column if not exists open_yen int,
  add column if not exists open_pan int,
  add column if not exists cup_price_yen numeric,
  add column if not exists cup_price_pan numeric,
  add column if not exists grab_commission_pct numeric,
  add column if not exists updated_at timestamptz not null default now();

update daily_records d set
  open_yen = coalesce(d.open_yen, c.open_yen, d.yen),
  open_pan = coalesce(d.open_pan, c.open_pan, d.pan)
from clock_records c
where c.branch_id = d.branch_id and c.clock_date = d.record_date
  and (d.open_yen is null or d.open_pan is null);
update daily_records set open_yen = yen where open_yen is null;
update daily_records set open_pan = pan where open_pan is null;
update daily_records set
  cup_price_yen = coalesce(cup_price_yen, (select (value->>'yen')::numeric from settings where key='cup_price'), 25),
  cup_price_pan = coalesce(cup_price_pan, (select (value->>'pan')::numeric from settings where key='cup_price'), 35),
  grab_commission_pct = coalesce(grab_commission_pct, (select value::text::numeric from settings where key='grab_commission_pct'), 0.321);
alter table daily_records alter column cup_price_yen set not null;
alter table daily_records alter column cup_price_pan set not null;
alter table daily_records alter column grab_commission_pct set not null;

alter table deliveries
  add column if not exists price_snapshot jsonb not null default '{}',
  add column if not exists cost_snapshot jsonb not null default '{}';

update deliveries d set
  price_snapshot = coalesce((select jsonb_object_agg(e.key, si.branch_price)
    from jsonb_each_text(d.items) e join stock_items si on si.id = e.key::int), '{}'),
  cost_snapshot = coalesce((select jsonb_object_agg(e.key, coalesce(ws.avg_cost,0))
    from jsonb_each_text(d.items) e join stock_items si on si.id = e.key::int
    left join warehouse_stock ws on ws.item_id = si.id), '{}')
where d.price_snapshot = '{}' or d.cost_snapshot = '{}';

update external_sales x set items = coalesce((
  select jsonb_agg(e.obj || jsonb_build_object('cost', coalesce(ws.avg_cost,0)))
  from jsonb_array_elements(x.items) e(obj)
  left join warehouse_stock ws on ws.item_id = (e.obj->>'item_id')::int
), '[]')
where exists (select 1 from jsonb_array_elements(x.items) e(obj) where not (e.obj ? 'cost'));

alter table cash_remittances
  add column if not exists through_record_date date,
  add column if not exists created_at timestamptz not null default now();
update cash_remittances set through_record_date = remit_date where through_record_date is null;
alter table head_remittances add column if not exists created_at timestamptz not null default now();

-- 3) ประวัติการแก้/ยกเลิกที่ตรวจย้อนหลังได้
alter table record_edit_history add column if not exists reason text;
-- ประวัติต้องอยู่ต่อแม้เจ้าของยกเลิกรายการปิดร้าน
alter table record_edit_history drop constraint if exists record_edit_history_record_id_fkey;
create table if not exists record_deletion_history (
  id uuid primary key default gen_random_uuid(), record_id uuid not null,
  branch_id text not null, record_date date not null, snapshot jsonb not null,
  reason text not null, deleted_by uuid references employees(id), deleted_at timestamptz not null default now()
);
create table if not exists day_off_history (
  id uuid primary key default gen_random_uuid(), day_off_id uuid not null,
  branch_id text not null, old_date date not null, new_date date,
  action text not null check (action in ('changed','cancelled')),
  changed_by uuid references employees(id), changed_at timestamptz not null default now()
);

-- 4) ค่าที่ผู้ใช้กรอกติดลบไม่ได้ (NOT VALID ไม่ขวางข้อมูลเก่าที่อาจต้องตรวจภายหลัง แต่คุมรายการใหม่ทันที)
alter table branches drop constraint if exists branches_nonnegative;
alter table employees drop constraint if exists employees_nonnegative;
alter table branch_rent_history drop constraint if exists branch_rent_nonnegative;
alter table warehouse_rent_history drop constraint if exists warehouse_rent_nonnegative;
alter table stock_items drop constraint if exists stock_items_nonnegative;
alter table stock_par_levels drop constraint if exists stock_par_nonnegative;
alter table warehouse_stock drop constraint if exists warehouse_stock_nonnegative;
alter table purchases drop constraint if exists purchases_positive;
alter table daily_records drop constraint if exists daily_values_nonnegative;
alter table cash_remittances drop constraint if exists cash_remittances_nonnegative;
alter table head_remittances drop constraint if exists head_remittances_nonnegative;
alter table repairs drop constraint if exists repairs_nonnegative;
alter table branches add constraint branches_nonnegative check
  (float_cash >= 0 and days_off_quota >= 0 and holiday_work_days >= 0 and gps_radius >= 0 and late_grace_min >= 0) not valid;
alter table employees add constraint employees_nonnegative check
  (base_salary >= 0 and days_off_quota >= 0 and coalesce(delivery_pay,0) >= 0) not valid;
alter table branch_rent_history add constraint branch_rent_nonnegative check (rent >= 0) not valid;
alter table warehouse_rent_history add constraint warehouse_rent_nonnegative check (rent >= 0) not valid;
alter table stock_items add constraint stock_items_nonnegative check
  (min_qty >= 0 and per_case > 0 and branch_price >= 0) not valid;
alter table stock_par_levels add constraint stock_par_nonnegative check (par_qty >= 0) not valid;
alter table warehouse_stock add constraint warehouse_stock_nonnegative check
  (case_qty >= 0 and loose_qty >= 0 and avg_cost >= 0) not valid;
alter table purchases add constraint purchases_positive check
  (case_qty > 0 and total_price > 0 and cost_per_unit >= 0) not valid;
alter table daily_records add constraint daily_values_nonnegative check
  (open_yen >= 0 and open_pan >= 0 and yen >= 0 and yen_add >= 0 and pan >= 0 and pan_add >= 0
   and cup_own >= 0 and topping >= 0 and other >= 0 and ice >= 0 and water >= 0 and etc >= 0
   and cash >= 0 and transfer >= 0 and grab >= 0 and thaichaithai >= 0 and float_cash >= 0
   and cup_price_yen >= 0 and cup_price_pan >= 0 and grab_commission_pct between 0 and 1) not valid;
alter table cash_remittances add constraint cash_remittances_nonnegative check (amount >= 0) not valid;
alter table head_remittances add constraint head_remittances_nonnegative check (amount >= 0) not valid;
alter table repairs add constraint repairs_nonnegative check (cost >= 0) not valid;

create index if not exists daily_records_branch_date_idx on daily_records(branch_id, record_date desc);
create index if not exists clock_records_branch_date_idx on clock_records(branch_id, clock_date desc);
create index if not exists deliveries_branch_date_idx on deliveries(branch_id, delivery_date desc);
create index if not exists purchases_date_idx on purchases(purchase_date desc);
create index if not exists cash_remittances_branch_date_idx on cash_remittances(branch_id, remit_date desc);
create index if not exists day_offs_branch_date_idx on day_offs(branch_id, off_date);

create or replace function business_today() returns date language sql stable
set search_path = public, pg_temp as $$ select (now() at time zone 'Asia/Bangkok')::date $$;
revoke all on function business_today() from public;
grant execute on function business_today() to authenticated;
revoke all on function relief_name() from public;
grant execute on function relief_name() to authenticated;

-- ปิดร้านจากฐานข้อมูลโดยตรง เพื่อคัดลอกยอดเดิมและตรวจสิทธิ์หัวหน้าในจุดเดียว
create or replace function record_store_closure(p_branch_id text,p_record_date date,p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r user_role; prev daily_records%rowtype; quota_value int; cup_prices jsonb; grab_pct numeric; new_id uuid;
begin
  select role into r from employees where id=auth.uid() and active;
  if p_record_date is null or p_record_date>business_today() then raise exception 'เลือกปิดร้านได้ถึงวันนี้เท่านั้น'; end if;
  if r='relief' then
    if p_record_date<>business_today() or not exists(select 1 from day_offs where branch_id=p_branch_id and off_date=p_record_date) then
      raise exception 'หัวหน้าปิดได้เฉพาะวันนี้และเฉพาะสาขาที่ต้องไปแทน';
    end if;
  elsif r is distinct from 'owner'::user_role then raise exception 'ไม่มีสิทธิ์ปิดร้าน'; end if;
  if not exists(select 1 from branches where id=p_branch_id and active) then raise exception 'ไม่พบสาขา'; end if;
  if exists(select 1 from daily_records where branch_id=p_branch_id and record_date=p_record_date) then
    raise exception 'วันนี้มีรายการปิดยอดอยู่แล้ว';
  end if;
  quota_value:=case p_reason when 'approved_leave' then 1 when 'absent' then 2 when 'owner_or_necessary' then 0 else null end;
  if quota_value is null then raise exception 'สาเหตุปิดร้านไม่ถูกต้อง'; end if;
  select * into prev from daily_records where branch_id=p_branch_id and record_date<p_record_date order by record_date desc limit 1;
  if not found then raise exception 'ยังไม่พบยอดปิดก่อนหน้านี้ จึงคัดลอกยอดแก้วและเงินทอนไม่ได้'; end if;
  select value into cup_prices from settings where key='cup_price';
  select value::text::numeric into grab_pct from settings where key='grab_commission_pct';
  insert into daily_records(branch_id,record_date,staff_name,open_yen,open_pan,yen,yen_add,pan,pan_add,
    cup_own,topping,other,ice,water,etc,cash,transfer,grab,thaichaithai,float_cash,stock_snapshot,
    cup_price_yen,cup_price_pan,grab_commission_pct,sent,closed,store_closed,closure_reason,leave_quota_days,created_by)
  values(p_branch_id,p_record_date,'ปิดร้าน',prev.yen,prev.pan,prev.yen,0,prev.pan,0,
    0,0,0,0,0,0,prev.float_cash,0,0,0,prev.float_cash,prev.stock_snapshot,
    coalesce((cup_prices->>'yen')::numeric,25),coalesce((cup_prices->>'pan')::numeric,35),coalesce(grab_pct,0.321),
    true,true,true,p_reason,quota_value,auth.uid()) returning id into new_id;
  return jsonb_build_object('id',new_id,'quota',quota_value);
exception when unique_violation then raise exception 'วันนี้มีรายการปิดยอดอยู่แล้ว';
end $$;

-- 5) แก้ยอดรายวัน: พนักงานแก้ได้เฉพาะรายการปกติของสาขาตัวเองในวันเดียวกัน เจ้าของแก้ย้อนหลังได้
create or replace function update_daily_record(p_record_id uuid, p_values jsonb, p_reason text default 'แก้ไขยอด')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  oldrow daily_records%rowtype; r user_role; b text; newrow daily_records%rowtype;
begin
  select * into oldrow from daily_records where id=p_record_id for update;
  if not found then raise exception 'ไม่พบรายการยอด'; end if;
  select role, branch_id into r, b from employees where id=auth.uid() and active;
  if r is null then raise exception 'ไม่มีสิทธิ์ใช้งาน'; end if;
  if oldrow.store_closed then raise exception 'รายการปิดร้านต้องแก้จากปุ่มจัดการปิดร้าน'; end if;
  if r='staff' and (oldrow.branch_id<>b or oldrow.record_date<>business_today() or oldrow.created_by is distinct from auth.uid()) then
    raise exception 'พนักงานแก้ได้เฉพาะยอดของวันนี้ที่ตนเองบันทึก';
  elsif r='relief' and (oldrow.record_date<>business_today() or oldrow.created_by is distinct from auth.uid()) then
    raise exception 'หัวหน้าแก้ได้เฉพาะยอดของวันนี้ที่ตนเองบันทึก';
  elsif r not in ('staff','relief','owner') then raise exception 'ไม่มีสิทธิ์แก้ยอด'; end if;

  update daily_records set
    staff_name=case when r='owner' then coalesce(nullif(trim(p_values->>'staff_name'),''),staff_name) else staff_name end,
    open_yen=coalesce((p_values->>'open_yen')::int,open_yen), open_pan=coalesce((p_values->>'open_pan')::int,open_pan),
    yen=coalesce((p_values->>'yen')::int,yen), yen_add=coalesce((p_values->>'yen_add')::int,yen_add),
    pan=coalesce((p_values->>'pan')::int,pan), pan_add=coalesce((p_values->>'pan_add')::int,pan_add),
    cup_own=coalesce((p_values->>'cup_own')::numeric,cup_own), topping=coalesce((p_values->>'topping')::numeric,topping),
    other=coalesce((p_values->>'other')::numeric,other), ice=coalesce((p_values->>'ice')::numeric,ice),
    water=coalesce((p_values->>'water')::numeric,water), etc=coalesce((p_values->>'etc')::numeric,etc),
    cash=coalesce((p_values->>'cash')::numeric,cash), transfer=coalesce((p_values->>'transfer')::numeric,transfer),
    grab=coalesce((p_values->>'grab')::numeric,grab), thaichaithai=coalesce((p_values->>'thaichaithai')::numeric,thaichaithai),
    float_cash=coalesce((p_values->>'float_cash')::numeric,float_cash),
    stock_snapshot=coalesce(p_values->'stock_snapshot',stock_snapshot), updated_at=now()
  where id=p_record_id returning * into newrow;

  if newrow.yen > newrow.open_yen + newrow.yen_add or newrow.pan > newrow.open_pan + newrow.pan_add then
    raise exception 'ยอดแก้วคงเหลือมากกว่ายอดที่มี';
  end if;
  insert into record_edit_history(record_id,field,from_value,to_value,label,reason,edited_by)
    values(p_record_id,'multiple',to_jsonb(oldrow)::text,to_jsonb(newrow)::text,
      coalesce(nullif(trim(p_reason),''),'แก้ไขยอด'),coalesce(nullif(trim(p_reason),''),'แก้ไขยอด'),auth.uid());
  update clock_records set open_yen=newrow.open_yen,open_pan=newrow.open_pan,
    staff_name=case when r='owner' then newrow.staff_name else staff_name end
    where branch_id=newrow.branch_id and clock_date=newrow.record_date;
  return jsonb_build_object('id',newrow.id,'updated_at',newrow.updated_at);
end $$;

create or replace function owner_update_closure(p_record_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare oldrow daily_records%rowtype; q int;
begin
  if auth_role() is distinct from 'owner'::user_role then raise exception 'เจ้าของเท่านั้นที่แก้สาเหตุปิดร้านได้'; end if;
  select * into oldrow from daily_records where id=p_record_id and store_closed for update;
  if not found then raise exception 'ไม่พบรายการปิดร้าน'; end if;
  q := case p_reason when 'approved_leave' then 1 when 'absent' then 2 when 'owner_or_necessary' then 0 else null end;
  if q is null then raise exception 'สาเหตุปิดร้านไม่ถูกต้อง'; end if;
  update daily_records set closure_reason=p_reason,leave_quota_days=q,updated_at=now() where id=p_record_id;
  insert into record_edit_history(record_id,field,from_value,to_value,label,reason,edited_by)
    values(p_record_id,'closure_reason',oldrow.closure_reason,p_reason,'แก้สาเหตุปิดร้าน','แก้สาเหตุปิดร้าน',auth.uid());
  return jsonb_build_object('quota',q);
end $$;

create or replace function owner_cancel_closure(p_record_id uuid, p_reason text default 'ยกเลิกสถานะปิดร้าน')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare oldrow daily_records%rowtype;
begin
  if auth_role() is distinct from 'owner'::user_role then raise exception 'เจ้าของเท่านั้นที่ยกเลิกปิดร้านได้'; end if;
  select * into oldrow from daily_records where id=p_record_id and store_closed for update;
  if not found then raise exception 'ไม่พบรายการปิดร้าน'; end if;
  insert into record_deletion_history(record_id,branch_id,record_date,snapshot,reason,deleted_by)
    values(oldrow.id,oldrow.branch_id,oldrow.record_date,to_jsonb(oldrow),coalesce(nullif(trim(p_reason),''),'ยกเลิกสถานะปิดร้าน'),auth.uid());
  update recount_requests set prev_record_id=null where prev_record_id=p_record_id;
  delete from daily_records where id=p_record_id;
  return jsonb_build_object('cancelled',true);
end $$;

create or replace function owner_update_day_off(p_day_off_id uuid, p_new_date date default null, p_cancel boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare oldrow day_offs%rowtype;
begin
  if auth_role() is distinct from 'owner'::user_role then raise exception 'เจ้าของเท่านั้นที่แก้วันหยุดได้'; end if;
  select * into oldrow from day_offs where id=p_day_off_id for update;
  if not found then raise exception 'ไม่พบวันหยุด'; end if;
  if p_cancel then
    insert into day_off_history(day_off_id,branch_id,old_date,new_date,action,changed_by)
      values(oldrow.id,oldrow.branch_id,oldrow.off_date,null,'cancelled',auth.uid());
    delete from day_offs where id=p_day_off_id;
  else
    if p_new_date is null then raise exception 'กรุณาเลือกวันใหม่'; end if;
    if exists(select 1 from delivery_rounds where day_of_week=extract(dow from p_new_date)::int) then
      raise exception 'วันส่งของห้ามจองหยุด';
    end if;
    if exists(select 1 from relief_day_offs where off_date=p_new_date) then raise exception 'หัวหน้าหยุดวันนั้น ไม่มีคนมาแทน'; end if;
    insert into day_off_history(day_off_id,branch_id,old_date,new_date,action,changed_by)
      values(oldrow.id,oldrow.branch_id,oldrow.off_date,p_new_date,'changed',auth.uid());
    update day_offs set off_date=p_new_date where id=p_day_off_id;
  end if;
  return jsonb_build_object('cancelled',p_cancel,'date',p_new_date);
exception when unique_violation then raise exception 'วันที่เลือกมีสาขาอื่นจองแล้ว';
end $$;

create or replace function owner_resolve_recount(p_request_id uuid,p_approve boolean,p_stock_snapshot jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare req recount_requests%rowtype; oldrow daily_records%rowtype;
begin
  if auth_role() is distinct from 'owner'::user_role then raise exception 'เจ้าของเท่านั้นที่ตรวจยอดแก้วได้'; end if;
  select * into req from recount_requests where id=p_request_id and status='pending' for update;
  if not found then raise exception 'ไม่พบคำขอที่รอตรวจ'; end if;
  if p_approve and req.prev_record_id is not null then
    select * into oldrow from daily_records where id=req.prev_record_id for update;
    if found then
      update daily_records set yen=req.new_yen,pan=req.new_pan,
        stock_snapshot=coalesce(p_stock_snapshot,stock_snapshot),updated_at=now() where id=oldrow.id;
      insert into record_edit_history(record_id,field,from_value,to_value,label,reason,edited_by)
        values(oldrow.id,'cup_recount',jsonb_build_object('yen',oldrow.yen,'pan',oldrow.pan)::text,
          jsonb_build_object('yen',req.new_yen,'pan',req.new_pan)::text,'อนุมัติยอดนับแก้วใหม่','คำขอตรวจสอบยอดแก้ว',auth.uid());
    end if;
  elsif not p_approve then
    update clock_records set open_yen=req.old_yen,open_pan=req.old_pan
      where branch_id=req.branch_id and clock_date=req.request_date and open_yen=req.new_yen and open_pan=req.new_pan;
  end if;
  update recount_requests set status=case when p_approve then 'approved'::recount_status else 'rejected'::recount_status end,
    resolved_at=now() where id=req.id;
  return jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end);
end $$;

-- 6) ซื้อเข้า/ส่งสาขา/ขายนอก ตัดสต๊อกและบันทึกราคาใน transaction เดียว
create or replace function record_warehouse_purchase(p_item_id int,p_case_qty int,p_total_price numeric,p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare it stock_items%rowtype; ws warehouse_stock%rowtype; old_units numeric; add_units numeric; new_avg numeric;
begin
  if coalesce(auth_role()::text,'') not in ('relief','owner') then raise exception 'ไม่มีสิทธิ์บันทึกบิลซื้อ'; end if;
  if p_case_qty<=0 or p_total_price<=0 then raise exception 'จำนวนลังและราคารวมต้องมากกว่า 0'; end if;
  select * into it from stock_items where id=p_item_id and active for update;
  if not found then raise exception 'ไม่พบสินค้า'; end if;
  insert into warehouse_stock(item_id,case_qty,loose_qty,avg_cost) values(p_item_id,0,0,0) on conflict do nothing;
  select * into ws from warehouse_stock where item_id=p_item_id for update;
  old_units := ws.case_qty*it.per_case+ws.loose_qty; add_units := p_case_qty*it.per_case;
  new_avg := (old_units*ws.avg_cost+p_total_price)/(old_units+add_units);
  update warehouse_stock set case_qty=case_qty+p_case_qty,avg_cost=new_avg,last_checked=business_today() where item_id=p_item_id;
  insert into purchases(item_id,purchase_date,case_qty,total_price,cost_per_unit,note,created_by)
    values(p_item_id,business_today(),p_case_qty,p_total_price,p_total_price/add_units,p_note,auth.uid());
  return jsonb_build_object('avg_cost',new_avg,'added_units',add_units);
end $$;

-- บันทึกยอดนับทั้งชุดใน transaction เดียว และไม่เปิดให้หน้าจอแก้ต้นทุนเฉลี่ยโดยตรง
create or replace function record_warehouse_count(p_counts jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare e jsonb; item_id_value int; case_value int; loose_value int; changed int=0;
begin
  if coalesce(auth_role()::text,'') not in ('relief','owner') then raise exception 'ไม่มีสิทธิ์บันทึกยอดนับคลัง'; end if;
  if jsonb_typeof(coalesce(p_counts,'[]'))<>'array' then raise exception 'รูปแบบยอดนับไม่ถูกต้อง'; end if;
  for e in select value from jsonb_array_elements(coalesce(p_counts,'[]')) loop
    item_id_value:=(e->>'item_id')::int; case_value:=(e->>'case_qty')::int; loose_value:=(e->>'loose_qty')::int;
    if case_value<0 or loose_value<0 then raise exception 'จำนวนสต๊อกติดลบไม่ได้'; end if;
    if not exists(select 1 from stock_items where id=item_id_value and active) then raise exception 'ไม่พบสินค้า %',item_id_value; end if;
    insert into warehouse_stock(item_id,case_qty,loose_qty,avg_cost,last_checked)
      values(item_id_value,case_value,loose_value,0,business_today())
    on conflict(item_id) do update set case_qty=excluded.case_qty,loose_qty=excluded.loose_qty,last_checked=excluded.last_checked;
    changed:=changed+1;
  end loop;
  return jsonb_build_object('updated',changed);
end $$;

create or replace function confirm_delivery(p_delivery_date date,p_branch_id text,p_round_id text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare oldrow deliveries%rowtype; e record; it stock_items%rowtype; ws warehouse_stock%rowtype;
  total_units int; q numeric; prices jsonb='{}'; costs jsonb='{}';
begin
  if coalesce(auth_role()::text,'') not in ('relief','owner') then raise exception 'ไม่มีสิทธิ์ยืนยันส่งของ'; end if;
  if p_delivery_date is null or not exists(select 1 from branches where id=p_branch_id and active) then raise exception 'สาขาหรือวันที่ไม่ถูกต้อง'; end if;
  select * into oldrow from deliveries where branch_id=p_branch_id and delivery_date=p_delivery_date and round_id is not distinct from p_round_id for update;
  if found then
    for e in select key,value from jsonb_each_text(oldrow.items) loop
      select * into it from stock_items where id=e.key::int; select * into ws from warehouse_stock where item_id=it.id for update;
      total_units := ws.case_qty*it.per_case+ws.loose_qty+e.value::int;
      update warehouse_stock set case_qty=total_units/it.per_case,loose_qty=mod(total_units,it.per_case) where item_id=it.id;
    end loop;
  end if;
  for e in select key,value from jsonb_each_text(coalesce(p_items,'{}')) loop
    q:=e.value::numeric; if q<0 or q<>trunc(q) then raise exception 'จำนวนส่งต้องเป็นจำนวนเต็มตั้งแต่ 0'; end if;
    select * into it from stock_items where id=e.key::int and active; if not found then raise exception 'ไม่พบสินค้า %',e.key; end if;
    select * into ws from warehouse_stock where item_id=it.id for update; if not found then raise exception 'ยังไม่มีสต๊อก %',it.name; end if;
    total_units:=ws.case_qty*it.per_case+ws.loose_qty;
    if total_units<q then raise exception '% มีไม่พอ (เหลือ %)',it.name,total_units; end if;
    total_units:=total_units-q;
    update warehouse_stock set case_qty=total_units/it.per_case,loose_qty=mod(total_units,it.per_case) where item_id=it.id;
    prices:=prices||jsonb_build_object(e.key,coalesce(oldrow.price_snapshot->e.key,to_jsonb(it.branch_price)));
    costs:=costs||jsonb_build_object(e.key,coalesce(oldrow.cost_snapshot->e.key,to_jsonb(ws.avg_cost)));
  end loop;
  insert into deliveries(delivery_date,branch_id,round_id,items,price_snapshot,cost_snapshot,packed_by)
    values(p_delivery_date,p_branch_id,p_round_id,coalesce(p_items,'{}'),prices,costs,auth.uid())
  on conflict(branch_id,delivery_date,round_id) do update set items=excluded.items,price_snapshot=excluded.price_snapshot,
    cost_snapshot=excluded.cost_snapshot,packed_by=excluded.packed_by,received=null,received_at=null;
  return jsonb_build_object('saved',true);
end $$;

create or replace function create_external_sale(p_buyer text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare e jsonb; it stock_items%rowtype; ws warehouse_stock%rowtype; q int; total_units int; lines jsonb='[]'; v_total numeric=0; new_id uuid;
begin
  if coalesce(auth_role()::text,'') not in ('relief','owner') then raise exception 'ไม่มีสิทธิ์ออกบิล'; end if;
  if nullif(trim(p_buyer),'') is null or jsonb_array_length(coalesce(p_items,'[]'))=0 then raise exception 'กรอกผู้ซื้อและสินค้า'; end if;
  for e in select value from jsonb_array_elements(p_items) loop
    q:=(e->>'qty')::int; if q<=0 then raise exception 'จำนวนต้องมากกว่า 0'; end if;
    select * into it from stock_items where id=(e->>'item_id')::int and active; if not found then raise exception 'ไม่พบสินค้า'; end if;
    select * into ws from warehouse_stock where item_id=it.id for update; if not found then raise exception 'ยังไม่มีสต๊อก %',it.name; end if;
    total_units:=ws.case_qty*it.per_case+ws.loose_qty; if total_units<q then raise exception '% มีไม่พอ',it.name; end if;
    total_units:=total_units-q; update warehouse_stock set case_qty=total_units/it.per_case,loose_qty=mod(total_units,it.per_case) where item_id=it.id;
    lines:=lines||jsonb_build_array(jsonb_build_object('item_id',it.id,'qty',q,'price',it.branch_price,'cost',ws.avg_cost));
    v_total:=v_total+q*it.branch_price;
  end loop;
  insert into external_sales(sale_date,buyer,issuer,items,total) values(business_today(),trim(p_buyer),auth.uid(),lines,v_total) returning id into new_id;
  return jsonb_build_object('id',new_id,'total',v_total);
end $$;

create or replace function edit_external_sale(p_sale_id uuid,p_items jsonb,p_editor_name text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare oldrow external_sales%rowtype; e jsonb; olde jsonb; it stock_items%rowtype; ws warehouse_stock%rowtype;
 q int; total_units int; lines jsonb='[]'; v_total numeric=0; price numeric; cost numeric;
begin
  if auth_role() is distinct from 'owner'::user_role then raise exception 'เจ้าของเท่านั้นที่แก้บิลย้อนหลังได้'; end if;
  select * into oldrow from external_sales where id=p_sale_id for update; if not found then raise exception 'ไม่พบบิล'; end if;
  for olde in select value from jsonb_array_elements(oldrow.items) loop
    select * into it from stock_items where id=(olde->>'item_id')::int; select * into ws from warehouse_stock where item_id=it.id for update;
    total_units:=ws.case_qty*it.per_case+ws.loose_qty+(olde->>'qty')::int;
    update warehouse_stock set case_qty=total_units/it.per_case,loose_qty=mod(total_units,it.per_case) where item_id=it.id;
  end loop;
  for e in select value from jsonb_array_elements(coalesce(p_items,'[]')) loop
    q:=(e->>'qty')::int; if q<=0 then raise exception 'จำนวนต้องมากกว่า 0'; end if;
    select * into it from stock_items where id=(e->>'item_id')::int and active; if not found then raise exception 'ไม่พบสินค้า'; end if;
    select * into ws from warehouse_stock where item_id=it.id for update;
    total_units:=ws.case_qty*it.per_case+ws.loose_qty; if total_units<q then raise exception '% มีไม่พอ',it.name; end if;
    select value into olde from jsonb_array_elements(oldrow.items) where (value->>'item_id')::int=it.id limit 1;
    price:=coalesce((olde->>'price')::numeric,it.branch_price); cost:=coalesce((olde->>'cost')::numeric,ws.avg_cost);
    total_units:=total_units-q; update warehouse_stock set case_qty=total_units/it.per_case,loose_qty=mod(total_units,it.per_case) where item_id=it.id;
    lines:=lines||jsonb_build_array(jsonb_build_object('item_id',it.id,'qty',q,'price',price,'cost',cost)); v_total:=v_total+q*price;
  end loop;
  update external_sales set items=lines,total=v_total,edit_log=coalesce(edit_log,'[]')||jsonb_build_array(jsonb_build_object(
    'at',now(),'by',coalesce(p_editor_name,''),'from_total',oldrow.total,'to_total',v_total)) where id=p_sale_id;
  return jsonb_build_object('total',v_total);
end $$;

create or replace function set_external_sale_paid(p_sale_id uuid,p_paid boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare old_paid boolean;
begin
  if auth_role() is distinct from 'owner'::user_role then raise exception 'เจ้าของเท่านั้นที่เปลี่ยนสถานะชำระเงินได้'; end if;
  select paid into old_paid from external_sales where id=p_sale_id for update;
  if not found then raise exception 'ไม่พบบิล'; end if;
  update external_sales set paid=coalesce(p_paid,false),edit_log=coalesce(edit_log,'[]')||jsonb_build_array(jsonb_build_object(
    'at',now(),'by',auth.uid(),'field','paid','from',old_paid,'to',coalesce(p_paid,false))) where id=p_sale_id;
  return jsonb_build_object('paid',coalesce(p_paid,false));
end $$;

revoke all on function record_store_closure(text,date,text) from public;
revoke all on function update_daily_record(uuid,jsonb,text) from public;
revoke all on function owner_update_closure(uuid,text) from public;
revoke all on function owner_cancel_closure(uuid,text) from public;
revoke all on function owner_update_day_off(uuid,date,boolean) from public;
revoke all on function owner_resolve_recount(uuid,boolean,jsonb) from public;
revoke all on function record_warehouse_purchase(int,int,numeric,text) from public;
revoke all on function record_warehouse_count(jsonb) from public;
revoke all on function confirm_delivery(date,text,text,jsonb) from public;
revoke all on function create_external_sale(text,jsonb) from public;
revoke all on function edit_external_sale(uuid,jsonb,text) from public;
revoke all on function set_external_sale_paid(uuid,boolean) from public;
grant execute on function record_store_closure(text,date,text),update_daily_record(uuid,jsonb,text),owner_update_closure(uuid,text),owner_cancel_closure(uuid,text),
  owner_update_day_off(uuid,date,boolean),owner_resolve_recount(uuid,boolean,jsonb),record_warehouse_purchase(int,int,numeric,text),record_warehouse_count(jsonb),confirm_delivery(date,text,text,jsonb),
  create_external_sale(text,jsonb),edit_external_sale(uuid,jsonb,text),set_external_sale_paid(uuid,boolean) to authenticated;

-- 7) เปลี่ยน RLS จาก for all แบบกว้าง เป็นสิทธิ์รายงาน/รายวันแบบชัดเจน และไม่เปิดข้อมูลให้ anonymous
do $$ declare p record; begin
  for p in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename = any(array[
    'daily_records','clock_records','record_edit_history','record_deletion_history','recount_requests','day_offs','day_off_history',
    'relief_day_offs','cash_remittances','head_remittances','deliveries','external_sales','repairs','purchases','warehouse_stock',
    'settings','companies','branches','branch_rent_history','warehouse_rent_history','delivery_rounds','stock_categories','stock_items','stock_par_levels'])
  loop execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename); end loop;
end $$;

alter table record_deletion_history enable row level security;
alter table day_off_history enable row level security;

create policy daily_read on daily_records for select to authenticated using (auth_role() in ('relief','owner') or branch_id=auth_branch());
create policy daily_insert on daily_records for insert to authenticated with check (
  (auth_role()='owner' and record_date<=business_today()) or
  (auth_role()='staff' and branch_id=auth_branch() and record_date=business_today() and created_by=auth.uid() and not store_closed) or
  (auth_role()='relief' and record_date=business_today() and created_by=auth.uid() and not store_closed
    and exists(select 1 from day_offs o where o.branch_id=daily_records.branch_id and o.off_date=daily_records.record_date))
);

create policy clock_read on clock_records for select to authenticated using (auth_role() in ('relief','owner') or branch_id=auth_branch());
create policy clock_insert on clock_records for insert to authenticated with check (
  auth_role()='owner' or (clock_date=business_today() and ((auth_role()='staff' and branch_id=auth_branch()) or
    (auth_role()='relief' and exists(select 1 from day_offs o where o.branch_id=clock_records.branch_id and o.off_date=clock_records.clock_date)))));
create policy clock_update on clock_records for update to authenticated using (
  auth_role()='owner' or (clock_date=business_today() and ((auth_role()='staff' and branch_id=auth_branch()) or
    (auth_role()='relief' and exists(select 1 from day_offs o where o.branch_id=clock_records.branch_id and o.off_date=clock_records.clock_date)))))
  with check (auth_role()='owner' or clock_date=business_today());

create policy history_owner_read on record_edit_history for select to authenticated using (auth_role()='owner' or exists(
  select 1 from daily_records d where d.id=record_id and d.branch_id=auth_branch()));
create policy deletion_owner_read on record_deletion_history for select to authenticated using (auth_role()='owner');
create policy dayoff_history_owner_read on day_off_history for select to authenticated using (auth_role()='owner');

create policy recount_read on recount_requests for select to authenticated using (auth_role() in ('relief','owner') or branch_id=auth_branch());
create policy recount_staff_insert on recount_requests for insert to authenticated with check (
  auth_role()='owner' or (auth_role()='staff' and branch_id=auth_branch() and request_date=business_today()));

create policy dayoff_read on day_offs for select to authenticated using (true);
create policy dayoff_staff_insert on day_offs for insert to authenticated with check (
  auth_role()='owner' or (auth_role()='staff' and branch_id=auth_branch() and off_date>=business_today()));
create policy dayoff_staff_delete on day_offs for delete to authenticated using (
  auth_role()='owner' or (auth_role()='staff' and branch_id=auth_branch() and off_date>=business_today()));
create policy relief_dayoff_read on relief_day_offs for select to authenticated using (true);
create policy relief_dayoff_write on relief_day_offs for insert to authenticated with check (auth_role() in ('relief','owner') and off_date>=business_today());
create policy relief_dayoff_delete on relief_day_offs for delete to authenticated using (auth_role() in ('relief','owner') and off_date>=business_today());

create policy cash_read on cash_remittances for select to authenticated using (auth_role() in ('relief','owner') or branch_id=auth_branch());
create policy cash_insert on cash_remittances for insert to authenticated with check (auth_role() in ('relief','owner') or branch_id=auth_branch());
create policy cash_owner_delete on cash_remittances for delete to authenticated using (auth_role()='owner');
create policy head_cash_read on head_remittances for select to authenticated using (auth_role() in ('relief','owner'));
create policy head_cash_insert on head_remittances for insert to authenticated with check (auth_role() in ('relief','owner'));
create policy head_cash_owner_delete on head_remittances for delete to authenticated using (auth_role()='owner');

create policy delivery_read on deliveries for select to authenticated using (auth_role() in ('relief','owner') or branch_id=auth_branch());
create policy delivery_staff_receive on deliveries for update to authenticated using (auth_role()='staff' and branch_id=auth_branch())
  with check (auth_role()='staff' and branch_id=auth_branch());
create policy external_read on external_sales for select to authenticated using (auth_role() in ('relief','owner'));
create policy repairs_read on repairs for select to authenticated using (auth_role() in ('relief','owner'));
create policy repairs_write on repairs for insert to authenticated with check (auth_role() in ('relief','owner'));
create policy repairs_owner_change on repairs for update to authenticated using (auth_role()='owner') with check (auth_role()='owner');
create policy purchases_read on purchases for select to authenticated using (auth_role() in ('relief','owner'));
create policy warehouse_read on warehouse_stock for select to authenticated using (auth_role() in ('relief','owner'));

create policy settings_read on settings for select to authenticated using (true);
create policy settings_owner_insert on settings for insert to authenticated with check (auth_role()='owner');
create policy settings_owner_update on settings for update to authenticated using (auth_role()='owner') with check (auth_role()='owner');
create policy company_read on companies for select to authenticated using (true);
create policy company_owner_write on companies for all to authenticated using (auth_role()='owner') with check (auth_role()='owner');
create policy branch_read on branches for select to authenticated using (true);
create policy branch_owner_write on branches for all to authenticated using (auth_role()='owner') with check (auth_role()='owner');
create policy branch_rent_read on branch_rent_history for select to authenticated using (true);
create policy branch_rent_owner_write on branch_rent_history for all to authenticated using (auth_role()='owner') with check (auth_role()='owner');
create policy wh_rent_read on warehouse_rent_history for select to authenticated using (true);
create policy wh_rent_owner_write on warehouse_rent_history for all to authenticated using (auth_role()='owner') with check (auth_role()='owner');
create policy rounds_read on delivery_rounds for select to authenticated using (true);
create policy rounds_owner_write on delivery_rounds for all to authenticated using (auth_role()='owner') with check (auth_role()='owner');
create policy categories_read on stock_categories for select to authenticated using (true);
create policy categories_owner_write on stock_categories for all to authenticated using (auth_role()='owner') with check (auth_role()='owner');
create policy items_read on stock_items for select to authenticated using (true);
create policy items_owner_write on stock_items for all to authenticated using (auth_role()='owner') with check (auth_role()='owner');
create policy par_read on stock_par_levels for select to authenticated using (true);
create policy par_owner_write on stock_par_levels for all to authenticated using (auth_role()='owner') with check (auth_role()='owner');

-- พนักงานรับของแก้ได้เฉพาะจำนวนรับและเวลารับ ห้ามเปลี่ยนรายการส่ง/ราคา
create or replace function protect_delivery_update() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare e record;
begin
  if auth_role()='staff' and (new.items<>old.items or new.branch_id<>old.branch_id or new.delivery_date<>old.delivery_date
    or new.round_id is distinct from old.round_id or new.price_snapshot<>old.price_snapshot or new.cost_snapshot<>old.cost_snapshot
    or new.packed_by is distinct from old.packed_by) then raise exception 'พนักงานแก้ได้เฉพาะจำนวนที่รับจริง'; end if;
  if new.received is not null then
    for e in select value from jsonb_each_text(new.received) loop
      if e.value::numeric<0 then raise exception 'จำนวนรับสินค้าติดลบไม่ได้'; end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists protect_delivery_update_trigger on deliveries;
create trigger protect_delivery_update_trigger before update on deliveries for each row execute function protect_delivery_update();

create or replace function validate_daily_record() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare e record; expected_quota int; cup_prices jsonb; grab_pct numeric; caller_role user_role; caller_name text;
begin
  if tg_op='INSERT' then
    select value into cup_prices from settings where key='cup_price';
    select value::text::numeric into grab_pct from settings where key='grab_commission_pct';
    new.cup_price_yen:=coalesce((cup_prices->>'yen')::numeric,25);
    new.cup_price_pan:=coalesce((cup_prices->>'pan')::numeric,35);
    new.grab_commission_pct:=coalesce(grab_pct,0.321);
    caller_role:=auth_role();
    if not new.store_closed and caller_role in ('staff','relief') then
      select name into caller_name from employees where id=auth.uid() and active;
      if caller_name is null then raise exception 'ไม่พบบัญชีพนักงานที่ใช้งานอยู่'; end if;
      new.staff_name:=caller_name; new.created_by:=auth.uid();
    end if;
  end if;
  for e in select value from jsonb_each_text(coalesce(new.stock_snapshot,'{}')) loop
    if e.value::numeric<0 then raise exception 'สต๊อกติดลบไม่ได้'; end if;
  end loop;
  if new.yen>new.open_yen+new.yen_add or new.pan>new.open_pan+new.pan_add then
    raise exception 'ยอดแก้วคงเหลือมากกว่ายอดที่มี';
  end if;
  if new.store_closed then
    expected_quota:=case new.closure_reason when 'approved_leave' then 1 when 'absent' then 2 when 'owner_or_necessary' then 0 else null end;
    if expected_quota is null or new.leave_quota_days<>expected_quota then raise exception 'สาเหตุและโควตาปิดร้านไม่ถูกต้อง'; end if;
    if new.yen<>new.open_yen or new.pan<>new.open_pan or new.yen_add<>0 or new.pan_add<>0
      or new.cup_own<>0 or new.topping<>0 or new.other<>0 or new.ice<>0 or new.water<>0 or new.etc<>0
      or new.cash<>new.float_cash or new.transfer<>0 or new.grab<>0 or new.thaichaithai<>0 then
      raise exception 'วันปิดร้านต้องไม่มียอดขายและต้องคงยอดแก้ว/เงินทอนเดิม';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists validate_daily_record_trigger on daily_records;
create trigger validate_daily_record_trigger before insert or update on daily_records for each row execute function validate_daily_record();
revoke all on function protect_delivery_update() from public;
revoke all on function validate_daily_record() from public;
