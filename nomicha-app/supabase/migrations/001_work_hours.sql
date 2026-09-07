-- เพิ่มเวลาทำงานรายสาขา (5 ก.ย. 69)
-- ใช้เฉพาะคนที่รัน schema.sql เวอร์ชันก่อนหน้าไปแล้ว — ถ้าเพิ่งติดตั้งใหม่ schema.sql มีคอลัมน์พวกนี้อยู่แล้ว ไม่ต้องรันไฟล์นี้
-- วิธีรัน: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run
alter table branches
  add column if not exists work_start     time not null default '08:00',
  add column if not exists work_end       time not null default '18:00',
  add column if not exists late_grace_min int  not null default 0;

comment on column branches.work_start is 'เวลาเข้างานตามเวลาไทย — ลงเวลาเข้าช้ากว่านี้ (เกิน late_grace_min) นับเป็นนาทีสาย';
comment on column branches.work_end   is 'เวลาปิดร้านตามเวลาไทย — ลงเวลาออกก่อนนี้นับเป็น "ปิดไว"';

-- ตั้งเวลาจริงของแต่ละสาขาตรงนี้ (แก้ตัวเลขให้ตรงกับที่ใช้จริง แล้วค่อยรัน หรือแก้ทีหลังในหน้าตั้งค่าของเจ้าของก็ได้)
-- update branches set work_start='08:00', work_end='18:00', late_grace_min=10 where id='lnd';

-- ---------------------------------------------------------------
-- เพิ่มระยะห่างจากร้านตอนลงเวลา (บังคับลงเวลาในรัศมีร้าน — 5 ก.ย. 69)
alter table clock_records
  add column if not exists in_distance_m  int,
  add column if not exists out_distance_m int;
comment on column clock_records.in_distance_m is 'ระยะห่างจากพิกัดร้าน (เมตร) ตอนกดลงเวลาเข้า — ไว้ตรวจย้อนหลังว่าลงเวลาจากที่ร้านจริง';

-- ---------------------------------------------------------------
-- ย้ายกติกาจ่าย/หัก จากค่าคงที่ในโค้ดมาเป็นค่าที่เจ้าของแก้เองได้ (5 ก.ย. 69)
insert into settings (key, value) values
  ('pay_rules', '{"cupPay":1,"latePerMin":1,"earlyPerMin":1,"noClock":40,"excessDayOff":330}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------
-- ที่อยู่จดทะเบียนของทั้ง 2 บริษัท (เจ้าของแจ้ง 5 ก.ย. 69 — ใช้ที่อยู่เดียวกัน)
-- เติมให้เฉพาะแถวที่ยังว่างอยู่ ไม่ทับของที่กรอกเองไว้แล้ว
update companies set address='เลขที่ 379/20 หมู่ที่ 13 ตำบลหนองเรือ อำเภอหนองเรือ จังหวัดขอนแก่น 40210'
  where address is null or address = '';

-- ---------------------------------------------------------------
-- ล็อกอินด้วย "ชื่อผู้ใช้" แทนอีเมล + ชื่อ-นามสกุล-เลขบัตร สำหรับสลิปเงินเดือน (5 ก.ย. 69)
alter table employees
  add column if not exists username   text,
  add column if not exists first_name text,
  add column if not exists last_name  text;
create unique index if not exists employees_username_key on employees (username);
comment on column employees.username is 'ล็อกอินด้วยชื่อผู้ใช้ ไม่ใช่อีเมล — เบื้องหลังต่อ "@nomicha.local" ให้เอง จึงต้องเป็นตัวอักษรอังกฤษ/ตัวเลขเท่านั้น';

-- เลขบัตรประชาชนแยกตาราง เพราะหัวหน้าอ่านตาราง employees ได้ทั้งตาราง
create table if not exists employee_private (
  employee_id   uuid primary key references employees(id) on delete cascade,
  national_id   text
);
alter table employee_private enable row level security;
drop policy if exists owner_all_employee_private on employee_private;
drop policy if exists self_read_employee_private on employee_private;
create policy owner_all_employee_private on employee_private for all using (auth_role()='owner') with check (auth_role()='owner');
create policy self_read_employee_private on employee_private for select using (employee_id = auth.uid());

-- นายจ้างของแต่ละคน (เจ้าของยืนยัน 5 ก.ย. 69): หัวหน้า = เพตั้น · พนักงานสาขา = คาเชน
update employees set employer_company_id='warehouse' where role='relief'  and employer_company_id is null;
update employees set employer_company_id='branch_co' where role='staff'   and employer_company_id is null;

-- เติมชื่อผู้ใช้ให้บัญชีที่สร้างไว้แล้วด้วยอีเมล (ตัดส่วนหลัง @ มาเป็นชื่อผู้ใช้)
update employees e set username = split_part(u.email, '@', 1)
  from auth.users u where u.id = e.id and e.username is null;

-- ---------------------------------------------------------------
-- เงินเดือนคิดรวมเป็นก้อนของสาขา (1 สาขา 1 บัญชี — 5 ก.ย. 69)
-- พนักงานสาขาต้องรู้ "ชื่อหัวหน้า" เพื่อกันวันที่หัวหน้ามาทำแทนออกจากยอดของสาขา
-- เปิดเฉพาะชื่อตัวเดียวด้วย security definer ไม่ได้เปิดทั้งแถว (เงินเดือนหัวหน้ายังปิดอยู่)
create or replace function relief_name() returns text
language sql stable security definer set search_path = public as $$
  select name from employees where role='relief' and active order by name limit 1;
$$;
