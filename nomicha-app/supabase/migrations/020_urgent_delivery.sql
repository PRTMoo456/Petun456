-- ส่งด่วนวันนี้ (นอกรอบ) — เจ้าของแจ้ง 9 ต.ค. 69 · รันซ้ำได้ ไม่พัง
-- ปัญหา: วันที่ไม่ใช่วันรอบ หัวหน้าเอาของที่ขาดไปส่งสาขาหนองหลุบ แต่หน้าส่งของบันทึกเป็น "รอบถัดไป" (ศุกร์ 9 ต.ค.)
--        พอถึงวันศุกร์จริง หนองหลุบขึ้น "ส่งแล้ว" ส่งของรอบจริงไม่ได้
-- แก้: ของส่งด่วนบันทึกเป็นวันที่ส่งจริง ไม่ผูกกับรอบ (round_id ว่าง) · แก้จำนวนทีหลังได้โดยไม่เกิดแถวซ้ำ

-- 1) ยืนยันส่งของ: ถ้ามีแถวเดิมอยู่แล้ว (รวมแถวส่งด่วนที่ round_id ว่าง) ให้อัปเดตแถวเดิม ไม่สร้างแถวใหม่ซ้ำ
create or replace function confirm_delivery(p_delivery_date date,p_branch_id text,p_round_id text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare oldrow deliveries%rowtype; e record; it stock_items%rowtype; ws warehouse_stock%rowtype;
  total_units int; q numeric; prices jsonb='{}'; costs jsonb='{}'; had_old boolean;
begin
  if coalesce(auth_role()::text,'') not in ('relief','owner') then raise exception 'ไม่มีสิทธิ์ยืนยันส่งของ'; end if;
  if p_delivery_date is null or not exists(select 1 from branches where id=p_branch_id and active) then raise exception 'สาขาหรือวันที่ไม่ถูกต้อง'; end if;
  if p_round_id is null and p_delivery_date <> business_today() and coalesce(auth_role()::text,'')<>'owner' then
    raise exception 'ส่งด่วนบันทึกได้เฉพาะวันนี้'; end if;
  select * into oldrow from deliveries where branch_id=p_branch_id and delivery_date=p_delivery_date and round_id is not distinct from p_round_id
    order by created_at limit 1 for update;
  had_old := found;
  if had_old then
    for e in select key,value from jsonb_each_text(oldrow.items) loop
      select * into it from stock_items where id=e.key::int; select * into ws from warehouse_stock where item_id=it.id for update;
      total_units := ws.case_qty*it.per_case+ws.loose_qty+e.value::int;
      update warehouse_stock set case_qty=total_units/it.per_case,loose_qty=mod(total_units,it.per_case) where item_id=it.id;
    end loop;
  end if;
  for e in select key,value from jsonb_each_text(coalesce(p_items,'{}')) loop
    q:=e.value::numeric; if q<0 or q<>trunc(q) then raise exception 'จำนวนส่งต้องเป็นจำนวนเต็มตั้งแต่ 0'; end if;
    select * into it from stock_items where id=e.key::int and active; if not found then raise exception 'ไม่พบสินค้า %',e.key; end if;
    select * into ws from warehouse_stock where item_id=it.id for update; if not found then raise exception 'ยังไม่มีสต๊อก %',it.name; end if;
    total_units:=ws.case_qty*it.per_case+ws.loose_qty;
    if total_units<q then raise exception '% มีไม่พอ (เหลือ %)',it.name,total_units; end if;
    total_units:=total_units-q;
    update warehouse_stock set case_qty=total_units/it.per_case,loose_qty=mod(total_units,it.per_case) where item_id=it.id;
    prices:=prices||jsonb_build_object(e.key,coalesce(oldrow.price_snapshot->e.key,to_jsonb(it.branch_price)));
    costs:=costs||jsonb_build_object(e.key,coalesce(oldrow.cost_snapshot->e.key,to_jsonb(ws.avg_cost)));
  end loop;
  if had_old then
    update deliveries set items=coalesce(p_items,'{}'),price_snapshot=prices,cost_snapshot=costs,packed_by=auth.uid(),received=null,received_at=null
      where id=oldrow.id;
  else
    insert into deliveries(delivery_date,branch_id,round_id,items,price_snapshot,cost_snapshot,packed_by)
      values(p_delivery_date,p_branch_id,p_round_id,coalesce(p_items,'{}'),prices,costs,auth.uid());
  end if;
  return jsonb_build_object('saved',true);
end $$;
revoke all on function confirm_delivery(date,text,text,jsonb) from public;
grant execute on function confirm_delivery(date,text,text,jsonb) to authenticated;

-- 2) แก้ข้อมูลที่บันทึกผิดไปแล้ว: ของที่ส่งหนองหลุบนอกรอบ แต่ไปลงเป็นรอบศุกร์ 9 ต.ค. 69
--    ย้ายกลับไปเป็น "ส่งด่วน" ของวันที่กดยืนยันจริง (ตามเวลาไทย) — ของที่ส่งไปแล้ว/สต๊อกคลังไม่เปลี่ยน
--    แตะเฉพาะแถวที่กดยืนยันก่อนวันที่ 9 ต.ค. เท่านั้น · แถวที่ส่งในวันศุกร์จริงไม่ถูกแตะ · รันซ้ำแล้วไม่มีอะไรเปลี่ยน
update deliveries d
   set delivery_date = (d.created_at at time zone 'Asia/Bangkok')::date,
       round_id = null
 where d.branch_id = 'nlb'
   and d.delivery_date = date '2026-10-09'
   and d.round_id is not null
   and (d.created_at at time zone 'Asia/Bangkok')::date < date '2026-10-09'
returning d.id, d.delivery_date as moved_to, d.items;
