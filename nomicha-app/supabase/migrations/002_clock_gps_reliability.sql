-- แก้การบันทึกลงเวลาด้วย GPS สำหรับฐานข้อมูลที่สร้างไว้ก่อน 7 ก.ย. 2569
begin;

alter table public.clock_records
  add column if not exists in_distance_m int,
  add column if not exists out_distance_m int;

create or replace function public.auth_role() returns user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.employees where id = auth.uid();
$$;
create or replace function public.auth_branch() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select branch_id from public.employees where id = auth.uid();
$$;

revoke all on function public.auth_role() from public;
revoke all on function public.auth_branch() from public;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.auth_branch() to authenticated;

drop policy if exists staff_own_branch_clock on public.clock_records;
create policy staff_own_branch_clock on public.clock_records for all
  using (public.auth_role() in ('relief','owner') or branch_id = public.auth_branch())
  with check (public.auth_role() in ('relief','owner') or branch_id = public.auth_branch());

commit;
