-- ใช้ราคาซื้อจริงเป็นต้นทุนเพียงแหล่งเดียว ไม่ประมาณจากราคาส่งสาขาอีกต่อไป
delete from settings where key = 'cost_discount_pct';

-- ล้างเฉพาะต้นทุนประมาณการของสินค้าที่ยังไม่เคยมีบิลซื้อ
-- รายการที่มี purchases แล้วจะเก็บต้นทุนเฉลี่ยจริงเดิมไว้
update warehouse_stock ws
set avg_cost = 0
where not exists (
  select 1 from purchases p where p.item_id = ws.item_id
);
