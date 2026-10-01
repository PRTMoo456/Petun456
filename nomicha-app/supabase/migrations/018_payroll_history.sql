-- เก็บค่าที่ใช้คำนวณเงินเดือนแยกตามเดือน เพื่อให้การแก้ค่าเดือนใหม่ไม่ย้อนเปลี่ยนเดือนเก่า
-- ค่าใหม่มีผลกับทั้งเดือนที่แก้ ส่วนเดือนก่อนหน้ายังคงใช้ค่าที่บันทึกไว้เดิม

create table if not exists payroll_employee_history (
  employee_id    uuid not null references employees(id) on delete cascade,
  effective_month date not null check (effective_month = date_trunc('month', effective_month)::date),
  base_salary    numeric not null default 0,
  delivery_pay   numeric not null default 0,
  start_date     date,
  recorded_at    timestamptz not null default now(),
  primary key (employee_id, effective_month)
);

create table if not exists payroll_branch_history (
  branch_id       text not null references branches(id) on delete cascade,
  effective_month date not null check (effective_month = date_trunc('month', effective_month)::date),
  days_off_quota  int not null default 0,
  recorded_at     timestamptz not null default now(),
  primary key (branch_id, effective_month)
);

create table if not exists payroll_rules_history (
  effective_month  date primary key check (effective_month = date_trunc('month', effective_month)::date),
  diligence_rules  jsonb not null,
  holiday_pay_scale jsonb not null,
  pay_rules         jsonb not null,
  recorded_at       timestamptz not null default now()
);

alter table payroll_employee_history enable row level security;
alter table payroll_branch_history enable row level security;
alter table payroll_rules_history enable row level security;

drop policy if exists payroll_employee_history_read on payroll_employee_history;
create policy payroll_employee_history_read on payroll_employee_history for select to authenticated
  using (auth_role() = 'owner' or employee_id = auth.uid());
drop policy if exists payroll_branch_history_read on payroll_branch_history;
create policy payroll_branch_history_read on payroll_branch_history for select to authenticated using (true);
drop policy if exists payroll_rules_history_read on payroll_rules_history;
create policy payroll_rules_history_read on payroll_rules_history for select to authenticated using (true);

-- ระบบจริงเริ่มมีรายการเดือน ก.ย. 69; ถ้ามีข้อมูลเก่ากว่านั้นให้เริ่มจากเดือนแรกที่พบ
do $$
declare first_month date := coalesce(
  (select date_trunc('month', min(record_date))::date from daily_records),
  date_trunc('month', business_today())::date
);
begin
  insert into payroll_employee_history(employee_id,effective_month,base_salary,delivery_pay,start_date)
    select id, first_month, coalesce(base_salary,0), coalesce(delivery_pay,0), start_date from employees
    on conflict (employee_id,effective_month) do nothing;
  insert into payroll_branch_history(branch_id,effective_month,days_off_quota)
    select id, first_month, days_off_quota from branches
    on conflict (branch_id,effective_month) do nothing;
  insert into payroll_rules_history(effective_month,diligence_rules,holiday_pay_scale,pay_rules)
    values (
      first_month,
      coalesce((select value from settings where key='diligence_rules'), '{"step":500,"cap":1500,"lateAllowance":250}'::jsonb),
      coalesce((select value from settings where key='holiday_pay_scale'), '[400,450,500,550]'::jsonb),
      coalesce((select value from settings where key='pay_rules'), '{"cupPay":1,"latePerMin":1,"earlyPerMin":1,"excessDayOff":330}'::jsonb)
    ) on conflict (effective_month) do nothing;
end $$;

create or replace function capture_employee_payroll_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into payroll_employee_history(employee_id,effective_month,base_salary,delivery_pay,start_date)
  values (new.id,date_trunc('month',business_today())::date,coalesce(new.base_salary,0),coalesce(new.delivery_pay,0),new.start_date)
  on conflict (employee_id,effective_month) do update set
    base_salary=excluded.base_salary, delivery_pay=excluded.delivery_pay,
    start_date=excluded.start_date, recorded_at=now();
  return new;
end $$;

drop trigger if exists employees_payroll_history on employees;
create trigger employees_payroll_history after insert or update of base_salary,delivery_pay,start_date on employees
for each row execute function capture_employee_payroll_history();

create or replace function capture_branch_payroll_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into payroll_branch_history(branch_id,effective_month,days_off_quota)
  values (new.id,date_trunc('month',business_today())::date,new.days_off_quota)
  on conflict (branch_id,effective_month) do update set
    days_off_quota=excluded.days_off_quota, recorded_at=now();
  return new;
end $$;

drop trigger if exists branches_payroll_history on branches;
create trigger branches_payroll_history after insert or update of days_off_quota on branches
for each row execute function capture_branch_payroll_history();

create or replace function capture_payroll_rules_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.key not in ('diligence_rules','holiday_pay_scale','pay_rules') then return new; end if;
  insert into payroll_rules_history(effective_month,diligence_rules,holiday_pay_scale,pay_rules)
  values (
    date_trunc('month',business_today())::date,
    coalesce((select value from settings where key='diligence_rules'), '{"step":500,"cap":1500,"lateAllowance":250}'::jsonb),
    coalesce((select value from settings where key='holiday_pay_scale'), '[400,450,500,550]'::jsonb),
    coalesce((select value from settings where key='pay_rules'), '{"cupPay":1,"latePerMin":1,"earlyPerMin":1,"excessDayOff":330}'::jsonb)
  ) on conflict (effective_month) do update set
    diligence_rules=excluded.diligence_rules, holiday_pay_scale=excluded.holiday_pay_scale,
    pay_rules=excluded.pay_rules, recorded_at=now();
  return new;
end $$;

drop trigger if exists settings_payroll_history on settings;
create trigger settings_payroll_history after insert or update of value on settings
for each row execute function capture_payroll_rules_history();

comment on table payroll_employee_history is 'ประวัติเงินเดือนฐาน/เงินส่งของที่ใช้คำนวณแต่ละเดือน';
comment on table payroll_branch_history is 'ประวัติโควตาวันหยุดของสาขาที่ใช้คำนวณแต่ละเดือน';
comment on table payroll_rules_history is 'ประวัติกติกาค่าแก้ว เบี้ยขยัน มาสาย และวันหยุดที่ใช้คำนวณแต่ละเดือน';
