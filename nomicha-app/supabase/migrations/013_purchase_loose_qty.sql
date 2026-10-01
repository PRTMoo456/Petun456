-- นำเข้าบิลซื้อเป็น "ลัง + ชิ้น" ได้ (เจ้าของสั่ง 1 ต.ค. 69)
-- เดิมบิลซื้อรับเฉพาะลังเต็ม · ตอนนี้กรอกลังอย่างเดียว ชิ้นอย่างเดียว หรือทั้งสองอย่างก็ได้ (รวมกันต้องมากกว่า 0)
-- ราคายังเป็น "ราคารวมที่จ่าย" เหมือนเดิม ระบบหารด้วยจำนวนชิ้นทั้งหมดเป็นต้นทุนต่อหน่วยเอง
-- บิลเก่าทั้งหมดไม่เปลี่ยน (ชิ้น = 0) · รันซ้ำได้ ไม่พัง

alter table purchases add column if not exists loose_qty int not null default 0;

alter table purchases drop constraint if exists purchases_positive;
alter table purchases add constraint purchases_positive check
  (case_qty >= 0 and loose_qty >= 0 and case_qty + loose_qty > 0 and total_price > 0 and cost_per_unit >= 0) not valid;

-- ข้อความจำนวนในหมายเหตุบิล เช่น "2 ลัง" · "5 ขวด" · "2 ลัง 5 ขวด"
create or replace function purchase_qty_label(p_case_qty int, p_loose_qty int, p_unit text)
returns text language sql immutable as $$
  select concat_ws(' ',
    case when coalesce(p_case_qty,0) > 0 then p_case_qty || ' ลัง' end,
    case when coalesce(p_loose_qty,0) > 0 then p_loose_qty || ' ' || p_unit end)
$$;

