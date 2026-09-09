-- ==============================================================
-- นำเข้ารายละเอียดยอดรายวัน 5 สาขา จากไฟล์ "ร้านสาขา.xlsx"
-- ช่วงวันที่ 1-9 ก.ย. 2569 รวม 42 รายการ
--
-- หมายเหตุจากต้นฉบับ:
--   * ตัดวันที่ 30 ส.ค. ออกทั้งหมด
--   * วันที่ 31 ส.ค. เป็นยอดแก้วตั้งต้นของวันที่ 1 ก.ย. ไม่นับยอดขายและไม่สร้าง daily_record
--   * ถือว่าวันที่เปิดขายลงเวลาเข้า-ออกตรงตามเวลาทำงานของสาขา
--     (ถ้ามี clock_record จริงอยู่แล้วจะเก็บของจริงไว้ ไม่เขียนทับ)
--   * ไฟล์ไม่มีสต๊อกวัตถุดิบ จึงยก stock_snapshot ล่าสุดที่มีอยู่ก่อนหน้าไว้ให้
--     ถ้าไม่มีก็เก็บเป็น {}
--   * ราคาที่ใช้ในสูตร Excel คือ แก้วเย็น 25 บาท / แก้วปั่น 35 บาท
--   * สคริปต์นี้รันซ้ำได้ และจะหยุดทั้งชุดหากพบรายการเดิมที่ตัวเลขไม่ตรง
--
-- ต้องรัน migration 006_simplify_harden_and_snapshot.sql ก่อน
-- ==============================================================

begin;

do $$
begin
  if to_regprocedure('public.update_daily_record(uuid,jsonb,text)') is null then
    raise exception 'กรุณารัน migration 006_simplify_harden_and_snapshot.sql ก่อน';
  end if;
end $$;

create temporary table _daily_import_source (
  branch_id text not null,
  record_date date not null,
  staff_name text not null,
  open_yen int not null,
  open_pan int not null,
  yen int not null,
  yen_add int not null,
  pan int not null,
  pan_add int not null,
  cup_own numeric not null,
  topping numeric not null,
  other numeric not null,
  ice numeric not null,
  water numeric not null,
  etc numeric not null,
  cash numeric not null,
  transfer numeric not null,
  grab numeric not null,
  thaichaithai numeric not null,
  float_cash numeric not null,
  store_closed boolean not null,
  closure_reason text,
  leave_quota_days int not null,
  cup_price_yen numeric not null default 25,
  cup_price_pan numeric not null default 35,
  grab_commission_pct numeric not null default 0.321,
  primary key (branch_id, record_date)
) on commit drop;

