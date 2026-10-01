// ทดสอบฟังก์ชันในฐานข้อมูลด้วย Postgres จริง (schema.sql + migrations ตัวเดียวกับที่ติดตั้งบน Supabase)
// รันด้วย: node test/run-db.mjs
import { makePg, asUser } from './pgdb.mjs';

const fails = [];
const check = (name, cond, detail) => { if (!cond) fails.push(`${name}: ${detail}`); };

console.log('\n=== ทดสอบฟังก์ชันฐานข้อมูลด้วย Postgres จริง ===');
const pg = await makePg();

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';
await pg.exec(`
  insert into auth.users(id) values ('${OWNER}'), ('${STAFF}');
  insert into employees(id, username, name, role, branch_id) values
    ('${OWNER}', 'owner', 'เจ้าของ', 'owner', null),
    ('${STAFF}', 'bandit', 'พนักงานบัณฑิต', 'staff', 'bdt');
`);
const day = n => `business_today() - ${n}`;
const getRec = async (n) => (await pg.query(`select * from daily_records where branch_id='bdt' and record_date=${day(n)}`)).rows[0];

// ---------- 1. วันหยุดไม่มีคนแทน — ห้ามระบบอัตโนมัติทับยอดที่เจ้าของกรอกไว้ (บั๊กบัณฑิต 26 ก.ย. 69) ----------
{
  // D-6: ยอดปกติที่ส่งแล้ว (ใช้เป็นยอดยกมา)
  // D-5: วันหยุด + ไม่มีลงเวลา + เจ้าของกรอกยอดขายจริงย้อนหลังไว้แล้ว  → ต้องไม่ถูกแตะ
  // D-4: วันหยุด + ไม่มีลงเวลา + ยังไม่มียอด                           → ระบบสร้างวันปิดร้าน ยกยอดจาก D-5
  // D-3: วันหยุด + มีคนลงเวลา (หัวหน้าไปแทน) + ยังไม่มียอด             → ต้องไม่สร้างอะไร
  await pg.exec(`
    insert into daily_records(branch_id, record_date, staff_name, open_yen, open_pan, yen, pan, cash, float_cash, stock_snapshot, sent, closed)
      values ('bdt', ${day(6)}, 'พนักงานบัณฑิต', 80, 40, 60, 30, 900, 300, '{"2": 5}', true, true);
    insert into daily_records(branch_id, record_date, staff_name, open_yen, open_pan, yen, pan, cash, transfer, grab, ice, float_cash, stock_snapshot, sent, closed, created_by)
      values ('bdt', ${day(5)}, 'เจ้าของกรอกแทน', 60, 30, 20, 10, 1500, 420, 180, 60, 300, '{"2": 4}', true, true, '${OWNER}');
    insert into day_offs(off_date, branch_id) values (${day(5)}, 'bdt'), (${day(4)}, 'bdt'), (${day(3)}, 'bdt');
    insert into clock_records(branch_id, clock_date, staff_name, time_in) values ('bdt', ${day(3)}, 'ขวัญ', '08:00');
  `);
  const before = await getRec(5);

  const r1 = (await asUser(pg, OWNER, 'select owner_reconcile_unstaffed_leave_days() as r')).rows[0].r;
  const after = await getRec(5);
  const same = ['staff_name', 'yen', 'pan', 'cash', 'transfer', 'grab', 'ice', 'float_cash', 'store_closed', 'closure_reason']
    .filter(f => String(before[f]) !== String(after[f]));
  check('ยอดที่เจ้าของกรอกไว้ต้องไม่ถูกทับ', same.length === 0 && after.id === before.id,
    `ช่องที่ถูกเปลี่ยน: ${same.map(f => `${f} ${before[f]}→${after[f]}`).join(', ')}`);
  check('ไม่สร้างประวัติแก้ไขปลอมให้วันที่เจ้าของกรอก',
    (await pg.query(`select count(*)::int n from record_edit_history where record_id = $1`, [before.id])).rows[0].n === 0,
    'มีประวัติแก้ไขเพิ่มขึ้น แปลว่าระบบไปแตะรายการนี้');

  const closed = await getRec(4);
  check('วันหยุดที่ยังไม่มียอด ต้องถูกบันทึกเป็นปิดร้าน', closed && closed.store_closed && closed.closure_reason === 'approved_leave' && closed.leave_quota_days === 1,
    closed ? `store_closed=${closed.store_closed} reason=${closed.closure_reason}` : 'ไม่มีรายการเกิดขึ้น');
  if (closed) {
    check('ยกแก้ว/เงินทอน/สต๊อกจากวันก่อน', closed.open_yen === 20 && closed.yen === 20 && closed.pan === 10 && Number(closed.float_cash) === 300 && closed.stock_snapshot['2'] === 4,
      `ได้ แก้วเย็น ${closed.open_yen}/${closed.yen} แก้วปั่น ${closed.pan} เงินทอน ${closed.float_cash} สต๊อก ${JSON.stringify(closed.stock_snapshot)}`);
    check('วันปิดร้านยอดขายเป็น 0', Number(closed.transfer) === 0 && Number(closed.grab) === 0 && Number(closed.cash) === 300,
      `โอน ${closed.transfer} แกร๊บ ${closed.grab} เงินสด ${closed.cash}`);
  }
  check('วันที่มีคนลงเวลา ห้ามสร้างวันปิดร้าน', !(await getRec(3)), 'มีรายการปิดร้านทั้งที่มีคนมาทำงาน');
  check('รายงานจำนวนที่ปรับถูกต้อง', r1.changed === 1, `ได้ changed=${r1.changed}`);

  const r2 = (await asUser(pg, OWNER, 'select owner_reconcile_unstaffed_leave_days() as r')).rows[0].r;
  check('รันซ้ำต้องไม่เปลี่ยนอะไรเพิ่ม', r2.changed === 0, `รอบสองเปลี่ยนอีก ${r2.changed} รายการ`);

  let staffErr = null;
  try { await asUser(pg, STAFF, 'select owner_reconcile_unstaffed_leave_days()'); } catch (e) { staffErr = e.message; }
  check('พนักงานเรียกฟังก์ชันนี้ไม่ได้', staffErr && /เจ้าของเท่านั้น/.test(staffErr), `ได้ ${staffErr || 'เรียกได้'}`);
  console.log('✓ วันหยุดไม่มีคนแทน — ไม่ทับยอดที่เจ้าของกรอก · เติมวันปิดร้านเฉพาะวันที่ยังไม่มียอด · รันซ้ำได้');
}

