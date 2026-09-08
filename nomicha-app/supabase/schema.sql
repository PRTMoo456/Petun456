-- ==============================================================
-- ระบบสรุปยอดโนมิชา — ฐานข้อมูลจริง (Supabase / Postgres)
-- แปลงจากต้นแบบ (nomicha.html, ข้อมูลในหน่วยความจำ `db`) ตามสเปกฉบับ 43
-- อ้างอิง: claude/concept-spec.md ในโปรเจกต์ "สรุปยอดสาขา"
-- ==============================================================
-- วิธีใช้: วางทั้งไฟล์นี้ใน Supabase Dashboard → SQL Editor → Run
-- รันครั้งเดียวตอนตั้งโปรเจกต์ใหม่ (ไฟล์นี้ไม่ seed ข้อมูลสมมุติใด ๆ — สต๊อก/ยอดขายทุกอย่างเริ่มที่ 0
--  ตามหลักการที่เจ้าของยืนยันไว้ในข้อ 22.3 ของสเปก: "ระบบจริงต้องเริ่มจากไฟล์ว่างเปล่า")
-- ==============================================================

create extension if not exists "pgcrypto"; -- สำหรับ gen_random_uuid()

-- ------------------------------------------------------------
-- 0. บทบาทผู้ใช้ (enum)
-- ------------------------------------------------------------
create type user_role as enum ('staff', 'relief', 'owner');
create type advance_type as enum ('advance', 'loan');   -- เบิก / กู้
create type advance_source as enum ('request', 'remit'); -- ขอผ่านปุ่ม / เก็บเงินสดร้านไว้แทนส่ง
create type remit_method as enum ('cash', 'transfer', 'loan');
create type recount_status as enum ('pending', 'approved', 'rejected');

-- ------------------------------------------------------------
-- 1. บริษัท (2 นิติบุคคลแยกกัน — ดูข้อ 22.4 / 23 ในสเปก)
-- ------------------------------------------------------------
create table companies (
  id            text primary key,           -- 'warehouse' | 'branch_co'
  name          text not null,              -- บริษัท เพตั้น จำกัด / บริษัท คาเชน จำกัด
  address       text not null default '',   -- ที่อยู่จดทะเบียนจริง — เจ้าของกรอกเองในหน้าตั้งค่า ยังไม่ทราบตอนสร้างตาราง
  tax_id        text not null default '',   -- เลขผู้เสียภาษี 13 หลัก — ยืนยันกับหนังสือรับรองจริงก่อนใช้พิมพ์เอกสารจริง (ดูข้อ 23)
  vat_registered boolean not null default false,
  updated_at    timestamptz not null default now()
);
comment on table companies is 'คลังกลาง (warehouse=เพตั้น) และ 5 สาขา (branch_co=คาเชน) เป็นคนละนิติบุคคล ซื้อขายกันจริง ต้องมีเอกสารยื่นสรรพากรได้';

insert into companies (id, name) values
  ('warehouse', 'บริษัท เพตั้น จำกัด'),
  ('branch_co', 'บริษัท คาเชน จำกัด');
-- ตั้งค่า address/tax_id/vat_registered จริงทีหลังด้วย UPDATE ในหน้าตั้งค่า (อย่าฝังเลขที่ยังไม่ยืนยันตรงนี้)

