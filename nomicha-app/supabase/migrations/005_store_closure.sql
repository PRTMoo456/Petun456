-- วันปิดร้าน: เก็บยอดต่อเนื่อง แต่ไม่ถือเป็นวันเปิดขาย
alter table daily_records
  add column if not exists store_closed boolean not null default false,
  add column if not exists closure_reason text,
  add column if not exists leave_quota_days int not null default 0;

alter table daily_records
  drop constraint if exists daily_records_leave_quota_days_check;
alter table daily_records
  add constraint daily_records_leave_quota_days_check check (leave_quota_days between 0 and 2);

-- พนักงานสาขาไม่สามารถสร้างสถานะปิดร้านเองได้
drop policy if exists staff_own_branch_records on daily_records;
create policy staff_own_branch_records on daily_records for all
  using (auth_role() in ('relief','owner') or branch_id = auth_branch())
  with check (auth_role() in ('relief','owner') or (branch_id = auth_branch() and not store_closed));