-- ---------- บันทึกบิลซื้อ ----------
drop function if exists record_warehouse_purchase(int,int,numeric,text);
create or replace function record_warehouse_purchase(
  p_item_id int, p_case_qty int, p_total_price numeric, p_note text default null, p_loose_qty int default 0
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare it stock_items%rowtype; ws warehouse_stock%rowtype; old_units numeric; add_units numeric; new_units numeric; new_avg numeric;
  c int := coalesce(p_case_qty,0); l int := coalesce(p_loose_qty,0); pid uuid;
begin
  if coalesce(auth_role()::text,'') not in ('relief','owner') then raise exception 'ไม่มีสิทธิ์บันทึกบิลซื้อ'; end if;
  if c < 0 or l < 0 then raise exception 'จำนวนลัง/ชิ้นติดลบไม่ได้'; end if;
  if c + l <= 0 then raise exception 'กรอกจำนวนลังหรือชิ้นอย่างน้อย 1'; end if;
  if p_total_price is null or p_total_price <= 0 then raise exception 'ราคารวมต้องมากกว่า 0'; end if;
  select * into it from stock_items where id=p_item_id and active for update;
  if not found then raise exception 'ไม่พบสินค้า'; end if;
  insert into warehouse_stock(item_id,case_qty,loose_qty,avg_cost) values(p_item_id,0,0,0) on conflict do nothing;
  select * into ws from warehouse_stock where item_id=p_item_id for update;
  old_units := ws.case_qty*it.per_case + ws.loose_qty;
  add_units := c*it.per_case + l;
  new_units := old_units + add_units;
  new_avg := (old_units*ws.avg_cost + p_total_price)/new_units;
  -- ชิ้นที่ครบลังรวมเป็นลังเต็มให้อัตโนมัติ
  update warehouse_stock set case_qty=floor(new_units/it.per_case)::int, loose_qty=mod(new_units::int,it.per_case),
    avg_cost=new_avg, last_checked=business_today() where item_id=p_item_id;
  insert into purchases(item_id,purchase_date,case_qty,loose_qty,total_price,cost_per_unit,note,created_by)
    values(p_item_id,business_today(),c,l,p_total_price,p_total_price/add_units,
      coalesce(p_note,'บิลซื้อ'||it.name||' '||purchase_qty_label(c,l,it.unit)),auth.uid())
    returning id into pid;
  return jsonb_build_object('purchase_id',pid,'avg_cost',new_avg,'added_units',add_units,'unit',it.unit);
end $$;
revoke all on function record_warehouse_purchase(int,int,numeric,text,int) from public;
grant execute on function record_warehouse_purchase(int,int,numeric,text,int) to authenticated;

-- ---------- เจ้าของแก้บิลซื้อย้อนหลัง ----------
drop function if exists edit_warehouse_purchase(uuid,date,int,numeric);
create or replace function edit_warehouse_purchase(
  p_purchase_id uuid, p_purchase_date date, p_case_qty int, p_total_price numeric, p_loose_qty int default 0
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_purchase purchases%rowtype; it stock_items%rowtype; ws warehouse_stock%rowtype;
  old_purchase_units numeric; new_purchase_units numeric; stock_units numeric; new_stock_units numeric;
  new_stock_value numeric; new_avg numeric; new_note text;
  c int := coalesce(p_case_qty,0); l int := coalesce(p_loose_qty,0);
begin
  if auth_role() is distinct from 'owner'::user_role then raise exception 'เจ้าของเท่านั้นที่แก้บิลนำเข้าได้'; end if;
  if p_purchase_date is null then raise exception 'กรุณากรอกวันที่นำเข้า'; end if;
  if c < 0 or l < 0 then raise exception 'จำนวนลัง/ชิ้นติดลบไม่ได้'; end if;
  if c + l <= 0 then raise exception 'กรอกจำนวนลังหรือชิ้นอย่างน้อย 1'; end if;
  if p_total_price is null or p_total_price <= 0 then raise exception 'ราคารวมต้องมากกว่า 0'; end if;

  select * into old_purchase from purchases where id = p_purchase_id for update;
  if not found then raise exception 'ไม่พบบิลนำเข้าที่ต้องการแก้'; end if;
  select * into it from stock_items where id = old_purchase.item_id;
  select * into ws from warehouse_stock where item_id = old_purchase.item_id for update;
  if not found then raise exception 'ไม่พบสต๊อกคลังของวัตถุดิบนี้'; end if;

  old_purchase_units := old_purchase.case_qty * it.per_case + coalesce(old_purchase.loose_qty,0);
  new_purchase_units := c * it.per_case + l;
  stock_units := ws.case_qty * it.per_case + ws.loose_qty;
  new_stock_units := stock_units + new_purchase_units - old_purchase_units;
  if new_stock_units < 0 then raise exception 'ลดจำนวนไม่ได้ เพราะสต๊อกปัจจุบันมีไม่พอหักออก'; end if;

  -- เปลี่ยนมูลค่าสต๊อกปัจจุบันเฉพาะส่วนต่างของบิลนี้ รายการส่ง/ขายเดิมเก็บ cost snapshot จึงไม่ถูกแก้ย้อนหลัง
  new_stock_value := greatest(0, stock_units * ws.avg_cost + p_total_price - old_purchase.total_price);
  new_avg := case when new_stock_units > 0 then new_stock_value / new_stock_units else 0 end;
  new_note := case
    when old_purchase.note = 'บิลซื้อ' || it.name || ' ' || purchase_qty_label(old_purchase.case_qty, coalesce(old_purchase.loose_qty,0), it.unit)
      then 'บิลซื้อ' || it.name || ' ' || purchase_qty_label(c, l, it.unit)
    else old_purchase.note
  end;

  update warehouse_stock set
    case_qty = floor(new_stock_units / it.per_case)::int,
    loose_qty = mod(new_stock_units::int, it.per_case),
    avg_cost = round(new_avg, 2)
  where item_id = old_purchase.item_id;

  update purchases set purchase_date = p_purchase_date, case_qty = c, loose_qty = l, total_price = p_total_price,
    cost_per_unit = round(p_total_price / new_purchase_units, 2), note = new_note
  where id = p_purchase_id;

  return jsonb_build_object('stock_units', new_stock_units, 'avg_cost', round(new_avg, 2),
    'cost_per_unit', round(p_total_price / new_purchase_units, 2), 'unit', it.unit);
end $$;
revoke all on function edit_warehouse_purchase(uuid,date,int,numeric,int) from public;
grant execute on function edit_warehouse_purchase(uuid,date,int,numeric,int) to authenticated;