-- ------------------------------------------------------------
-- 2. สาขา
-- ------------------------------------------------------------
create table branches (
  id              text primary key,          -- 'lnd','bwa','nlb','ksk','bdt'
  company_id      text not null references companies(id) default 'branch_co',
  name            text not null,
  float_cash      numeric not null default 300,   -- เงินทอนตั้งต้น
  days_off_quota  int not null default 2,          -- โควตาวันหยุด/เดือน
  holiday_work_days int not null default 0,        -- จำนวนครั้งทำงานวันหยุดที่นับได้ต่อเดือน (hw)
  gps_lat         double precision,
  gps_lng         double precision,
  gps_radius      int not null default 100,
  -- เวลาทำงานของสาขา (เวลาไทย) ใช้คิด "มาสาย/ปิดไว" ตอนลงเวลา — แยกรายสาขาเพราะแต่ละที่เปิด-ปิดไม่เท่ากัน
  work_start      time not null default '08:00',
  work_end        time not null default '18:00',
  late_grace_min  int  not null default 0,         -- ผ่อนผันมาสายกี่นาทีถึงจะเริ่มนับ (0 = นับตั้งแต่นาทีแรก)
  active          boolean not null default true    -- false = ปิดสาขาแล้ว (เช่นบ้านแพง) แต่เก็บประวัติไว้ ไม่ลบทิ้ง
);
comment on column branches.work_start is 'เวลาเข้างานตามเวลาไทย — ลงเวลาเข้าช้ากว่านี้ (เกิน late_grace_min) นับเป็นนาทีสาย หักนาทีละ 1 บาท และมีผลกับเบี้ยขยัน';
comment on column branches.work_end is 'เวลาปิดร้านตามเวลาไทย — ลงเวลาออกก่อนนี้นับเป็น "ปิดไว" หักนาทีละ 1 บาท เหมือนมาสาย';

create table branch_rent_history (
  id            uuid primary key default gen_random_uuid(),
  branch_id     text not null references branches(id),
  effective_from date not null,
  rent          numeric not null,
  unique(branch_id, effective_from)
);

-- ค่าเช่าคลังกลาง (จ่ายให้หัวหน้า) แยกจากค่าเช่าสาขา
create table warehouse_rent_history (
  id            uuid primary key default gen_random_uuid(),
  effective_from date not null unique,
  rent          numeric not null
);

-- ------------------------------------------------------------
-- 3. พนักงาน/ผู้ใช้งาน 7 คน — ผูกกับ auth.users ของ Supabase โดยตรง (id เดียวกัน)
-- ------------------------------------------------------------
create table employees (
  id                uuid primary key references auth.users(id) on delete cascade,
  username          text unique,      -- ชื่อผู้ใช้ที่ใช้ล็อกอิน (a-z 0-9 . _ - เท่านั้น) — 1 สาขา 1 ชื่อผู้ใช้
  name              text not null,    -- ชื่อเล่นที่ใช้แสดงบนจอ
  first_name        text,             -- ชื่อจริง — ขึ้นบนสลิปเงินเดือน
  last_name         text,             -- นามสกุล — ขึ้นบนสลิปเงินเดือน
  role              user_role not null,
  branch_id         text references branches(id),     -- มีค่าเฉพาะ role='staff' (ประจำสาขาไหน)
  employer_company_id text references companies(id),  -- ลูกจ้างบริษัทไหน (เจ้าของยืนยัน 5 ก.ย. 69)
  base_salary       numeric not null default 0,
  days_off_quota    int not null default 2,
  delivery_pay      numeric,        -- เฉพาะหัวหน้า (relief) เงินส่งของคงที่/เดือน
  active            boolean not null default true
);
comment on column employees.username is 'ล็อกอินด้วยชื่อผู้ใช้ ไม่ใช่อีเมล — เบื้องหลังระบบต่อ "@nomicha.local" ให้เองเพราะ Supabase Auth บังคับรูปแบบอีเมล จึงต้องเป็นตัวอักษรอังกฤษ/ตัวเลขเท่านั้น';
comment on column employees.employer_company_id is 'หัวหน้า (relief) = เพตั้น (warehouse) · พนักงานสาขา (staff) = คาเชน (branch_co) — เจ้าของยืนยัน 5 ก.ย. 69 ใช้เลือกหัวกระดาษสลิปเงินเดือน';

