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

console.log('');
if (fails.length) { console.log('✗ ไม่ผ่าน ' + fails.length + ' ข้อ:'); fails.forEach(f => console.log('   • ' + f)); }
else console.log('✓✓ ผ่านทุกข้อ');
process.exit(fails.length ? 1 : 0);
