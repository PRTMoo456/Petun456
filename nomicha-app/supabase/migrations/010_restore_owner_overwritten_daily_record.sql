-- Restore the Bandit 2026-09-26 record from the last owner-confirmed snapshot
-- that existed immediately before migration 009 incorrectly converted it to a closure.
-- Also records the repair in record_edit_history for auditability.
do $$
declare
  v_id uuid := '4e98b714-b7db-465b-b35b-6b915ce39915';
  v_snap jsonb;
  v_before daily_records%rowtype;
  v_after daily_records%rowtype;
  s daily_records%rowtype;
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

  select h.to_value::jsonb into v_snap
  from record_edit_history h
  where h.record_id = v_id
    and h.field = 'multiple'
    and h.label = 'แก้ข้อมูลที่กรอกผิด'
    and h.edited_at < timestamptz '2026-09-27 17:22:22+00'
  order by h.edited_at desc
  limit 1;

  if v_snap is null then
    raise exception 'ไม่พบ snapshot ที่เจ้าของยืนยันก่อนถูกระบบทับ';
  end if;

  select * into s
  from jsonb_populate_record(null::daily_records, v_snap);

  update daily_records
  set
    staff_name = s.staff_name,
    open_yen = s.open_yen,
    open_pan = s.open_pan,
    yen = s.yen,
    yen_add = s.yen_add,
    pan = s.pan,
    pan_add = s.pan_add,
    cup_own = s.cup_own,
    topping = s.topping,
    other = s.other,
    ice = s.ice,
    water = s.water,
    etc = s.etc,
    cash = s.cash,
    transfer = s.transfer,
    grab = s.grab,
    thaichaithai = s.thaichaithai,
    float_cash = s.float_cash,
    stock_snapshot = s.stock_snapshot,
    cup_price_yen = s.cup_price_yen,
    cup_price_pan = s.cup_price_pan,
    grab_commission_pct = s.grab_commission_pct,
    sent = s.sent,
    closed = s.closed,
    store_closed = false,
    closure_reason = null,
    leave_quota_days = 0,
    created_by = s.created_by,
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
    'กู้ยอดเจ้าของที่ถูกระบบทับ',
    'กู้ยอดบัณฑิต 26/09/2026 จาก snapshot ล่าสุดที่เจ้าของยืนยันก่อน reconcile ผิดพลาด',
    auth.uid()
  );
end $$;

-- Verification: this must return one normal sent record, not a closure.
select
  branch_id, record_date, staff_name,
  open_yen, yen, yen_add, open_pan, pan, pan_add,
  cup_own, topping, other, ice, water, etc,
  cash, transfer, grab, thaichaithai, float_cash,
  sent, closed, store_closed, closure_reason, leave_quota_days
from daily_records
where id = '4e98b714-b7db-465b-b35b-6b915ce39915';