-- เลขบัตรประชาชน แยกตารางเพราะหัวหน้าอ่านตาราง employees ได้ทั้งตาราง (relief_read_employees)
-- ตารางนี้ให้อ่านได้เฉพาะ "เจ้าของ" กับ "เจ้าตัว" เท่านั้น
create table employee_private (
  employee_id   uuid primary key references employees(id) on delete cascade,
  national_id   text     -- 13 หลัก ใช้ขึ้นสลิปเงินเดือน
);
comment on table employee_private is 'ข้อมูลอ่อนไหวรายบุคคล — เจ้าของและเจ้าตัวเท่านั้นที่อ่านได้ หัวหน้าอ่านไม่ได้';

-- ------------------------------------------------------------
-- 4. รอบส่งของ
-- ------------------------------------------------------------
create table delivery_rounds (
  id            text primary key,      -- 'r1','r2'
  name          text not null,         -- รอบจันทร์ / รอบศุกร์
  day_of_week   int not null,          -- 0=อา..6=ส
  branch_ids    text[] not null
);

-- ------------------------------------------------------------
-- 5. วัตถุดิบ (44 รายการ) + ระดับที่ต้องมีต่อรอบรายสาขา
-- ------------------------------------------------------------
create table stock_categories (
  id            int primary key,
  name          text not null,
  sort_order    int not null
);

create table stock_items (
  id              int primary key,          -- คงเลข id เดิมไว้ (0-44 โดยไม่มี 15) กันข้อมูลเก่าเหลื่อม
  name            text not null,
  unit            text not null,            -- แถว/ห่อ/ถุง/ขวด/กระป๋อง/กล่อง
  min_qty         int not null,             -- ขั้นต่ำที่ต้องมี (ใช้เตือนของใกล้หมด)
  per_case        int not null,             -- จำนวนต่อ 1 ลัง
  branch_price    numeric not null,         -- ราคาส่งสาขา (เจ้าของแก้ได้ในหน้าตั้งค่า ราคาเดียวกันทุกสาขา)
  category_id     int references stock_categories(id),
  display_order   int not null default 0,
  active          boolean not null default true
);
comment on table stock_items is 'perCase/branch_price เป็นตัวเลขจริงที่เจ้าของกรอกมา ส่วนต้นทุนใช้ warehouse_stock.avg_cost ซึ่งคำนวณจากราคาซื้อจริงใน purchases เท่านั้น';

create table stock_par_levels (       -- ระดับที่ต้องมีต่อรอบ แยกรายสาขา (ข้อมูลจริง REAL_PAR)
  item_id     int not null references stock_items(id),
  branch_id   text not null references branches(id),
  par_qty     int not null,
  primary key (item_id, branch_id)
);

-- ------------------------------------------------------------
-- 6. คลังกลาง — สต๊อกปัจจุบัน + ต้นทุนเฉลี่ยถ่วงน้ำหนัก
-- ------------------------------------------------------------
create table warehouse_stock (
  item_id     int primary key references stock_items(id),
  case_qty    int not null default 0,     -- เริ่มที่ 0 เสมอในระบบจริง (ต่างจากต้นแบบที่ตั้ง 1 ลังไว้สาธิต — ดูข้อ 22.3)
  loose_qty   int not null default 0,
  avg_cost    numeric not null default 0, -- ต้นทุนเฉลี่ยต่อหน่วย ปรับทุกครั้งที่มีบิลซื้อ (ดู purchases)
  last_checked date
);