// ---------- 2. กติกาจองวันหยุด 4–28 วัน บังคับที่ฐานข้อมูล (ไม่ใช่แค่ซ่อนปุ่ม) ----------
{
  const { rows } = await pg.query(`select policyname, pg_get_expr(polwithcheck, polrelid) as chk
    from pg_policy p join pg_policies v on v.policyname = p.polname
    where p.polname in ('dayoff_staff_insert', 'relief_dayoff_write')`);
  check('มี policy จองวันหยุดครบ 2 ตัว', rows.length === 2, `พบ ${rows.length}`);
  rows.forEach(r => {
    check(`${r.policyname} ขั้นต่ำ 4 วัน`, /business_today\(\) \+ 4/.test(r.chk), r.chk);
    check(`${r.policyname} สูงสุด 28 วัน`, /business_today\(\) \+ 28/.test(r.chk), r.chk);
  });
  console.log('✓ จองวันหยุด 4–28 วัน — บังคับที่ฐานข้อมูลทั้งพนักงานและหัวหน้า');
}

// ---------- 3. บิลซื้อเข้าคลังเป็น ลัง + ชิ้น (1 ต.ค. 69) ----------
{
  const it = (await pg.query(`select * from stock_items where id = 41`)).rows[0]; // โซดาร๊อค 1 ลัง = 24 ขวด
  const units = async () => { const w = (await pg.query(`select * from warehouse_stock where item_id = 41`)).rows[0]; return w ? w.case_qty * it.per_case + w.loose_qty : 0; };
  const u0 = await units();
  const r1 = (await asUser(pg, OWNER, `select record_warehouse_purchase(41, 1, 300, null, 30) as r`)).rows[0].r;
  const w1 = (await pg.query(`select * from warehouse_stock where item_id = 41`)).rows[0];
  check('ลัง+ชิ้นเพิ่มสต๊อกครบ', (await units()) === u0 + 54, `ได้ ${await units()} คาด ${u0 + 54}`);
  check('ชิ้นที่ครบลังรวมเป็นลังเต็ม', w1.loose_qty < it.per_case, `ชิ้นเศษ ${w1.loose_qty}`);
  check('คืนจำนวนที่เพิ่ม', Number(r1.added_units) === 54, JSON.stringify(r1));
  const p1 = (await pg.query(`select * from purchases where id = $1`, [r1.purchase_id])).rows[0];
  check('บิลเก็บลัง/ชิ้นแยก', p1.case_qty === 1 && p1.loose_qty === 30, `ลัง ${p1.case_qty} ชิ้น ${p1.loose_qty}`);
  check('ต้นทุนต่อหน่วย = ราคารวม ÷ ชิ้นรวม', Math.abs(Number(p1.cost_per_unit) - 300 / 54) < 0.001, p1.cost_per_unit);
  check('หมายเหตุอัตโนมัติ', p1.note === 'บิลซื้อโซดาร๊อค 1 ลัง 30 ขวด', p1.note);

  // ชิ้นอย่างเดียว
  const r2 = (await asUser(pg, OWNER, `select record_warehouse_purchase(41, 0, 50, null, 10) as r`)).rows[0].r;
  check('นำเข้าชิ้นอย่างเดียวได้', (await units()) === u0 + 64, `ได้ ${await units()}`);
  // แบบเดิม (ไม่ส่งช่องชิ้น) ยังใช้ได้
  await asUser(pg, OWNER, `select record_warehouse_purchase(41, 2, 200, 'บิลเก่า') as r`);
  check('เรียกแบบเดิม (ลังอย่างเดียว) ยังใช้ได้', (await units()) === u0 + 112, `ได้ ${await units()}`);
  let err = null;
  try { await asUser(pg, OWNER, `select record_warehouse_purchase(41, 0, 50, null, 0)`); } catch (e) { err = e.message; }
  check('กัน 0 ลัง 0 ชิ้น', err && /อย่างน้อย 1/.test(err), err || 'บันทึกได้');

  // เจ้าของแก้บิล: 1 ลัง 30 ขวด → 0 ลัง 6 ขวด
  const before = await units();
  const e1 = (await asUser(pg, OWNER, `select edit_warehouse_purchase($1, business_today(), 0, 60, 6) as r`, [r1.purchase_id])).rows[0].r;
  const p1b = (await pg.query(`select * from purchases where id = $1`, [r1.purchase_id])).rows[0];
  check('แก้บิลปรับสต๊อกตามส่วนต่าง', (await units()) === before - 48 && Number(e1.stock_units) === before - 48, `ได้ ${await units()} คาด ${before - 48}`);
  check('แก้บิลแล้วหมายเหตุตามจำนวนใหม่', p1b.note === 'บิลซื้อโซดาร๊อค 6 ขวด' && p1b.loose_qty === 6 && p1b.case_qty === 0, `${p1b.note} / ${p1b.case_qty} / ${p1b.loose_qty}`);
  check('ต้นทุนบิลแก้แล้ว = 60 ÷ 6', Number(p1b.cost_per_unit) === 10, p1b.cost_per_unit);
  console.log('✓ บิลซื้อเป็นลัง+ชิ้น — เพิ่ม/แก้สต๊อกและต้นทุนถูกต้อง · แบบเดิมยังใช้ได้');
}

