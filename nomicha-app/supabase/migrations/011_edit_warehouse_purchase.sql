-- เจ้าของแก้วันที่ จำนวน และราคารวมของบิลนำเข้าที่กรอกผิดได้
-- บิลกับสต๊อกถูกปรับใน transaction เดียว และต้นทุนที่ snapshot ไว้ในรายการส่ง/ขายเดิมไม่ถูกเปลี่ยนย้อนหลัง

create or replace function edit_warehouse_purchase(
  p_purchase_id uuid,
  p_purchase_date date,
  p_case_qty int,
  p_total_price numeric
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_purchase purchases%rowtype;
  it stock_items%rowtype;
  ws warehouse_stock%rowtype;
  old_purchase_units numeric;
  new_purchase_units numeric;
  stock_units numeric;
  new_stock_units numeric;
  new_stock_value numeric;
  new_avg numeric;
  new_note text;
begin
  if auth_role() is distinct from 'owner'::user_role then raise exception 'เจ้าของเท่านั้นที่แก้บิลนำเข้าได้'; end if;
  if p_purchase_date is null then raise exception 'กรุณากรอกวันที่นำเข้า'; end if;
  if p_case_qty is null or p_case_qty <= 0 then raise exception 'จำนวนลังต้องมากกว่า 0'; end if;
  if p_total_price is null or p_total_price <= 0 then raise exception 'ราคารวมต้องมากกว่า 0'; end if;

  select * into old_purchase from purchases where id = p_purchase_id for update;
  if not found then raise exception 'ไม่พบบิลนำเข้าที่ต้องการแก้'; end if;
  select * into it from stock_items where id = old_purchase.item_id;
  select * into ws from warehouse_stock where item_id = old_purchase.item_id for update;
  if not found then raise exception 'ไม่พบสต๊อกคลังของวัตถุดิบนี้'; end if;

  old_purchase_units := old_purchase.case_qty * it.per_case;
  new_purchase_units := p_case_qty * it.per_case;
  stock_units := ws.case_qty * it.per_case + ws.loose_qty;
  new_stock_units := stock_units + new_purchase_units - old_purchase_units;
  if new_stock_units < 0 then raise exception 'ลดจำนวนไม่ได้ เพราะสต๊อกปัจจุบันมีไม่พอหักออก'; end if;

  -- เปลี่ยนมูลค่าสต๊อกปัจจุบันเฉพาะส่วนต่างของบิลนี้ รายการส่ง/ขายเดิมเก็บ cost snapshot จึงไม่ถูกแก้ย้อนหลัง
  new_stock_value := greatest(0, stock_units * ws.avg_cost + p_total_price - old_purchase.total_price);
  new_avg := case when new_stock_units > 0 then new_stock_value / new_stock_units else 0 end;
  new_note := case
    when old_purchase.note = 'บิลซื้อ' || it.name || ' ' || old_purchase.case_qty || ' ลัง'
      then 'บิลซื้อ' || it.name || ' ' || p_case_qty || ' ลัง'
    else old_purchase.note
  end;

  update warehouse_stock set
    case_qty = floor(new_stock_units / it.per_case)::int,
    loose_qty = mod(new_stock_units::int, it.per_case),
    avg_cost = round(new_avg, 2)
  where item_id = old_purchase.item_id;

  update purchases set
    purchase_date = p_purchase_date,
    case_qty = p_case_qty,
    total_price = p_total_price,
    cost_per_unit = round(p_total_price / new_purchase_units, 2),
    note = new_note
  where id = p_purchase_id;

  return jsonb_build_object(
    'stock_units', new_stock_units,
    'avg_cost', round(new_avg, 2),
    'cost_per_unit', round(p_total_price / new_purchase_units, 2),
    'unit', it.unit
  );
end $$;

revoke all on function edit_warehouse_purchase(uuid,date,int,numeric) from public;
grant execute on function edit_warehouse_purchase(uuid,date,int,numeric) to authenticated;
