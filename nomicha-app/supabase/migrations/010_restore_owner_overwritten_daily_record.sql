-- Repair Bandit 2026-09-26 as the real personal-leave/no-substitute closure.
-- IMPORTANT: do not turn this day back into a normal work/sales record.
-- The business rule is: carry forward only continuity values from 2026-09-25,
-- while all sales/income/expense/additions are zero and the day remains closed.
do $$
declare
  v_id uuid := '4e98b714-b7db-465b-b35b-6b915ce39915';
  v_prev daily_records%rowtype;
  v_before daily_records%rowtype;
  v_after daily_records%rowtype;
begin
  select * into v_before
  from daily_records
  where id = v_id
    and branch_id = 'bdt'
    and record_date = date '2026-09-26'
  for update;

  if not found then
    raise exception 'ไม่พบรายการบัณฑิตวันที่ 26/09/2026';
  end if;

  select * into v_prev
  from daily_records
  where branch_id = 'bdt'
    and record_date < date '2026-09-26'
    and sent = true
  order by record_date desc
  limit 1;

  if not found then
    raise exception 'ไม่พบยอดก่อนวันที่ 26/09/2026 สำหรับยกยอดต่อ';
  end if;

  update daily_records
  set
    staff_name = 'ปิดร้าน',
    open_yen = v_prev.yen,
    open_pan = v_prev.pan,
    yen = v_prev.yen,
    yen_add = 0,
    pan = v_prev.pan,
    pan_add = 0,
    cup_own = 0,
    topping = 0,
    other = 0,
    ice = 0,
    water = 0,
    etc = 0,
    cash = v_prev.float_cash,
    transfer = 0,
    grab = 0,
    thaichaithai = 0,
    float_cash = v_prev.float_cash,
    stock_snapshot = v_prev.stock_snapshot,
    sent = true,
    closed = true,
    store_closed = true,
    closure_reason = 'approved_leave',
    leave_quota_days = 1,
    updated_at = now()
  where id = v_id
  returning * into v_after;

  insert into record_edit_history(
    record_id, field, from_value, to_value, label, reason, edited_by
  ) values (
    v_id,
    'multiple',
    to_jsonb(v_before)::text,
    to_jsonb(v_after)::text,
    'แก้วันหยุดไม่มีคนแทนให้ยกยอดถูกต้อง',
    'บัณฑิต 26/09/2026 เป็นวันหยุดส่วนตัวไม่มีคนแทน: ยกแก้ว/เงินทอน/สต๊อกจากวันก่อนหน้าเท่านั้น และยอดขาย/โอน/Grab/รายรับรายจ่ายเป็น 0',
    auth.uid()
  );
end $$;

-- Verification: must stay a closure and carry 25/09 continuity values.
select
  branch_id, record_date, staff_name,
  open_yen, yen, yen_add, open_pan, pan, pan_add,
  cup_own, topping, other, ice, water, etc,
  cash, transfer, grab, thaichaithai, float_cash,
  sent, closed, store_closed, closure_reason, leave_quota_days
from daily_records
where id = '4e98b714-b7db-465b-b35b-6b915ce39915';