create table purchases (              -- บิลซื้อวัตถุดิบเข้าคลังกลาง (ราคาซื้อจริง ไม่ใช่ราคาส่งสาขา)
  id            uuid primary key default gen_random_uuid(),
  item_id       int not null references stock_items(id),
  purchase_date date not null,
  case_qty      int not null,
  total_price   numeric not null,
  cost_per_unit numeric not null,       -- คำนวณตอนบันทึก = total_price / (case_qty*per_case)
  note          text,
  created_by    uuid references employees(id),
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 7. ยอดปิดร้านรายวัน (หัวใจของระบบ)
-- ------------------------------------------------------------
create table daily_records (
  id            uuid primary key default gen_random_uuid(),
  branch_id     text not null references branches(id),
  record_date   date not null,
  staff_name    text not null,          -- ชื่อคนขายจริงวันนั้น (อาจเป็นหัวหน้าไปแทน)
  yen           int not null default 0,   -- แก้วเย็นคงเหลือปลายวัน
  yen_add       int not null default 0,   -- แก้วเย็นที่เติมระหว่างวัน (1 แถว=50)
  pan           int not null default 0,   -- แก้วปั่นคงเหลือปลายวัน
  pan_add       int not null default 0,   -- (1 แถว=25)
  cup_own       numeric not null default 0,
  topping       numeric not null default 0,
  other         numeric not null default 0,
  ice           numeric not null default 0,
  water         numeric not null default 0,
  etc           numeric not null default 0,
  cash          numeric not null default 0,
  transfer      numeric not null default 0,   -- เงินโอน/พร้อมเพย์
  grab          numeric not null default 0,   -- ยอดเต็มที่ลูกค้าจ่ายผ่านแกร๊บ (หักค่าคอมตอนคำนวณ ไม่ใช่ตอนกรอก)
  thaichaithai  numeric not null default 0,
  float_cash    numeric not null,             -- เงินทอนตั้งต้นที่ "ใช้จริงวันนั้น" (snapshot ไม่ใช้ค่าปัจจุบันของสาขา)
  stock_snapshot jsonb not null default '{}', -- {item_id: qty} ยอดคงเหลือปลายวันของวัตถุดิบ
  sent          boolean not null default false,
  closed        boolean not null default false,
  created_by    uuid references employees(id),
  created_at    timestamptz not null default now(),
  unique (branch_id, record_date)
);
comment on column daily_records.stock_snapshot is 'เก็บเป็น JSONB เพราะอ่าน/เขียนทั้งก้อนต่อวันเสมอ ไม่เคย query แยกรายวัตถุดิบข้ามวัน (ต่างจาก warehouse_stock ที่ query แยกรายชิ้นบ่อย)';

create table record_edit_history (      -- ประวัติที่เจ้าของแก้ยอดย้อนหลัง (db.edits เดิม)
  id            uuid primary key default gen_random_uuid(),
  record_id     uuid not null references daily_records(id),
  field         text not null,
  from_value    text,
  to_value      text,
  label         text not null,
  edited_by     uuid references employees(id),
  edited_at     timestamptz not null default now()
);

-- ลงเวลาเข้า-ออก (แยกจากยอดปิดร้าน เพราะลงเวลาได้ก่อนรู้ยอดขาย)
create table clock_records (
  id            uuid primary key default gen_random_uuid(),
  branch_id     text not null references branches(id),
  clock_date    date not null,
  staff_name    text not null,
  time_in       time,
  time_out      time,
  late_minutes  int not null default 0,
  early_minutes int not null default 0,
  no_clock      boolean not null default false,
  open_yen      int,     -- นับแก้วเย็นจริงก่อนเริ่มขาย (เฉพาะวันเปลี่ยนมือ — ดู handoffToday ในต้นแบบ)
  open_pan      int,
  -- ระยะห่างจากร้าน (เมตร) ตอนกดลงเวลา — เก็บไว้ให้เจ้าของตรวจย้อนหลังได้ว่าลงเวลาจากที่ร้านจริง
  in_distance_m  int,
  out_distance_m int,
  unique (branch_id, clock_date)
);

-- คำขอตรวจสอบยอดแก้ว (เกิดเมื่อนับแก้วก่อนขายไม่ตรงกับยอดปิดเมื่อวาน)
create table recount_requests (
  id            uuid primary key default gen_random_uuid(),
  branch_id     text not null references branches(id),
  request_date  date not null,
  prev_record_id uuid references daily_records(id),
  staff_name    text not null,
  old_yen       int, old_pan       int,
  new_yen       int, new_pan       int,
  value_diff    numeric,
  status        recount_status not null default 'pending',
  requested_at  timestamptz not null default now(),
  resolved_at   timestamptz
);

-- ------------------------------------------------------------
-- 8. วันหยุด
-- ------------------------------------------------------------
create table day_offs (             -- วันหยุดพนักงานสาขา (จองล่วงหน้า)
  id          uuid primary key default gen_random_uuid(),
  off_date    date not null,
  branch_id   text not null references branches(id),
  unique (off_date)     -- กติกา: วันหนึ่งหยุดได้สาขาเดียว
);

create table relief_day_offs (      -- วันหยุดของหัวหน้า
  off_date    date primary key
);

-- ------------------------------------------------------------
-- 9. เบิกเงิน/เงินกู้ + เงินสด
-- ------------------------------------------------------------
create table advances (
  id            uuid primary key default gen_random_uuid(),
  -- branch_id เป็น null ได้ — ใช้กับเงินเบิก/เงินกู้ของหัวหน้าเอง (ไม่ผูกกับสาขาเดียว ต่างจากพนักงานสาขา)
  branch_id     text references branches(id),
  staff_name    text not null,
  request_date  date not null,
  amount        numeric not null,
  type          advance_type not null,
  interest      numeric not null default 0,
  total         numeric not null,          -- amount + interest
  due_date      date not null,             -- วันที่ 5 หรือ 20 ถัดไปที่ใกล้ที่สุด — ครบกำหนดแล้วถือว่าหักคืนอัตโนมัติ (ดู isSettled ในต้นแบบ)
  source        advance_source not null default 'request',
  repaid        boolean not null default false,
  created_at    timestamptz not null default now()
);

create table cash_remittances (      -- เงินสดสาขา → หัวหน้า
  id            uuid primary key default gen_random_uuid(),
  branch_id     text not null references branches(id),
  remit_date    date not null,
  amount        numeric not null,
  method        remit_method not null default 'cash'
);

create table remit_loan_offsets (    -- ยอดเงินสดที่พนักงานเลือกเก็บไว้เป็นเงินกู้แทนส่งจริง (หักจากยอดที่ต้องส่ง)
  branch_id     text primary key references branches(id),
  amount        numeric not null default 0
);

create table head_remittances (      -- หัวหน้า → เจ้าของ (เงินสด/โอน)
  id            uuid primary key default gen_random_uuid(),
  remit_date    date not null,
  amount        numeric not null,
  method        remit_method not null default 'cash'
);

-- ------------------------------------------------------------
-- 10. ส่งของ / ขายนอกสาขา / ซ่อมบำรุง
-- ------------------------------------------------------------
create table deliveries (           -- ใบส่งของ คลังกลาง → สาขา (ผู้ขาย=เพตั้น, ผู้ซื้อ=คาเชนสาขานั้น — ดูข้อ 23)
  id            uuid primary key default gen_random_uuid(),
  delivery_date date not null,
  branch_id     text not null references branches(id),
  round_id      text references delivery_rounds(id),
  items         jsonb not null,          -- {item_id: qty_sent}
  received      jsonb,                   -- {item_id: qty_received} — null จนกว่าสาขาจะเช็ครับ
  packed_by     uuid references employees(id),
  received_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (branch_id, delivery_date, round_id)
);

create table external_sales (        -- บิลขายวัตถุดิบให้ร้านนอกสาขา (คลังกลาง=เพตั้น เป็นผู้ขาย)
  id            uuid primary key default gen_random_uuid(),
  sale_date     date not null,
  buyer         text not null,
  issuer        uuid references employees(id),
  items         jsonb not null,          -- [{item_id, qty, price}]
  total         numeric not null,
  paid          boolean not null default false,
  edit_log      jsonb not null default '[]',
  created_at    timestamptz not null default now()
);

create table repairs (               -- ค่าซ่อม/บำรุงรักษาต่อสาขา
  id            uuid primary key default gen_random_uuid(),
  branch_id     text not null references branches(id),
  repair_date   date not null,
  description   text not null,
  cost          numeric not null,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 11. ค่าคงที่/กติกาที่เจ้าของแก้เองได้ (แทนแท็บ "ตั้งค่า" ของต้นแบบ)
-- ------------------------------------------------------------
create table settings (
  key           text primary key,
  value         jsonb not null,
  updated_at    timestamptz not null default now()
);
comment on table settings is 'เก็บค่าคงที่ทางธุรกิจที่เจ้าของแก้ได้เอง เช่น grab_commission_pct, advance_cap, loan_cap, loan_interest_pct, cup_price, diligence_rules, holiday_pay_scale';

insert into settings (key, value) values
  ('grab_commission_pct', '0.321'),
  ('advance_cap',         '4000'),
  ('loan_cap',            '2000'),
  ('loan_interest_pct',   '0.10'),
  ('advance_day',         '20'),
  ('settle_days',         '[5,20]'),
  ('cup_price',           '{"yen":25,"pan":35}'),
  ('cups_per_row',        '{"yen":50,"pan":25}'),
  ('diligence_rules',     '{"step":500,"cap":1500,"lateAllowance":250}'),
  ('holiday_pay_scale',   '[400,450,500,550]'),
  ('overuse_threshold_units', '0.5'),
  -- กติกาจ่าย/หัก (เดิมฝังเป็นค่าคงที่ในโค้ด ย้ายมาให้เจ้าของแก้เองได้ 5 ก.ย. 69)
  ('pay_rules', '{"cupPay":1,"latePerMin":1,"earlyPerMin":1,"noClock":40,"excessDayOff":330}');  -- เกณฑ์ "ใช้เยอะเกิน" ตอนเช็ครับของ — ยังตายตัวที่ 0.5 หน่วย (ดูข้อ 7 "ค้างอยู่")

-- ==============================================================
-- Row Level Security — 3 บทบาท: staff (เห็นเฉพาะสาขาตัวเอง) / relief (หัวหน้า) / owner (เห็นทุกอย่าง)
-- ==============================================================
create or replace function auth_role() returns user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.employees where id = auth.uid();
$$;
create or replace function auth_branch() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select branch_id from public.employees where id = auth.uid();
$$;
-- ป้องกัน RLS policy query employees แล้วย้อนกลับเข้า policy เดิม
revoke all on function auth_role() from public;
revoke all on function auth_branch() from public;
grant execute on function auth_role() to authenticated;
grant execute on function auth_branch() to authenticated;
/* ชื่อหัวหน้า — พนักงานสาขาจำเป็นต้องรู้ เพื่อไม่ให้วันที่หัวหน้ามาทำแทนถูกนับเป็นวันทำงาน/ค่าแก้วของสาขา
   ใช้ security definer เพื่อเปิดเฉพาะ "ชื่อ" ตัวเดียว ไม่ได้เปิดทั้งแถว (เงินเดือน/เงินส่งของของหัวหน้ายังปิดอยู่)
   ชื่อนี้พนักงานเห็นอยู่แล้วบนหน้าจอ (ปฏิทินวันหยุด/ข้อความรับช่วงต่อ) จึงไม่ใช่ข้อมูลใหม่ */
create or replace function relief_name() returns text
language sql stable security definer set search_path = public as $$
  select name from employees where role='relief' and active order by name limit 1;
$$;

alter table employees enable row level security;
alter table employee_private enable row level security;
alter table daily_records enable row level security;
alter table clock_records enable row level security;
alter table record_edit_history enable row level security;
alter table recount_requests enable row level security;
alter table day_offs enable row level security;
alter table relief_day_offs enable row level security;
alter table advances enable row level security;
alter table cash_remittances enable row level security;
alter table remit_loan_offsets enable row level security;
alter table head_remittances enable row level security;
alter table deliveries enable row level security;
alter table external_sales enable row level security;
alter table repairs enable row level security;
alter table purchases enable row level security;
alter table warehouse_stock enable row level security;
alter table settings enable row level security;

-- เจ้าของเห็น/แก้ได้ทุกอย่างเสมอ
create policy owner_all_employees on employees for all using (auth_role()='owner') with check (auth_role()='owner');
create policy self_read_employees on employees for select using (id = auth.uid());
-- หัวหน้าต้องเห็นชื่อ/สาขาของพนักงานทุกคน (ไปแทนสาขาไหนก็ได้ + คิดเงินเดือนตัวเอง) — อ่านได้อย่างเดียว แก้ไม่ได้
create policy relief_read_employees on employees for select using (auth_role()='relief');
-- เลขบัตรประชาชน: เจ้าของแก้/อ่านได้ทุกคน · เจ้าตัวอ่านได้เฉพาะของตัวเอง · หัวหน้าอ่านของคนอื่นไม่ได้
create policy owner_all_employee_private on employee_private for all using (auth_role()='owner') with check (auth_role()='owner');
create policy self_read_employee_private on employee_private for select using (employee_id = auth.uid());

-- พนักงานสาขา: อ่าน/เขียนเฉพาะข้อมูลสาขาตัวเอง, หัวหน้า+เจ้าของ: เห็นทุกสาขา (หัวหน้าต้องไปแทน/ส่งของทุกสาขา)
create policy staff_own_branch_records on daily_records for all
  using (auth_role() in ('relief','owner') or branch_id = auth_branch())
  with check (auth_role() in ('relief','owner') or branch_id = auth_branch());

create policy staff_own_branch_clock on clock_records for all
  using (auth_role() in ('relief','owner') or branch_id = auth_branch())
  with check (auth_role() in ('relief','owner') or branch_id = auth_branch());

-- ประวัติแก้ไข/คำขอตรวจสอบยอด: เจ้าของแก้ได้ ทุกคนอ่านได้เฉพาะสาขาตัวเอง
create policy read_edit_history on record_edit_history for select using (true);
create policy owner_write_edit_history on record_edit_history for insert with check (auth_role()='owner');
create policy manage_recounts on recount_requests for all
  using (auth_role() in ('relief','owner') or branch_id = auth_branch())
  with check (auth_role() in ('relief','owner') or branch_id = auth_branch());

-- วันหยุด: ทุกคน "อ่าน" ได้ทุกสาขา (จำเป็นต้องเห็นวันที่สาขาอื่น/หัวหน้าจองไปแล้ว เพื่อกันจองชนกัน — ไม่ใช่ข้อมูลอ่อนไหว)
-- แต่ "จอง/ยกเลิก" ได้เฉพาะของสาขาตัวเอง (หัวหน้า/เจ้าของจองแทนสาขาไหนก็ได้)
create policy read_day_offs on day_offs for select using (true);
create policy write_day_offs on day_offs for insert with check (auth_role() in ('relief','owner') or branch_id = auth_branch());
create policy delete_day_offs on day_offs for delete using (auth_role() in ('relief','owner') or branch_id = auth_branch());
create policy read_relief_day_offs on relief_day_offs for select using (true);
create policy write_relief_day_offs on relief_day_offs for insert with check (auth_role() in ('relief','owner'));
create policy delete_relief_day_offs on relief_day_offs for delete using (auth_role() in ('relief','owner'));
create policy advances_policy on advances for all
  using (auth_role() in ('relief','owner') or branch_id = auth_branch())
  with check (auth_role() in ('relief','owner') or branch_id = auth_branch());
-- เงินสดที่ส่ง: พนักงานบันทึก "ส่งเงินสดแล้ว" ของสาขาตัวเองได้เอง (ดู doRemit ในต้นแบบ) หัวหน้า/เจ้าของบันทึกแทนสาขาไหนก็ได้ (doRemitBranch)
create policy read_remit on cash_remittances for select using (auth_role() in ('relief','owner') or branch_id = auth_branch());
create policy write_remit on cash_remittances for insert
  with check (auth_role() in ('relief','owner') or branch_id = auth_branch());
-- ยอดที่พนักงานเลือกเก็บไว้เป็นเงินกู้แทนส่งจริง (remit_loan_offsets) เป็นการกระทำของพนักงานเอง จึงแก้ของสาขาตัวเองได้ด้วย
create policy remit_offset_policy on remit_loan_offsets for all
  using (auth_role() in ('relief','owner') or branch_id = auth_branch())
  with check (auth_role() in ('relief','owner') or branch_id = auth_branch());
create policy head_remit_policy on head_remittances for all using (auth_role() in ('relief','owner')) with check (auth_role() in ('relief','owner'));
create policy deliveries_policy on deliveries for all
  using (auth_role() in ('relief','owner') or branch_id = auth_branch())
  with check (auth_role() in ('relief','owner') or branch_id = auth_branch());
create policy external_sales_policy on external_sales for all using (auth_role() in ('relief','owner')) with check (auth_role() in ('relief','owner'));
create policy repairs_policy on repairs for all using (auth_role() in ('relief','owner')) with check (auth_role() in ('relief','owner'));
create policy purchases_policy on purchases for all using (auth_role() in ('relief','owner')) with check (auth_role() in ('relief','owner'));
create policy warehouse_stock_policy on warehouse_stock for all using (auth_role() in ('relief','owner')) with check (auth_role() in ('relief','owner'));

-- ตั้งค่า/ราคา/กติกา: ทุกคนอ่านได้ (ต้องใช้คำนวณหน้าจอตัวเอง) เจ้าของแก้ได้คนเดียว
create policy settings_read on settings for select using (true);
create policy settings_write on settings for all using (auth_role()='owner') with check (auth_role()='owner');

-- ตารางอ้างอิงคงที่ (companies/branches/stock_items/...) — อ่านได้ทุกคน, แก้ได้เฉพาะเจ้าของ
alter table companies enable row level security;
alter table branches enable row level security;
alter table branch_rent_history enable row level security;
alter table warehouse_rent_history enable row level security;
alter table delivery_rounds enable row level security;
alter table stock_categories enable row level security;
alter table stock_items enable row level security;
alter table stock_par_levels enable row level security;

create policy ref_read_companies on companies for select using (true);
create policy ref_write_companies on companies for all using (auth_role()='owner') with check (auth_role()='owner');
create policy ref_read_branches on branches for select using (true);
create policy ref_write_branches on branches for all using (auth_role()='owner') with check (auth_role()='owner');
create policy ref_read_rent_hist on branch_rent_history for select using (true);
create policy ref_write_rent_hist on branch_rent_history for all using (auth_role()='owner') with check (auth_role()='owner');
create policy ref_read_wh_rent on warehouse_rent_history for select using (true);
create policy ref_write_wh_rent on warehouse_rent_history for all using (auth_role()='owner') with check (auth_role()='owner');
create policy ref_read_rounds on delivery_rounds for select using (true);
create policy ref_write_rounds on delivery_rounds for all using (auth_role()='owner') with check (auth_role()='owner');
create policy ref_read_cats on stock_categories for select using (true);
create policy ref_write_cats on stock_categories for all using (auth_role()='owner') with check (auth_role()='owner');
create policy ref_read_items on stock_items for select using (true);
create policy ref_write_items on stock_items for all using (auth_role()='owner') with check (auth_role()='owner');
create policy ref_read_par on stock_par_levels for select using (true);
create policy ref_write_par on stock_par_levels for all using (auth_role() in ('owner')) with check (auth_role()='owner');

-- ==============================================================
-- หมายเหตุสำคัญ: ไฟล์นี้ตั้งโครงตาราง + กติกาความปลอดภัยเท่านั้น ไม่ใส่ข้อมูลวัตถุดิบ/ระดับ par/5 สาขา/7 พนักงานจริง
-- ให้รันไฟล์ seed_reference_data.sql ต่อ (ข้อมูลจริงที่คัดลอกมาจาก STOCK_ITEMS/REAL_PAR/BRANCHES ในต้นแบบ)
-- ==============================================================