insert into _daily_import_source (
  branch_id, record_date, staff_name, open_yen, open_pan, yen, yen_add, pan, pan_add,
  cup_own, topping, other, ice, water, etc, cash, transfer, grab, thaichaithai,
  float_cash, store_closed, closure_reason, leave_quota_days
) values
  ('lnd', '2026-09-01', 'ตาล', 393, 84, 344, 0, 78, 0, 0, 5, 0, 80, 0, 0, 1020, 640, 0, 0, 300, false, null, 0),
  ('lnd', '2026-09-02', 'ตาล', 344, 78, 299, 0, 71, 0, 0, 5, 0, 80, 0, 0, 1135, 460, 0, 0, 300, false, null, 0),
  ('lnd', '2026-09-03', 'ตาล', 299, 71, 254, 0, 64, 0, 0, 0, 0, 80, 0, 0, 1070, 520, 0, 0, 300, false, null, 0),
  ('lnd', '2026-09-04', 'ตาล', 254, 64, 354, 150, 85, 25, 0, 0, 0, 80, 60, 0, 1010, 540, 0, 0, 300, false, null, 0),
  ('lnd', '2026-09-05', 'ตาล', 354, 85, 302, 0, 79, 0, 0, 10, 0, 80, 0, 0, 1115, 625, 0, 0, 300, false, null, 0),
  ('lnd', '2026-09-06', 'ตาล', 302, 79, 238, 0, 71, 0, 0, 5, 0, 80, 0, 0, 1175, 935, 0, 0, 300, false, null, 0),
  ('lnd', '2026-09-07', 'ตาล', 238, 71, 407, 200, 81, 25, 0, 5, 0, 80, 0, 0, 685, 840, 0, 0, 300, false, null, 0),
  ('lnd', '2026-09-08', 'ตาล', 407, 81, 368, 0, 72, 0, 0, 5, 0, 80, 0, 0, 755, 730, 0, 0, 300, false, null, 0),

  ('bwa', '2026-09-01', 'บีม', 403, 137, 328, 0, 110, 0, 50, 15, 0, 120, 0, 0, 2255, 810, 0, 0, 300, false, null, 0),
  ('bwa', '2026-09-02', 'บีม', 328, 110, 267, 0, 92, 0, 50, 15, 0, 120, 0, 0, 1785, 615, 0, 0, 300, false, null, 0),
  ('bwa', '2026-09-03', 'บีม', 267, 92, 227, 0, 79, 0, 50, 0, 0, 120, 28, 0, 1462, 195, 0, 0, 300, false, null, 0),
  ('bwa', '2026-09-04', 'บีม', 227, 79, 382, 200, 139, 75, 50, 10, 0, 80, 0, 53, 1562, 315, 0, 0, 300, false, null, 0),
  ('bwa', '2026-09-05', 'บีม', 382, 139, 325, 0, 119, 0, 25, 10, 0, 120, 42, 0, 1568, 730, 0, 0, 300, false, null, 0),
  ('bwa', '2026-09-06', 'บีม', 325, 119, 251, 0, 89, 0, 0, 20, 0, 120, 0, 0, 2390, 710, 0, 0, 300, false, null, 0),
  ('bwa', '2026-09-07', 'บีม', 251, 89, 414, 200, 129, 50, 50, 0, 0, 80, 0, 0, 1205, 340, 0, 0, 300, false, null, 0),
  ('bwa', '2026-09-08', 'บีม', 414, 129, 364, 0, 120, 0, 50, 0, 0, 80, 28, 0, 1572, 240, 0, 0, 300, false, null, 0),
  ('bwa', '2026-09-09', 'บีม', 364, 120, 335, 0, 108, 0, 50, 5, 0, 120, 0, 0, 1205, 175, 0, 0, 300, false, null, 0),

  ('ksk', '2026-09-01', 'เจน', 404, 131, 331, 0, 124, 0, 0, 0, 0, 120, 0, 0, 1655, 495, 0, 0, 200, false, null, 0),
  ('ksk', '2026-09-02', 'เจน', 331, 124, 293, 0, 116, 0, 0, 0, 0, 80, 0, 0, 1160, 190, 0, 0, 200, false, null, 0),
  ('ksk', '2026-09-03', 'เจน', 293, 116, 611, 350, 175, 75, 0, 0, 0, 80, 0, 0, 1225, 255, 0, 0, 200, false, null, 0),
  ('ksk', '2026-09-04', 'เจน', 611, 175, 565, 0, 165, 0, 0, 0, 0, 120, 0, 0, 1185, 395, 0, 0, 200, false, null, 0),
  ('ksk', '2026-09-05', 'เจน', 565, 165, 528, 0, 156, 0, 0, 0, 0, 80, 0, 0, 1010, 350, 0, 0, 200, false, null, 0),
  ('ksk', '2026-09-06', 'เจน', 528, 156, 476, 0, 145, 0, 0, 0, 0, 120, 45, 0, 1305, 415, 0, 0, 200, false, null, 0),
  ('ksk', '2026-09-07', 'เจน', 476, 145, 433, 0, 137, 0, 0, 0, 0, 80, 0, 0, 1315, 160, 0, 0, 200, false, null, 0),
  ('ksk', '2026-09-08', 'เจน', 433, 137, 401, 0, 125, 0, 0, 0, 0, 120, 0, 0, 1155, 145, 0, 0, 200, false, null, 0),

  ('bdt', '2026-09-01', 'หมวย', 266, 38, 385, 150, 75, 50, 0, 0, 0, 80, 0, 20, 680, 355, 0, 400, 300, false, null, 0),
  ('bdt', '2026-09-02', 'หมวย', 385, 75, 352, 0, 65, 0, 0, 5, 0, 80, 0, 0, 415, 405, 70, 530, 300, false, null, 0),
  ('bdt', '2026-09-03', 'หมวย', 352, 65, 325, 0, 55, 0, 0, 0, 0, 40, 0, 0, 695, 200, 0, 390, 300, false, null, 0),
  ('bdt', '2026-09-04', 'หมวย', 325, 55, 401, 100, 78, 25, 0, 0, 0, 80, 0, 0, 420, 185, 0, 285, 300, false, null, 0),
  ('bdt', '2026-09-05', 'หมวย', 401, 78, 376, 0, 74, 0, 0, 0, 0, 80, 30, 0, 450, 100, 0, 405, 300, false, null, 0),
  ('bdt', '2026-09-06', 'หมวย', 376, 74, 314, 0, 66, 0, 0, 5, 0, 80, 0, 0, 475, 780, 105, 725, 300, false, null, 0),
  ('bdt', '2026-09-07', 'หมวย', 314, 66, 288, 0, 64, 0, 0, 0, 0, 80, 0, 0, 370, 285, 0, 285, 300, false, null, 0),
  ('bdt', '2026-09-08', 'หมวย', 288, 64, 403, 150, 75, 25, 0, 0, 0, 80, 0, 0, 555, 570, 0, 460, 300, false, null, 0),

  ('nlb', '2026-09-01', 'อั้ม', 361, 107, 330, 0, 94, 0, 0, 0, 0, 80, 0, 0, 950, 180, 0, 225, 200, false, null, 0),
  ('nlb', '2026-09-02', 'อั้ม', 330, 94, 303, 0, 82, 0, 0, 0, 0, 80, 45, 0, 770, 240, 0, 160, 200, false, null, 0),
  ('nlb', '2026-09-03', 'อั้ม', 303, 82, 269, 0, 69, 0, 0, 0, 0, 80, 0, 0, 685, 580, 0, 160, 200, false, null, 0),
  ('nlb', '2026-09-04', 'อั้ม', 269, 69, 405, 150, 137, 75, 0, 0, 0, 80, 0, 0, 435, 170, 0, 120, 200, false, null, 0),
  ('nlb', '2026-09-05', 'อั้ม', 405, 137, 374, 0, 114, 0, 0, 0, 0, 80, 0, 0, 850, 515, 0, 335, 200, false, null, 0),
  ('nlb', '2026-09-06', 'อั้ม', 374, 114, 301, 0, 106, 0, 0, 10, 0, 120, 0, 0, 1200, 685, 0, 310, 200, false, null, 0),
  ('nlb', '2026-09-07', 'อั้ม', 301, 106, 376, 100, 121, 25, 0, 0, 0, 80, 0, 0, 470, 380, 0, 245, 200, false, null, 0),
  ('nlb', '2026-09-08', 'ปิดร้าน', 376, 121, 376, 0, 121, 0, 0, 0, 0, 0, 0, 0, 200, 0, 0, 0, 200, true, 'approved_leave', 1),
  ('nlb', '2026-09-09', 'อั้ม', 376, 121, 348, 0, 117, 0, 0, 0, 0, 80, 45, 0, 650, 110, 0, 160, 200, false, null, 0);

