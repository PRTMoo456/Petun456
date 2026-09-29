-- เปลี่ยนกติกาจองวันหยุดล่วงหน้าจาก 3–28 วัน เป็น 4–28 วัน (เจ้าของสั่ง 29 ก.ย. 69)
-- ใช้ทั้งพนักงานสาขา (day_offs) และหัวหน้า (relief_day_offs) · เจ้าของยังแก้/จองแทนได้ทุกวันเหมือนเดิม
-- ต้องตรงกับ LEAVE_MIN_DAYS / LEAVE_MAX_DAYS ใน src/dayoff.js
-- วันหยุดที่จองไว้แล้วก่อนหน้านี้ไม่ถูกแตะ (policy นี้ตรวจเฉพาะตอนจองใหม่)

drop policy if exists dayoff_staff_insert on public.day_offs;
create policy dayoff_staff_insert on public.day_offs
for insert to authenticated
with check (
  auth_role() = 'owner'
  or (
    auth_role() = 'staff'
    and branch_id = auth_branch()
    and off_date >= business_today() + 4
    and off_date <= business_today() + 28
  )
);

drop policy if exists relief_dayoff_write on public.relief_day_offs;
create policy relief_dayoff_write on public.relief_day_offs
for insert to authenticated
with check (
  auth_role() = 'owner'
  or (
    auth_role() = 'relief'
    and off_date >= business_today() + 4
    and off_date <= business_today() + 28
  )
);

comment on policy dayoff_staff_insert on public.day_offs is
  'Staff may book leave 4-28 days in advance; owner may override.';
comment on policy relief_dayoff_write on public.relief_day_offs is
  'Relief may book leave 4-28 days in advance; owner may override.';
