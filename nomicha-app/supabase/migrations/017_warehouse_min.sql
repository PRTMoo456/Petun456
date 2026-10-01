-- ขั้นต่ำคลังกลางรายสินค้า (หน่วยเล็กสุด) — เจ้าของสั่ง 1 ต.ค. 69
-- มีของในคลังต่ำกว่าค่านี้ = "ต้องสั่งเพิ่ม" · ว่างไว้ = ใช้กติกาเดิม (ลังเต็มเหลือ 0) · รันซ้ำได้
alter table stock_items add column if not exists wh_min int check (wh_min is null or wh_min >= 0);
update stock_items set wh_min = 10  where name = 'ถุงคู่';
update stock_items set wh_min = 5   where name = 'ผงโอวัลติน';
update stock_items set wh_min = 200 where name = 'คาร์เนชั่น นมจืด';
update stock_items set wh_min = 2   where name in ('ชาพีช', 'ชากุหลาบ', 'ชามะลิ');