-- ถ้าเคยรัน migration 007 รุ่นแรก ให้ถอนเฉพาะวันที่ 31 ส.ค. ที่ตรงกับชุดเดิม
-- ถ้าเป็นรายการจริงที่ผู้ใช้บันทึกเองหรือมีตัวเลขต่างกัน จะหยุดแทนการลบ
create temporary table _daily_import_old_baseline
  (like _daily_import_source including defaults) on commit drop;

insert into _daily_import_old_baseline (
  branch_id, record_date, staff_name, open_yen, open_pan, yen, yen_add, pan, pan_add,
  cup_own, topping, other, ice, water, etc, cash, transfer, grab, thaichaithai,
  float_cash, store_closed, closure_reason, leave_quota_days
) values
  ('lnd', '2026-08-31', 'ตาล', 278, 68, 393, 150, 84, 25, 0, 5, 0, 80, 0, 0, 960, 455, 0, 0, 300, false, null, 0),
  ('bwa', '2026-08-31', 'บีม', 258, 74, 403, 200, 137, 75, 100, 5, 0, 120, 28, 0, 1232, 820, 0, 0, 300, false, null, 0),
  ('ksk', '2026-08-31', 'เจน', 441, 137, 404, 0, 131, 0, 0, 0, 0, 80, 0, 0, 1155, 100, 0, 0, 200, false, null, 0),
  ('bdt', '2026-08-31', 'หมวย', 284, 45, 266, 0, 38, 0, 0, 5, 0, 80, 0, 0, 555, 685, 0, 0, 300, false, null, 0),
  ('nlb', '2026-08-31', 'อั้ม', 292, 89, 361, 100, 107, 25, 0, 0, 0, 80, 0, 0, 545, 610, 0, 0, 200, false, null, 0);

