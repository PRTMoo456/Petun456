-- 1 ต.ค. 69 (เจ้าของสั่ง) · รันซ้ำได้ ไม่พัง
--
-- 1) "ส่งทีละ" ต่อรายการวัตถุดิบ — ตอนจัดของไปสาขา ถ้าขาด จะปัดจำนวนที่ต้องส่งขึ้นเป็นทวีคูณของค่านี้
--    เช่น โซดาร๊อค ระดับต่อรอบ 10 ขวด ส่งทีละ 12 → เหลือต่ำกว่า 10 เมื่อไร จัดไป 12 ขวด (ขาดเกิน 12 จัด 24)
--    ค่าเริ่มต้น 1 = ส่งตามที่ขาดพอดีเหมือนเดิม
alter table stock_items add column if not exists ship_pack int not null default 1;
alter table stock_items drop constraint if exists stock_items_ship_pack_positive;
alter table stock_items add constraint stock_items_ship_pack_positive check (ship_pack >= 1);
update stock_items set ship_pack = 12 where name = 'โซดาร๊อค';

-- 2) ยกเลิกค่าปรับ "ลืมลงเวลา" — ไม่ลงเวลาเข้าก็เริ่มงาน/กรอกแก้วตอนจบงานไม่ได้อยู่แล้ว
--    (หน้าเว็บไม่ใช้ค่านี้แล้ว ลบออกจากตั้งค่าให้ไม่ค้างในหน้าตั้งค่า)
update settings set value = value - 'noClock' where key = 'pay_rules' and value ? 'noClock';
