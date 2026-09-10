-- Require normal leave bookings to be made 3-28 days in advance.
-- Owners remain able to correct or override bookings through the owner tools.

drop policy if exists dayoff_staff_insert on public.day_offs;
create policy dayoff_staff_insert on public.day_offs
for insert to authenticated
with check (
  auth_role() = 'owner'
  or (
    auth_role() = 'staff'
    and branch_id = auth_branch()
    and off_date >= business_today() + 3
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
    and off_date >= business_today() + 3
    and off_date <= business_today() + 28
  )
);

comment on policy dayoff_staff_insert on public.day_offs is
  'Staff may book leave 3-28 days in advance; owner may override.';
comment on policy relief_dayoff_write on public.relief_day_offs is
  'Relief may book leave 3-28 days in advance; owner may override.';