do $$
declare protected_rows text;
begin
  select string_agg(format('%s/%s', d.branch_id, to_char(d.record_date, 'YYYY-MM-DD')), ', '
                    order by d.branch_id)
    into protected_rows
  from daily_records d
  where d.record_date = '2026-08-31'
    and d.branch_id in ('lnd', 'bwa', 'ksk', 'bdt', 'nlb')
    and not exists (
      select 1
      from _daily_import_old_baseline s
      where s.branch_id = d.branch_id and s.record_date = d.record_date
        and d.created_by is null
        and row(
          d.staff_name, d.open_yen, d.open_pan, d.yen, d.yen_add, d.pan, d.pan_add,
          d.cup_own, d.topping, d.other, d.ice, d.water, d.etc,
          d.cash, d.transfer, d.grab, d.thaichaithai, d.float_cash,
          d.sent, d.closed, d.store_closed, d.closure_reason, d.leave_quota_days,
          d.cup_price_yen, d.cup_price_pan, d.grab_commission_pct
        ) is not distinct from row(
          s.staff_name, s.open_yen, s.open_pan, s.yen, s.yen_add, s.pan, s.pan_add,
          s.cup_own, s.topping, s.other, s.ice, s.water, s.etc,
          s.cash, s.transfer, s.grab, s.thaichaithai, s.float_cash,
          true, true, s.store_closed, s.closure_reason, s.leave_quota_days,
          s.cup_price_yen, s.cup_price_pan, s.grab_commission_pct
        )
    );

  if protected_rows is not null then
    raise exception 'ไม่ลบวันที่ 31 ส.ค.: พบข้อมูลที่ไม่ได้มาจากชุดนำเข้าเดิม (%). ไม่มีข้อมูลใดถูกเปลี่ยน', protected_rows;
  end if;
end $$;

delete from daily_records d
using _daily_import_old_baseline s
where d.branch_id = s.branch_id and d.record_date = s.record_date
  and d.created_by is null
  and row(
    d.staff_name, d.open_yen, d.open_pan, d.yen, d.yen_add, d.pan, d.pan_add,
    d.cup_own, d.topping, d.other, d.ice, d.water, d.etc,
    d.cash, d.transfer, d.grab, d.thaichaithai, d.float_cash,
    d.sent, d.closed, d.store_closed, d.closure_reason, d.leave_quota_days,
    d.cup_price_yen, d.cup_price_pan, d.grab_commission_pct
  ) is not distinct from row(
    s.staff_name, s.open_yen, s.open_pan, s.yen, s.yen_add, s.pan, s.pan_add,
    s.cup_own, s.topping, s.other, s.ice, s.water, s.etc,
    s.cash, s.transfer, s.grab, s.thaichaithai, s.float_cash,
    true, true, s.store_closed, s.closure_reason, s.leave_quota_days,
    s.cup_price_yen, s.cup_price_pan, s.grab_commission_pct
  );

-- ห้ามนำเข้าถ้าชื่อสาขาในฐานข้อมูลไม่ครบ ป้องกันข้อมูลตกหล่นบางสาขา
do $$
declare missing_branches text;
begin
  select string_agg(s.branch_id, ', ' order by s.branch_id)
    into missing_branches
  from (select distinct branch_id from _daily_import_source) s
  left join branches b on b.id = s.branch_id
  where b.id is null;

  if missing_branches is not null then
    raise exception 'ไม่พบสาขาในระบบ: %', missing_branches;
  end if;
end $$;

-- ถ้ามีวันเดิมแต่ตัวเลขต่างกัน ให้หยุดทั้งชุดเพื่อไม่ทับยอดที่ผู้ใช้กรอกไว้
do $$
declare conflicts text;
begin
  select string_agg(format('%s/%s', s.branch_id, to_char(s.record_date, 'YYYY-MM-DD')), ', '
                    order by s.branch_id, s.record_date)
    into conflicts
  from _daily_import_source s
  join daily_records d
    on d.branch_id = s.branch_id and d.record_date = s.record_date
  where row(
      d.staff_name, d.open_yen, d.open_pan, d.yen, d.yen_add, d.pan, d.pan_add,
      d.cup_own, d.topping, d.other, d.ice, d.water, d.etc,
      d.cash, d.transfer, d.grab, d.thaichaithai, d.float_cash,
      d.sent, d.closed, d.store_closed, d.closure_reason, d.leave_quota_days,
      d.cup_price_yen, d.cup_price_pan, d.grab_commission_pct
    ) is distinct from row(
      s.staff_name, s.open_yen, s.open_pan, s.yen, s.yen_add, s.pan, s.pan_add,
      s.cup_own, s.topping, s.other, s.ice, s.water, s.etc,
      s.cash, s.transfer, s.grab, s.thaichaithai, s.float_cash,
      true, true, s.store_closed, s.closure_reason, s.leave_quota_days,
      s.cup_price_yen, s.cup_price_pan, s.grab_commission_pct
    );

  if conflicts is not null then
    raise exception 'หยุดนำเข้า: พบยอดเดิมที่ไม่ตรงกับ Excel (%). ไม่มีข้อมูลใดถูกเปลี่ยน', conflicts;
  end if;
