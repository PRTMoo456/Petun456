-- ต้นทุนวัตถุดิบที่ส่งสาขา "นอกแอป" (เจ้าของสั่ง 1 ต.ค. 69) — รอบส่งของก่อนเริ่มใช้แอปจัดของ
-- เจ้าของกรอกยอดรวมตามราคาส่งสาขาของแต่ละรอบ ระบบนับเป็น "ต้นทุนวัตถุดิบ" ของสาขานั้นในหน้ากำไร/ขาดทุน
-- และนับเป็นยอดขายของคลังกลาง (ต้นทุนคลัง = ยอด × 90% ตามสูตรราคาส่งสาขา − 10%) · รันซ้ำได้ ไม่พัง
create table if not exists manual_deliveries (
  id            uuid primary key default gen_random_uuid(),
  branch_id     text not null references branches(id),
  delivery_date date not null,
  amount        numeric not null check (amount > 0),
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists manual_deliveries_date_idx on manual_deliveries(delivery_date);
alter table manual_deliveries enable row level security;
drop policy if exists manual_deliveries_owner on manual_deliveries;
create policy manual_deliveries_owner on manual_deliveries for all to authenticated
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