// ---------- 4. migration 014: ส่งทีละ + ลบค่าปรับลืมลงเวลาออกจากตั้งค่า ----------
{
  const soda = (await pg.query(`select ship_pack from stock_items where name = 'โซดาร๊อค'`)).rows[0];
  const others = (await pg.query(`select count(*)::int n from stock_items where name <> 'โซดาร๊อค' and ship_pack <> 1`)).rows[0].n;
  check('โซดาส่งทีละ 12', soda && soda.ship_pack === 12, JSON.stringify(soda));
  check('รายการอื่นส่งทีละ 1', others === 0, `มี ${others} รายการที่ไม่ใช่ 1`);
  let err = null; try { await pg.exec(`update stock_items set ship_pack = 0 where id = 0`); } catch (e) { err = e.message; }
  check('ส่งทีละ 0 ไม่ได้', !!err, 'ยอมให้ตั้ง 0');
  console.log('✓ ส่งทีละ — โซดา 12 ขวด รายการอื่น 1 · กันค่า 0');
}

// ---------- 5. ต้นทุนส่งนอกแอป: เจ้าของเท่านั้น ----------
{
  await asUser(pg, OWNER, `insert into manual_deliveries(branch_id, delivery_date, amount) values ('bdt', '2026-09-15', 1200)`);
  const n = (await pg.query(`select count(*)::int n from manual_deliveries`)).rows[0].n;
  const pol = (await pg.query(`select relrowsecurity r from pg_class where relname = 'manual_deliveries'`)).rows[0];
  const qual = (await pg.query(`select pg_get_expr(polqual, polrelid) q from pg_policy where polname = 'manual_deliveries_owner'`)).rows[0];
  check('บันทึกต้นทุนนอกแอปได้', n === 1, `ได้ ${n}`);
  check('ตารางเปิด RLS และเฉพาะเจ้าของ', pol?.r === true && /owner/.test(qual?.q || ''), JSON.stringify({ pol, qual }));
  console.log('✓ ต้นทุนส่งนอกแอป — ตารางสร้างได้ เจ้าของบันทึกได้');
}

// ---------- 6. migration 017: ขั้นต่ำคลังกลาง ----------
{
  const rows = (await pg.query(`select name, wh_min from stock_items where wh_min is not null order by name`)).rows;
  const m = Object.fromEntries(rows.map(r => [r.name, r.wh_min]));
  check('ตั้งขั้นต่ำครบ 6 รายการ', rows.length === 6 && m['ถุงคู่'] === 10 && m['ผงโอวัลติน'] === 5 && m['คาร์เนชั่น นมจืด'] === 200 && m['ชาพีช'] === 2 && m['ชากุหลาบ'] === 2 && m['ชามะลิ'] === 2, JSON.stringify(m));
  console.log('✓ ขั้นต่ำคลังกลาง — ถุงคู่ 10 · โอวัลติน 5 · นมจืด 200 · ชาพีช/กุหลาบ/มะลิ 2');
}

console.log('');
if (fails.length) { console.log('✗ ไม่ผ่าน ' + fails.length + ' ข้อ:'); fails.forEach(f => console.log('   • ' + f)); }
else console.log('✓✓ ผ่านทุกข้อ');
process.exit(fails.length ? 1 : 0);