end $$;

create temporary table _daily_import_added_ids (
  id uuid primary key
) on commit drop;

-- เก็บเฉพาะรายการที่ยังไม่มี ส่วนรายการที่ตรงกันอยู่แล้วถือว่านำเข้าแล้ว
with added as (
  insert into daily_records (
    branch_id, record_date, staff_name, open_yen, open_pan, yen, yen_add, pan, pan_add,
    cup_own, topping, other, ice, water, etc, cash, transfer, grab, thaichaithai,
    float_cash, stock_snapshot, sent, closed, store_closed, closure_reason,
    leave_quota_days, cup_price_yen, cup_price_pan, grab_commission_pct
  )
  select
    s.branch_id, s.record_date, s.staff_name, s.open_yen, s.open_pan,
    s.yen, s.yen_add, s.pan, s.pan_add,
    s.cup_own, s.topping, s.other, s.ice, s.water, s.etc,
    s.cash, s.transfer, s.grab, s.thaichaithai, s.float_cash,
    coalesce((
      select d0.stock_snapshot
      from daily_records d0
      where d0.branch_id = s.branch_id
        and d0.record_date < s.record_date
        and d0.stock_snapshot <> '{}'::jsonb
      order by d0.record_date desc
      limit 1
    ), '{}'::jsonb),
    true, true, s.store_closed, s.closure_reason, s.leave_quota_days,
    s.cup_price_yen, s.cup_price_pan, s.grab_commission_pct
  from _daily_import_source s
  order by s.branch_id, s.record_date
  on conflict (branch_id, record_date) do nothing
  returning id
)
insert into _daily_import_added_ids (id)
select id from added;

-- Trigger ของระบบตั้งราคาปัจจุบันตอน INSERT เพื่อกันพนักงานแก้ราคาเอง
-- หลังนำเข้าด้วยสิทธิ์ SQL Editor จึงยืนยัน snapshot ตามสูตรในไฟล์ให้เฉพาะแถวที่เพิ่มใหม่
update daily_records d
set cup_price_yen = 25,
    cup_price_pan = 35,
    grab_commission_pct = 0.321,
    updated_at = now()
from _daily_import_added_ids a
where d.id = a.id;

-- ข้อมูลเก่าไม่มีเวลาจริง เจ้าของให้ถือว่าเข้าและออกตรงตามเวลางานของสาขา
-- ถ้ามีการลงเวลาจริงอยู่แล้ว ไม่เขียนทับเวลาเดิม
create temporary table _daily_import_added_clock_ids (
  id uuid primary key
) on commit drop;

with added as (
  insert into clock_records (
    branch_id, clock_date, staff_name, time_in, time_out,
    late_minutes, early_minutes, no_clock, open_yen, open_pan
  )
  select
    s.branch_id, s.record_date, s.staff_name, b.work_start, b.work_end,
    0, 0, false, s.open_yen, s.open_pan
  from _daily_import_source s
  join branches b on b.id = s.branch_id
  where not s.store_closed
  order by s.branch_id, s.record_date
  on conflict (branch_id, clock_date) do nothing
  returning id
)
insert into _daily_import_added_clock_ids (id)
select id from added;

-- ผลลัพธ์ที่ SQL Editor แสดง: ยอดขาย 42 วัน และเวลาเข้า-ออกไม่เกิน 41 วัน
select
  count(*) as source_rows,
  (select count(*) from _daily_import_added_ids) as inserted_rows,
  count(*) - (select count(*) from _daily_import_added_ids) as already_matching_rows,
  (select count(*) from _daily_import_added_clock_ids) as clock_rows_added,
  min(record_date) as first_date,
  max(record_date) as last_date
from _daily_import_source;

commit;
