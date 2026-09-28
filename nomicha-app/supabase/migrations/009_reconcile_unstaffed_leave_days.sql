-- วันหยุดส่วนตัวที่ไม่มีคนมาแทน: ใช้ clock-in จริงเป็นหลักฐานว่ามีคนทำงาน
-- ถ้าวันหยุดผ่านไปแล้วและไม่มี clock_records ของสาขา ระบบจะเปลี่ยนวันนั้นเป็น store_closed
-- แล้ว carry forward แก้วคงเหลือ / stock / เงินทอนจากวันก่อนหน้า
-- ยอดขาย เงินโอน Grab รายได้เพิ่ม และรายจ่ายทั้งหมดเป็น 0
--
-- ฟังก์ชันนี้ idempotent: รันซ้ำได้ และไม่แตะวันที่มี clock-in จริง
-- สำคัญ: ถ้ามี daily_records ของวันนั้นอยู่แล้ว ให้ถือว่าเป็นข้อมูลจริง/ข้อมูลที่เจ้าของยืนยัน
-- ห้ามระบบอัตโนมัติทับ record เดิมเป็นปิดร้าน เพราะเจ้าของอาจกรอกยอดย้อนหลังแทนพนักงาน

create or replace function public.owner_reconcile_unstaffed_leave_days()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  offrow record;
  prevrow daily_records%rowtype;
  currow daily_records%rowtype;
  cup_prices jsonb;
  grab_pct numeric;
  changed_count int := 0;
  changed_dates jsonb := '[]'::jsonb;
begin
  -- ตอนเรียกผ่านแอป ต้องเป็น owner เท่านั้น
  -- ตอน migration เรียกเอง auth.uid() จะเป็น null จึงยอมให้ผ่านเพื่อซ่อมข้อมูลเก่าในครั้งแรก
  if auth.uid() is not null and auth_role() is distinct from 'owner'::user_role then
    raise exception 'เจ้าของเท่านั้นที่ปรับวันหยุดไม่มีคนแทนได้';
  end if;

  select value into cup_prices from settings where key = 'cup_price';
  select value::text::numeric into grab_pct from settings where key = 'grab_commission_pct';

  for offrow in
    select d.id, d.branch_id, d.off_date
    from day_offs d
    where d.off_date < business_today()
    order by d.off_date, d.branch_id
  loop
    -- มี clock-in จริง = มีคนมาทำงาน/มาทำแทน ห้ามเปลี่ยนเป็นวันปิดร้าน
    if exists (
      select 1 from clock_records c
      where c.branch_id = offrow.branch_id
        and c.clock_date = offrow.off_date
    ) then
      continue;
    end if;

    -- ต้องมียอดก่อนหน้าเพื่อ carry forward
    select * into prevrow
    from daily_records d
    where d.branch_id = offrow.branch_id
      and d.record_date < offrow.off_date
      and d.sent
    order by d.record_date desc
    limit 1;

    if not found then
      continue;
    end if;

    select * into currow
    from daily_records d
    where d.branch_id = offrow.branch_id
      and d.record_date = offrow.off_date
    for update;

    if found then
      -- มี record อยู่แล้ว = มีข้อมูลที่ถูกบันทึก/ยืนยันไว้ ห้าม reconcile อัตโนมัติทับ
      -- แม้ไม่มี clock-in เพราะเจ้าของอาจกรอกยอดย้อนหลังแทนพนักงานที่ลืมส่งยอด
      -- วันปิดร้านที่ถูกสร้างไว้ก่อนแล้วก็ไม่ต้องทำอะไรซ้ำ
      continue;
    else
      insert into daily_records(
        branch_id, record_date, staff_name,
        open_yen, open_pan, yen, yen_add, pan, pan_add,
        cup_own, topping, other, ice, water, etc,
        cash, transfer, grab, thaichaithai, float_cash, stock_snapshot,
        cup_price_yen, cup_price_pan, grab_commission_pct,
        sent, closed, store_closed, closure_reason, leave_quota_days, created_by
      ) values (
        offrow.branch_id, offrow.off_date, 'ปิดร้าน',
        prevrow.yen, prevrow.pan, prevrow.yen, 0, prevrow.pan, 0,
        0, 0, 0, 0, 0, 0,
        prevrow.float_cash, 0, 0, 0, prevrow.float_cash, prevrow.stock_snapshot,
        coalesce((cup_prices->>'yen')::numeric, 25),
        coalesce((cup_prices->>'pan')::numeric, 35),
        coalesce(grab_pct, 0.321),
        true, true, true, 'approved_leave', 1, auth.uid()
      );
    end if;

    changed_count := changed_count + 1;
    changed_dates := changed_dates || jsonb_build_array(
      jsonb_build_object('branch_id', offrow.branch_id, 'record_date', offrow.off_date)
    );
  end loop;

  return jsonb_build_object('changed', changed_count, 'dates', changed_dates);
end;
$$;

revoke all on function public.owner_reconcile_unstaffed_leave_days() from public;
grant execute on function public.owner_reconcile_unstaffed_leave_days() to authenticated;

-- ตรวจและเติมเฉพาะวันหยุดที่ยังไม่มี daily_records เมื่อ migration นี้ถูกนำไปใช้
-- ไม่แก้ ไม่ลบ และไม่ทับ daily_records ที่มีอยู่แล้ว
select public.owner_reconcile_unstaffed_leave_days();
