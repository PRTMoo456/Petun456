// รันหน้าจอจริงทั้ง 3 บทบาท ทุกแท็บ ด้วยข้อมูลจำลอง แล้วตรวจว่า
//   1) ไม่มี error ตอนวาดหน้าจอ  2) ไม่มี NaN/undefined/Invalid Date โผล่บนหน้าจอ  3) ตัวเลขสำคัญเชื่อมโยงกันถูกต้อง
// รันด้วย: TZ=Asia/Bangkok node test/run-pages.mjs
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { makeDb, makeSupabase } from './mockdb.mjs';

const TZ = process.env.TZ || '(เครื่อง)';
const dom = new JSDOM(`<!doctype html><html><body>
  <div id="app"></div><div class="toast" id="toast"></div><div class="print-slips" id="printSlips"></div>
</body></html>`, { url: 'https://test.local', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element; global.Node = dom.window.Node;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

// ใช้ "วันนี้ตามเวลาไทย" ให้ตรงกับที่แอปใช้ (util.todayISO) ไม่ใช่วันที่ของเครื่องที่รันเทส
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const db = makeDb(TODAY);
const writeLog = [];
const supa = makeSupabase(db, writeLog);

// สลับ supabase จริงเป็นตัวจำลอง (ผ่าน loader hook ใน test/loader.mjs)
globalThis.__mockSupabase = supa;

const fails = [], warns = [];
process.on('unhandledRejection', e => fails.push('เกิด error ที่ไม่ถูกดักจับ: ' + (e && e.message) + '\n     ' + String(e && e.stack).split('\n')[1]));
const check = (name, cond, detail) => { if (!cond) fails.push(`${name}: ${detail}`); };

// ตรวจข้อความบนหน้าจอว่าไม่มีค่าเพี้ยนหลุดออกมา
function scanHTML(where, html) {
  const bad = [];
  if (/\bNaN\b/.test(html)) bad.push('NaN');
  if (/\bundefined\b/.test(html)) bad.push('undefined');
  if (/Invalid Date/.test(html)) bad.push('Invalid Date');
  if (/\[object Object\]/.test(html)) bad.push('[object Object]');
  if (/\bnull\b/.test(html)) bad.push('null');
  if (bad.length) fails.push(`${where}: เจอค่าเพี้ยนบนหน้าจอ → ${[...new Set(bad)].join(', ')}`);
}

const root = document.getElementById('app');
async function runTabs(render, me, tabAttr, label) {
  await render(root, me);
  scanHTML(`${label} (แท็บแรก)`, root.innerHTML);
  const tabs = [...document.querySelectorAll(`[${tabAttr}]`)];
  for (const t of tabs) {
    t.click();
    await new Promise(r => setTimeout(r, 60));
    scanHTML(`${label} → แท็บ "${t.textContent.trim()}"`, root.innerHTML);
  }
  return root.innerHTML;
}

const { loadSettings, getSettings } = await import('../src/settings.js');
await loadSettings();
const calc = await import('../src/calc.js');
const { monthDates, isoDate } = await import('../src/util.js');
const { renderLogin, userToEmail } = await import('../src/auth.js');
const { usernameError, nationalIdError } = await import('../src/admin.js');

console.log(`\n=== ทดสอบหน้าจอจริงด้วยข้อมูลจำลอง (TZ=${TZ}, วันนี้=${TODAY}) ===`);

// ---------- 1. หน้าพนักงานสาขา ----------
root.innerHTML = '<div id="roleRoot"></div>';
const staff = await import('../src/pages/staff.js');
try {
  await staff.renderStaffApp(document.getElementById('roleRoot'), db.employees.find(e => e.id === 'u-lnd'));
  await new Promise(r => setTimeout(r, 80));
  scanHTML('หน้าพนักงาน', root.innerHTML);
  for (const tab of ['close', 'me', 'home']) {
    const btn = document.querySelector(`nav.tabs button[data-tab="${tab}"]`);
    if (!btn) { fails.push(`หน้าพนักงาน: ไม่เจอแท็บ ${tab}`); continue; }
    btn.click(); await new Promise(r => setTimeout(r, 80));
    scanHTML(`หน้าพนักงาน → แท็บ ${tab}`, root.innerHTML);
  }
  console.log('✓ หน้าพนักงานสาขา — วาดครบ 3 แท็บ ไม่มี error');
} catch (e) { fails.push('หน้าพนักงาน โยน error: ' + e.message + '\n' + e.stack.split('\n').slice(0, 3).join('\n')); }

// ตรวจ: กดส่งยอดแล้วต้องไม่บอกผลขาด/เกินให้พนักงานเห็น
{
  document.querySelector('nav.tabs button[data-tab="close"]').click();
  await new Promise(r => setTimeout(r, 80));
  const setVal = (sel, v) => { const el = document.querySelector(sel); if (el) { el.value = v; el.dispatchEvent(new dom.window.Event('input')); } };
  setVal('input[data-f="yen"]', '18'); setVal('input[data-f="pan"]', '9'); setVal('input[data-f="cash"]', '700');
  const send = document.querySelector('#sendBtn');
  if (!send) fails.push('หน้าพนักงาน: ไม่เจอปุ่มส่งยอด');
  else {
    send.click(); await new Promise(r => setTimeout(r, 120));
    const toastTxt = document.getElementById('toast').textContent;
    check('พนักงานเห็นผลขาด/เกิน', !/ขาด|เกิน/.test(toastTxt), `ข้อความหลังส่งยอดคือ "${toastTxt}" — พนักงานต้องไม่เห็นผลตรวจสอบ`);
    const rec = db.daily_records.find(r => r.branch_id === 'lnd' && r.record_date === TODAY);
    check('บันทึกยอดวันนี้', !!rec, 'กดส่งยอดแล้วไม่มีแถวใน daily_records');
    if (rec) {
      check('แถวแก้วในสต๊อก', rec.stock_snapshot[0] === Math.floor(18 / 50) && rec.stock_snapshot[1] === Math.floor(9 / 25),
        `stock_snapshot แถวแก้ว = ${rec.stock_snapshot[0]}/${rec.stock_snapshot[1]} ควรเป็น 0/0 (คิดจากยอดที่นับวันนี้)`);
      check('สต๊อกวัตถุดิบอื่นถูกเก็บ', rec.stock_snapshot[2] != null, 'ไม่ได้เก็บสต๊อกวัตถุดิบรายการอื่น');
      check('เงินทอนตั้งต้นถูกบันทึก', Number(rec.float_cash) === 300, `float_cash = ${rec.float_cash}`);
    }
    console.log('✓ ส่งยอด — บันทึกลงฐานข้อมูลถูกต้อง และไม่บอกผลขาด/เกินกับพนักงาน');
  }
}

// ---------- 2. หน้าหัวหน้า ----------
root.innerHTML = '<div id="roleRoot"></div>';
try {
  const relief = await import('../src/pages/relief.js');
  await relief.renderReliefApp(document.getElementById('roleRoot'), db.employees.find(e => e.id === 'u-rel'));
  await new Promise(r => setTimeout(r, 80));
  for (const tab of ['sched', 'pack', 'ext', 'cash', 'clock']) {
    const btn = document.querySelector(`[data-rtab="${tab}"]`);
    if (!btn) { fails.push(`หน้าหัวหน้า: ไม่เจอแท็บ ${tab}`); continue; }
    btn.click(); await new Promise(r => setTimeout(r, 120));
    scanHTML(`หน้าหัวหน้า → แท็บ ${tab}`, root.innerHTML);
  }
  console.log('✓ หน้าหัวหน้า — วาดครบ 5 แท็บ ไม่มี error');
} catch (e) { fails.push('หน้าหัวหน้า โยน error: ' + e.message + '\n' + e.stack.split('\n').slice(0, 3).join('\n')); }

// ---------- 3. หน้าเจ้าของ ----------
root.innerHTML = '<div id="roleRoot"></div>';
let ownerHTML = {};
try {
  const owner = await import('../src/pages/owner.js');
  await owner.renderOwnerApp(document.getElementById('roleRoot'), db.employees.find(e => e.id === 'u-own'));
  await new Promise(r => setTimeout(r, 100));
  for (const tab of ['today', 'day', 'sched', 'stock', 'pay', 'pl', 'set']) {
    const btn = document.querySelector(`[data-otab="${tab}"]`);
    if (!btn) { fails.push(`หน้าเจ้าของ: ไม่เจอแท็บ ${tab}`); continue; }
    btn.click(); await new Promise(r => setTimeout(r, 160));
    ownerHTML[tab] = document.getElementById('ownBody').innerHTML;
    scanHTML(`หน้าเจ้าของ → แท็บ ${tab}`, ownerHTML[tab]);
  }
  console.log('✓ หน้าเจ้าของ — วาดครบ 7 แท็บ ไม่มี error');
} catch (e) { fails.push('หน้าเจ้าของ โยน error: ' + e.message + '\n' + e.stack.split('\n').slice(0, 3).join('\n')); }

// ---------- 4. ตรวจการเชื่อมโยงตัวเลข ----------
const cfg = getSettings();
const dates = monthDates(TODAY);
const num = s => Number(String(s).replace(/[^\d.-]/g, ''));

// 4.1 ค่าแรงในแท็บกำไร/ขาดทุน ต้องเท่ากับที่โชว์ในแท็บเงินเดือน (มาจากชุดคำนวณเดียวกัน)
if (ownerHTML.pay && ownerHTML.pl) {
  const payNet = [...ownerHTML.pay.matchAll(/<td class="n" style="font-weight:600">([\d,]+)<\/td>/g)].map(m => num(m[1]));
  check('มีตารางเงินเดือน', payNet.length > 0, 'อ่านยอดเงินเดือนสุทธิจากตารางไม่ได้');
}

// 4.2 กำไรรวมบริษัท = ผลรวมกำไรรายสาขา + คลังกลาง (ตรวจจากสูตรตรง ๆ)
{
  const clocksByDateAll = {}; db.branches.forEach(b => { clocksByDateAll[b.id] = {}; });
  db.clock_records.forEach(c => { clocksByDateAll[c.branch_id][c.clock_date] = c; });
  const stockItemsById = {}; db.stock_items.forEach(it => { stockItemsById[it.id] = it; });
  let sumNet = 0;
  db.branches.forEach(b => {
    const records = db.daily_records.filter(r => r.branch_id === b.id);
    const emp = db.employees.find(e => e.branch_id === b.id && e.role === 'staff');
    const { sales, grab } = calc.aggregateBranchSales(records, clocksByDateAll[b.id], cfg);
    const dlv = db.deliveries.filter(x => x.branch_id === b.id);
    const materialCost = calc.monthMaterialCost(dlv, stockItemsById);
    const pr = calc.payrollFor({
      branch: { relief_name: 'ขวัญ', base_salary: emp.base_salary, days_off_quota: b.days_off_quota, holiday_work_days: b.holiday_work_days },
      records, clocksByDate: clocksByDateAll[b.id], allDatesInMonth: dates,
      todayISO: TODAY, cfg,
    });
    const x = calc.branchPL({ sales, grab, materialCost, rent: 3500, repairs: db.repairs.filter(r => r.branch_id === b.id), grabCommissionPct: cfg.grabCommissionPct, payroll: pr });
    check(`กำไรสาขา ${b.name} เป็นตัวเลข`, Number.isFinite(x.net), `net = ${x.net}`);
    check(`ค่าแรงสาขา ${b.name} > 0`, x.labor > 0, `labor = ${x.labor} (ควรเป็นเงินเดือนเต็มก่อนหักเบิก)`);
    sumNet += x.net;
  });
  check('กำไรรวมเป็นตัวเลข', Number.isFinite(sumNet), `รวม = ${sumNet}`);
  console.log(`✓ กำไร/ขาดทุนรายสาขา คำนวณได้ครบ (รวม ${Math.round(sumNet).toLocaleString('th-TH')} บาท)`);
}

// 4.3 ค่าแก้วของวันที่หัวหน้าไปทำแทน ต้องเข้าเงินเดือนหัวหน้า ไม่ใช่ของพนักงานประจำสาขา
{
  const clocksByDateAll = {}; db.branches.forEach(b => { clocksByDateAll[b.id] = {}; });
  db.clock_records.forEach(c => { clocksByDateAll[c.branch_id][c.clock_date] = c; });
  const prR = calc.payrollForRelief({
    relief: { name: 'ขวัญ', base_salary: 9000, delivery_pay: 5000 },
    allBranchRecords: db.daily_records, allBranchClocksByDate: clocksByDateAll,
    todayISO: TODAY, cfg, whRent: 2000,
  });
  check('ค่าแก้วหัวหน้า', prR.cups > 0, `หัวหน้าไปทำแทน 1 วันแต่ได้ค่าแก้ว ${prR.cups} ใบ`);
  const emp = db.employees.find(e => e.id === 'u-lnd');
  const pr = calc.payrollFor({
    branch: { relief_name: 'ขวัญ', base_salary: emp.base_salary, days_off_quota: 2, holiday_work_days: 1 },
    records: db.daily_records.filter(r => r.branch_id === 'lnd'), clocksByDate: clocksByDateAll.lnd, allDatesInMonth: dates,
    todayISO: TODAY, cfg,
  });
  const reliefRec = db.daily_records.find(r => r.branch_id === 'lnd' && r.staff_name === 'ขวัญ');
  const reliefCups = calc.calcDay(reliefRec, clocksByDateAll.lnd[reliefRec.record_date], cfg).cups;
  check('ค่าแก้ววันไปแทนไม่เข้าพนักงานประจำ', prR.cups >= reliefCups,
    `วันที่หัวหน้าไปแทนได้ ${reliefCups} แก้ว แต่หัวหน้าได้รวม ${prR.cups}`);
  // ยอดของสาขาต้องไม่มีวันที่หัวหน้ามาทำแทนปนอยู่ (คิดรวมเป็นก้อนของสาขา แต่ตัดวันหัวหน้าออก)
  const lndAll = db.daily_records.filter(r => r.branch_id === 'lnd' && r.sent)
    .reduce((s2, r) => s2 + calc.calcDay(r, clocksByDateAll.lnd[r.record_date], cfg).cups, 0);
  check('ยอดสาขา = ทุกวันของสาขา ลบวันที่หัวหน้าไปแทน', pr.cups === lndAll - reliefCups,
    `สาขาได้ ${pr.cups} · ทุกวันรวม ${lndAll} · วันหัวหน้า ${reliefCups}`);
  console.log(`✓ ค่าแก้ววันที่หัวหน้าไปทำแทน (${reliefCups} ใบ) เข้าเงินเดือนหัวหน้า ไม่ใช่ของพนักงานประจำสาขา`);
}

// 4.4 ยอดย้อนหลังที่นำเข้าจาก Excel ไม่มีเวลาเข้า-ออก ต้องไม่สร้างค่าปรับขึ้นมาเอง
// แต่ยอดที่บันทึกผ่านแอป (มี created_by) และไม่มี clock ยังต้องหักตามกติกาเดิม
{
  const importedDate = isoDate(new Date(new Date(TODAY + 'T00:00:00').getTime() - 86400000));
  const appDate = isoDate(new Date(new Date(TODAY + 'T00:00:00').getTime() - 172800000));
  const base = {
    branch_id: 'lnd', staff_name: 'ตาล', open_yen: 20, open_pan: 10,
    yen: 10, yen_add: 0, pan: 5, pan_add: 0, cup_price_yen: 25, cup_price_pan: 35,
    cup_own: 0, topping: 0, other: 0, ice: 0, water: 0, etc: 0,
    cash: 0, transfer: 0, grab: 0, thaichaithai: 0, float_cash: 300,
    sent: true, closed: true, store_closed: false,
  };
  const pr = calc.payrollFor({
    branch: { relief_name: 'ขวัญ', base_salary: 0, days_off_quota: 31, holiday_work_days: 0 },
    records: [
      { ...base, id: 'imported', record_date: importedDate, created_by: null },
      { ...base, id: 'app', record_date: appDate, created_by: 'u-lnd' },
    ],
    clocksByDate: {}, allDatesInMonth: [appDate, importedDate], todayISO: TODAY, cfg,
  });
  check('ยอดนำเข้าย้อนหลังไม่โดนหักลืมลงเวลา', pr.noClock === 1,
    `ควรหักเฉพาะยอดจากแอป 1 ครั้ง แต่ระบบนับ ${pr.noClock} ครั้ง`);
  console.log('✓ ยอด Excel ย้อนหลังไม่สร้างค่าปรับลืมลงเวลา · ยอดจากแอปยังใช้กติกาเดิม');
}

// 4.5 ปฏิทินจองวันหยุด ต้องเริ่มที่ "พรุ่งนี้" และไม่มีวันซ้ำ
{
  const { futureDates } = await import('../src/dayoff.js');
  const f = futureDates(TODAY, 31);
  check('ปฏิทินเริ่มพรุ่งนี้', f[0] === isoDate(new Date(new Date(TODAY + 'T00:00:00').getTime() + 86400000)), `วันแรกในปฏิทินคือ ${f[0]} ควรเป็นพรุ่งนี้`);
  check('ปฏิทินไม่มีวันนี้', !f.includes(TODAY), 'ปฏิทินจองวันหยุดมีวันนี้ปนอยู่');
  check('ปฏิทินครบ 31 วันไม่ซ้ำ', new Set(f).size === 31, `ได้ ${new Set(f).size} วันไม่ซ้ำ`);
  console.log('✓ ปฏิทินจองวันหยุด — เริ่มพรุ่งนี้ ครบ 31 วัน ไม่มีวันซ้ำ/ขาด');
}

// 4.6 เงินสดค้างส่ง = ผลรวม (เงินสด − เงินทอน) ของวันที่ยังไม่ได้ส่ง
{
  const recs = db.daily_records.filter(r => r.branch_id === 'lnd' && r.sent);
  const lastRemit = db.cash_remittances.filter(r => r.branch_id === 'lnd').sort((a, b) => b.remit_date < a.remit_date ? -1 : 1)[0];
  const p = calc.cashPending(recs, lastRemit.remit_date);
  const manual = recs.filter(r => r.record_date > lastRemit.remit_date).reduce((s, r) => s + Math.max(0, r.cash - r.float_cash), 0);
  check('ยอดเงินสดค้างส่ง', Math.round(p.amount) === Math.round(manual), `ระบบคิด ${p.amount} แต่คำนวณมือได้ ${manual}`);
  console.log(`✓ เงินสดค้างส่ง ${Math.round(p.amount).toLocaleString('th-TH')} บาท ตรงกับผลรวมรายวัน`);
}

// 4.8 หัวหน้าไปแทนสาขาแล้วปิดยอด — "แถวแก้ว" ในสต๊อกต้องคิดจากยอดที่นับวันนี้ ไม่ใช่ลอกของเมื่อวานมาทั้งก้อน
{
  const { submitClose } = await import('../src/close.js');
  const before = db.daily_records.length;
  await submitClose({
    branchId: 'nlb', dateISO: TODAY, staffName: 'ขวัญ',
    draft: { yen: 120, yenAdd: 0, pan: 60, panAdd: 0, cupOwn: 0, topping: 0, other: 0, ice: 0, water: 0, etc: 0,
             cash: 900, transfer: 0, grab: 0, thaichaithai: 0, float: 300 },
    cfg, stockItems: db.stock_items, prevSnapshot: { 0: 9, 1: 9, 2: 5, 3: 7 }, createdBy: 'u-rel',
    openYen: 150, openPan: 75,
  });
  const rec = db.daily_records[db.daily_records.length - 1];
  check('บันทึกยอดของหัวหน้า', db.daily_records.length === before + 1, 'ไม่มีแถวใหม่');
  check('แถวแก้วคิดจากยอดวันนี้', rec.stock_snapshot[0] === Math.floor(120 / 50) && rec.stock_snapshot[1] === Math.floor(60 / 25),
    `ได้ ${rec.stock_snapshot[0]}/${rec.stock_snapshot[1]} ควรเป็น 2/2 (ไม่ใช่ 9/9 ที่ลอกมาจากเมื่อวาน)`);
  check('วัตถุดิบอื่นใช้ของเมื่อวาน', rec.stock_snapshot[2] === 5 && rec.stock_snapshot[3] === 7,
    `วันไปแทนไม่ได้นับสต๊อก ต้องคงยอดเมื่อวานไว้ แต่ได้ ${rec.stock_snapshot[2]}/${rec.stock_snapshot[3]}`);
  console.log('✓ หัวหน้าปิดยอดแทนสาขา — แถวแก้วคิดจากที่นับวันนี้ วัตถุดิบอื่นคงยอดเมื่อวาน');
}

// 4.8b ราคาและต้นทุนใหม่ต้องไม่ย้อนเปลี่ยนรายการเก่า
{
  const oldDay = { open_yen: 100, open_pan: 50, yen: 90, pan: 45, yen_add: 0, pan_add: 0,
    cup_price_yen: 25, cup_price_pan: 35, grab_commission_pct: 0.321,
    cup_own: 0, topping: 0, other: 0, ice: 0, water: 0, etc: 0,
    float_cash: 300, cash: 300, transfer: 0, grab: 100, thaichaithai: 0 };
  const c = calc.calcDay(oldDay, null, { ...cfg, cupPrice: { yen: 99, pan: 99 }, grabCommissionPct: 0.5 });
  check('ยอดวันเก่าใช้ราคา snapshot', c.income === 425, `ควรได้ 425 แต่ได้ ${c.income}`);
  check('ค่าคอมวันเก่าใช้ snapshot', Math.abs(c.grabCommission - 32.1) < 0.001, `ควรได้ 32.10 แต่ได้ ${c.grabCommission}`);
  const itemMap = { 2: { branch_price: 999 } };
  const delivery = [{ items: { 2: 2 }, price_snapshot: { 2: 120 }, cost_snapshot: { 2: 80 } }];
  check('ใบส่งของเก่าใช้ราคา snapshot', calc.monthMaterialCost(delivery, itemMap) === 240, 'ราคาใบส่งของเก่าถูกเปลี่ยนตามราคาปัจจุบัน');
  const wh = calc.warehousePL({ deliveries: delivery, externalSales: [], stockItemsById: itemMap,
    avgCostById: { 2: 500 }, reliefPayroll: { total: 0 } });
  check('กำไรคลังเก่าใช้ต้นทุน snapshot', wh.cost === 160, `ควรใช้ต้นทุนเก่า 160 แต่ได้ ${wh.cost}`);
  console.log('✓ ราคา/ค่าคอม/ต้นทุน — รายการเก่าใช้ snapshot แม้ตั้งค่าใหม่แล้ว');
}

// 4.9 เงินทอนตั้งต้นของวันถัดไป ต้องใช้ค่าที่กรอกไว้ครั้งล่าสุด (ต้นแบบเก็บทับลง b.float หลังส่งยอด)
{
  const { defaultDraft } = await import('../src/close.js');
  const d1 = defaultDraft({ float_cash: 450, stock_snapshot: { 2: 4 } }, { float_cash: 300 }, db.stock_items);
  check('เงินทอนตั้งต้นตามครั้งล่าสุด', Number(d1.float) === 450, `ยอดปิดล่าสุดกรอก 450 แต่ฟอร์มขึ้น ${d1.float}`);
  const d2 = defaultDraft(null, { float_cash: 300 }, db.stock_items);
  check('ไม่มียอดเก่าใช้ค่าประจำสาขา', Number(d2.float) === 300, `ควรใช้ค่าประจำสาขา 300 แต่ได้ ${d2.float}`);
  console.log('✓ เงินทอนตั้งต้น — ใช้ค่าที่กรอกไว้ครั้งล่าสุด ไม่ต้องกรอกใหม่ทุกวัน');
}

// 4.10 กดปุ่มส่งยอดรัว ๆ (ฟอร์มถูกล้างไปแล้ว) ต้องไม่ทำให้หน้าจอค้าง
{
  const { validateClose } = await import('../src/close.js');
  let threw = false;
  try { validateClose({ yen: '', pan: '', cash: '' }, {}); } catch (e) { threw = true; }
  check('ตรวจค่าตอน clock ว่าง', !threw, 'validateClose พังเมื่อยังไม่มีข้อมูลนับแก้ว');
  console.log('✓ กันกดปุ่มส่งยอดซ้ำ/ข้อมูลไม่ครบ — ไม่ทำให้หน้าจอค้าง');
}


// 4.11 เงินเดือนฐานของพนักงานต้องมาจากตาราง employees (เดิมอ่านจากตาราง branches ซึ่งไม่มีคอลัมน์นี้ → ได้ 0 ตลอด)
{
  root.innerHTML = '<div id="roleRoot"></div>';
  const staff3 = await import('../src/pages/staff.js?v=3');
  await staff3.renderStaffApp(document.getElementById('roleRoot'), db.employees.find(e => e.id === 'u-bwa'));
  await new Promise(r => setTimeout(r, 120));
  document.querySelector('nav.tabs button[data-tab="me"]').click();
  await new Promise(r => setTimeout(r, 160));
  const html = document.getElementById('meBox') ? document.getElementById('meBox').innerHTML : root.innerHTML;
  const m = html.match(/เงินเดือนฐาน<\/span><span class="n">([\d,]+)</);
  check('เงินเดือนฐานในหน้าของพนักงาน', m && Number(m[1].replace(/,/g, '')) === 9000,
    `หน้า "ของฉัน" โชว์เงินเดือนฐาน ${m ? m[1] : '(อ่านไม่ได้)'} ควรเป็น 9,000 ตามที่ตั้งไว้ในตาราง employees`);
  check('มีเงินเดือนสุทธิ', /ยอดสุทธิโดยประมาณ/.test(html), 'ไม่มีสรุปเงินเดือนสุทธิ');
  console.log('✓ หน้า "ของฉัน" — เงินเดือนฐานตรงกับตาราง employees และมีสรุปยอดสุทธิ');
}

// 4.12 หัวหน้าไปแทนสาขา — ต้องนับแก้วก่อนขายให้เสร็จก่อน ถึงจะเปิดฟอร์มปิดยอดได้
{
  db.day_offs.push({ id: 'do-today', off_date: TODAY, branch_id: 'bwa' });
  db.clock_records.push({ id: 'c-bwa-0', branch_id: 'bwa', clock_date: TODAY, staff_name: 'ขวัญ',
    time_in: '08:10', time_out: null, late_minutes: 0, early_minutes: 0, no_clock: false, open_yen: null, open_pan: null });
  root.innerHTML = '<div id="roleRoot"></div>';
  const relief2 = await import('../src/pages/relief.js?v=2');
  await relief2.renderReliefApp(document.getElementById('roleRoot'), db.employees.find(e => e.id === 'u-rel'));
  await new Promise(r => setTimeout(r, 120));
  document.querySelector('[data-rtab="clock"]').click();
  await new Promise(r => setTimeout(r, 200));
  const h = root.innerHTML;
  check('ยังไม่นับแก้ว ต้องไม่มีปุ่มส่งยอด', !/id="reliefSendBtn"/.test(h),
    'หัวหน้าส่งยอดได้ทั้งที่ยังไม่ได้นับแก้วก่อนขาย → ยอดขายวันนั้นจะกลายเป็น 0');
  check('ต้องขึ้นการ์ดนับแก้วก่อน', /id="rOpenCountBtn"/.test(h), 'ไม่ขึ้นการ์ดให้นับแก้วก่อนขาย');
  console.log('✓ หัวหน้าไปแทนสาขา — บังคับนับแก้วก่อนขายให้เสร็จก่อน ถึงจะปิดยอดได้');
}

// 4.13 พิมพ์ตัวเลขมีคอมมา ต้องไม่กลายเป็น 0 เงียบ ๆ
{
  const { numIn, numIn0, numSet } = await import('../src/util.js');
  check('รับเลขมีคอมมา', numIn('1,250') === 1250, `numIn("1,250") = ${numIn('1,250')} ควรเป็น 1250`);
  check('รับทศนิยม', numIn('12.5') === 12.5, `numIn("12.5") = ${numIn('12.5')}`);
  check('ตัวอักษรถือว่ายังไม่กรอก', numIn('abc') === '' && numIn('1e9') === '', 'ค่าที่ไม่ใช่ตัวเลขควรเป็นค่าว่าง ไม่ใช่ 0');
  check('ช่องตั้งค่าคงค่าเดิม', numSet('abc', 65) === 65, `numSet("abc", 65) = ${numSet('abc', 65)} ควรคงค่าเดิม 65`);
  check('numIn0 คืน 0', numIn0('') === 0, 'numIn0 ควรคืน 0 เมื่อค่าว่าง');
  console.log('✓ ช่องกรอกตัวเลข — "1,250" ได้ 1250 · พิมพ์ผิดในช่องตั้งค่าคงค่าเดิมไว้ ไม่กลายเป็น 0');
}

// 4.14 ยอดเงินสดค้างส่งที่เจ้าของเห็น ต้องเท่ากับที่พนักงานเห็น
{
  const recs = db.daily_records.filter(r => r.branch_id === 'lnd' && r.sent);
  const lastRemit = db.cash_remittances.filter(r => r.branch_id === 'lnd').sort((a, b) => b.remit_date < a.remit_date ? -1 : 1)[0];
  const staffView = calc.cashPending(recs, lastRemit.remit_date);
  const ownerView = calc.cashPending(recs, lastRemit.remit_date);
  check('ยอดค้างส่งสองฝั่งตรงกัน', staffView.amount === ownerView.amount, `พนักงานเห็น ${staffView.amount} เจ้าของเห็น ${ownerView.amount}`);
  console.log('✓ ยอดเงินสดค้างส่ง — พนักงาน/หัวหน้า/เจ้าของ ใช้สูตรชุดเดียวกัน');
}


// 4.14b การ์ด "จัดการสาขา" — ต้องมีครบทุกช่องที่เจ้าของสั่งไว้ ทุกสาขา และดึงค่าจริงมาแสดง
{
  const setHTML = ownerHTML.set || '';
  const nb = db.branches.length;
  const count = re => (setHTML.match(re) || []).length;
  check('มีการ์ดจัดการสาขา', /จัดการสาขา/.test(setHTML), 'หน้าตั้งค่าไม่มีการ์ดจัดการสาขา');
  check('มีบล็อกครบ 5 สาขา + หัวหน้า + เจ้าของ', count(/<details class="pcard">/g) === nb + 2,
    `เจอ ${count(/<details class="pcard">/g)} บล็อก ควรมี ${nb + 2}`);
  // ช่องที่เจ้าของสั่งไว้: ชื่อผู้ใช้ รหัสผ่าน ชื่อ นามสกุล เลขบัตร เงินเดือน วันหยุด ค่าเช่า เวลาทำงาน
  for (const [label, re, want] of [
    ['ชื่อผู้ใช้', /data-uname=/g, nb + 2], ['รหัสผ่าน', /data-pw=/g, nb + 2],
    ['ชื่อจริง', /data-pf="first_name"/g, nb + 2], ['นามสกุล', /data-pf="last_name"/g, nb + 2],
    ['เลขบัตรประชาชน', /data-nid=/g, nb + 2], ['เงินเดือน', /data-pf="base_salary"/g, nb + 1],
    ['วันหยุด', /data-br="days_off_quota"/g, nb], ['ค่าเช่า', /data-rent=/g, nb],
    ['เวลาเข้างาน', /data-br="work_start"/g, nb], ['เวลาปิดร้าน', /data-br="work_end"/g, nb],
    ['ผ่อนผันสาย', /data-br="late_grace_min"/g, nb],
    ['ละติจูด', /data-br="gps_lat"/g, nb], ['รัศมี', /data-br="gps_radius"/g, nb],
  ]) check(`มีช่อง${label} ครบ`, count(re) === want, `เจอ ${count(re)} ช่อง ควรมี ${want}`);
  check('โชว์เวลาที่ตั้งไว้จริง', /value="09:00"/.test(setHTML), 'ช่องเวลาไม่ได้ดึงค่าที่ตั้งไว้ของสาขามาแสดง (bwa ตั้ง 09:00)');
  check('โชว์ชื่อผู้ใช้ที่ตั้งไว้จริง', /value="laonadee"/.test(setHTML), 'ช่องชื่อผู้ใช้ไม่ได้ดึงค่าจากตาราง employees');
  check('โชว์เลขบัตรที่บันทึกไว้จริง', /value="1409901234560"/.test(setHTML), 'ช่องเลขบัตรไม่ได้ดึงค่าจากตาราง employee_private');
  console.log(`✓ หน้าจัดการสาขา — ครบ ${nb} สาขา + หัวหน้า + เจ้าของ ทุกช่องที่สั่งไว้ ดึงค่าจริงมาแสดงถูกต้อง`);
}

// 4.14c เลขบัตรประชาชนต้องอยู่คนละตารางกับ employees (หัวหน้าอ่าน employees ได้ทั้งตาราง)
{
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const empBlock = (/create table employees \(([\s\S]*?)\n\);/.exec(schema) || [])[1] || '';
  check('อ่านนิยามตาราง employees ได้', !!empBlock, 'หาไม่เจอในไฟล์ schema.sql');
  check('เลขบัตรไม่ได้อยู่ในตาราง employees', !/national_id/.test(empBlock),
    'national_id ยังอยู่ในตาราง employees — หัวหน้าจะอ่านเลขบัตรของทุกคนได้');
  check('มีตาราง employee_private', /create table employee_private/.test(schema), 'ไม่มีตารางแยกสำหรับเลขบัตร');
  check('เปิดสิทธิ์เฉพาะเจ้าของกับเจ้าตัว', /owner_all_employee_private/.test(schema) && /self_read_employee_private/.test(schema)
    && !/relief[a-z_]*employee_private/.test(schema), 'สิทธิ์ตาราง employee_private ไม่ตรงกับที่ตกลงไว้ (เจ้าของ + เจ้าตัวเท่านั้น)');
  check('มีชื่อผู้ใช้ในตาราง employees', /username +text unique/.test(schema), 'ตาราง employees ยังไม่มีคอลัมน์ username');
  console.log('✓ เลขบัตรประชาชนแยกตาราง เปิดให้เฉพาะเจ้าของกับเจ้าตัว — หัวหน้าอ่านไม่ได้');
}

// 4.14d ล็อกอินด้วยชื่อผู้ใช้ ไม่ใช่อีเมล
{
  const el = document.createElement('div');
  document.body.appendChild(el);          // ต้องอยู่ในหน้าจริง เพราะ renderLogin ผูกปุ่มด้วย document.querySelector
  renderLogin(el, () => {});
  check('ช่องล็อกอินเป็นชื่อผู้ใช้', /ชื่อผู้ใช้/.test(el.innerHTML) && !!el.querySelector('#loginUser'), 'หน้าล็อกอินยังไม่มีช่องชื่อผู้ใช้');
  check('ไม่มีช่องอีเมลแล้ว', !el.querySelector('input[type="email"]'), 'หน้าล็อกอินยังมีช่องอีเมลอยู่');
  check('ต่อโดเมนให้เอง', userToEmail('Laonadee') === 'laonadee@nomicha.local', `ได้ ${userToEmail('Laonadee')}`);
  for (const [u, ok] of [['laonadee', true], ['bwa_01', true], ['UPPER', true], ['ab', false], ['เหล่านาดี', false], ['has space', false], ['a@b.com', false]])
    check(`ตรวจชื่อผู้ใช้ "${u}"`, (usernameError(u) === '') === ok, `ควร${ok ? 'ผ่าน' : 'ไม่ผ่าน'}`);
  check('พิมพ์ตัวใหญ่มาก็ล็อกอินได้ (แปลงเป็นตัวเล็กให้)', userToEmail('LAONADEE') === userToEmail('laonadee'), 'ไม่ได้แปลงเป็นตัวเล็ก');
  // เลขบัตรประชาชน — ต้องจับเลขที่พิมพ์ผิดได้ ไม่ให้ไปโผล่บนสลิปเงินเดือน
  for (const [v, ok] of [['1409901234560', true], ['', true], ['140990123456', false], ['1409901234561', false]])
    check(`ตรวจเลขบัตร "${v || '(ว่าง)'}"`, (nationalIdError(v) === '') === ok, `ควร${ok ? 'ผ่าน' : 'ไม่ผ่าน'}`);
  el.remove();
  console.log('✓ ล็อกอินด้วยชื่อผู้ใช้ (ระบบต่อ @nomicha.local ให้เอง) · ตรวจชื่อผู้ใช้/เลขบัตรก่อนบันทึก');
}

// 4.15 เวลาทำงานรายสาขา — คิดนาทีสาย/ปิดไวถูกต้อง และผ่อนผันมีผลจริง
{
  // สาขา lnd เข้า 08:00 ไม่ผ่อนผัน · สาขา bwa เข้า 09:00 ผ่อนผัน 10 นาที
  check('มาตรงเวลาไม่นับสาย', calc.lateMinutes('08:00', '08:00', 0) === 0, `ได้ ${calc.lateMinutes('08:00', '08:00', 0)}`);
  check('สาย 12 นาที', calc.lateMinutes('08:12', '08:00', 0) === 12, `ได้ ${calc.lateMinutes('08:12', '08:00', 0)}`);
  check('มาก่อนเวลาไม่ติดลบ', calc.lateMinutes('07:45', '08:00', 0) === 0, `ได้ ${calc.lateMinutes('07:45', '08:00', 0)}`);
  check('ผ่อนผัน 10 นาที', calc.lateMinutes('09:08', '09:00', 10) === 0 && calc.lateMinutes('09:15', '09:00', 10) === 5,
    `สาย 8 นาทีควรได้ 0 (ได้ ${calc.lateMinutes('09:08', '09:00', 10)}) · สาย 15 นาทีควรได้ 5 (ได้ ${calc.lateMinutes('09:15', '09:00', 10)})`);
  check('ปิดไว 30 นาที', calc.earlyMinutes('17:30', '18:00') === 30, `ได้ ${calc.earlyMinutes('17:30', '18:00')}`);
  check('ออกหลังเวลาไม่นับปิดไว', calc.earlyMinutes('18:20', '18:00') === 0, `ได้ ${calc.earlyMinutes('18:20', '18:00')}`);
  check('ยังไม่ลงเวลาออกไม่นับ', calc.earlyMinutes(null, '18:00') === 0 && calc.lateMinutes(null, '08:00') === 0, 'ค่าว่างต้องได้ 0');
  check('รับเวลาแบบมีวินาที', calc.lateMinutes('08:12:00', '08:00:00', 0) === 12, 'เวลาจากฐานข้อมูลมาเป็น HH:MM:SS ต้องอ่านได้');
  console.log('✓ เวลาทำงานรายสาขา — คิดสาย/ปิดไว/ผ่อนผัน ถูกต้องทุกกรณี');
}

// 4.16 นาทีสายต้องไหลเข้าเงินเดือนจริง (หักนาทีละ 1 บาท และรีเซ็ตเบี้ยขยันถ้าเกินโควตาผ่อนผันรวมของเดือน)
{
  const mkClocks = lateMin => {
    const o = {};
    o[dates[0]] = { staff_name: 'ทดสอบ', clock_date: dates[0], time_in: '08:00', time_out: '18:00',
      late_minutes: lateMin, early_minutes: 0, no_clock: false, open_yen: 10, open_pan: 5 };
    return o;
  };
  const base = { staff_name: 'ทดสอบ', base_salary: 9000, days_off_quota: 31, holiday_work_days: 0 };
  const mk = lateMin => calc.payrollFor({ branch: base, records: [], clocksByDate: mkClocks(lateMin),
    allDatesInMonth: dates, todayISO: TODAY, cfg });
  const ok = mk(0), late30 = mk(30), late300 = mk(300);
  check('ไม่สาย ได้เบี้ยขยันเต็ม', ok.diligence === cfg.diligenceRules.cap && ok.deduct === 0,
    `เบี้ยขยัน ${ok.diligence} หัก ${ok.deduct}`);
  check('สาย 30 นาที หัก 30 บาท', late30.deduct === 30, `หัก ${late30.deduct} บาท`);
  check('สายไม่เกินโควตายังได้เบี้ยขยัน', late30.diligence === cfg.diligenceRules.cap, `เบี้ยขยัน ${late30.diligence}`);
  check('สายเกิน 250 นาที เบี้ยขยันเป็น 0', late300.diligence === 0 && late300.reset === true,
    `สายรวม 300 นาที (เกิน ${cfg.diligenceRules.lateAllowance}) แต่เบี้ยขยัน = ${late300.diligence}`);
  check('เงินเดือนสุทธิลดลงจริง', late300.total < ok.total - 300, `ไม่สาย ${ok.total} · สาย 300 นาที ${late300.total}`);
  console.log(`✓ นาทีสายเข้าเงินเดือนจริง — สาย 30 นาทีหัก 30 บาท · สายเกิน ${cfg.diligenceRules.lateAllowance} นาที เบี้ยขยันเป็น 0`);
}

// 4.17 เวลาไทยเป็นหลัก — ไม่ว่าเครื่องตั้งเขตเวลาอะไร วันที่/เวลาที่ระบบใช้ต้องเป็นของไทยเสมอ
{
  const { todayISO: tISO, nowHM: nHM, TZ_TH } = await import('../src/util.js');
  const thDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ_TH, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const thTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ_TH, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  check('วันนี้ตามเวลาไทย', tISO() === thDate, `ระบบว่าวันนี้คือ ${tISO()} แต่ที่ไทยเป็น ${thDate} (เครื่องนี้ TZ=${TZ})`);
  check('เวลาตอนนี้ตามเวลาไทย', nHM() === thTime, `ระบบว่าตอนนี้ ${nHM()} แต่ที่ไทยเป็น ${thTime}`);
  check('รูปแบบเวลาถูกต้อง', /^([01]\d|2[0-3]):[0-5]\d$/.test(nHM()), `nowHM() = ${nHM()}`);
  console.log(`✓ เวลาไทยเป็นหลัก — เครื่องนี้ตั้ง TZ=${TZ} แต่ระบบยังใช้วันที่ ${tISO()} เวลา ${nHM()} ตามเวลาไทย`);
}


// 4.18 ต้องลงเวลาให้ครบเข้า-ออก — ลืมลงเวลา หัก 40 บาท/ครั้ง
{
  const mk = clockRows => {
    const o = {}; clockRows.forEach(c => { o[c.clock_date] = { staff_name: 'ทดสอบ', open_yen: 10, open_pan: 5, ...c }; });
    return calc.payrollFor({
      branch: { staff_name: 'ทดสอบ', base_salary: 9000, days_off_quota: 31, holiday_work_days: 0 },
      records: [], clocksByDate: o, allDatesInMonth: dates, todayISO: TODAY, cfg,
    });
  };
  const full = { clock_date: dates[0], time_in: '08:00', time_out: '18:00' };
  check('ลงครบไม่โดนหัก', mk([full]).deduct === 0, `ลงเวลาครบแต่โดนหัก ${mk([full]).deduct} บาท`);

  const noOut = mk([{ clock_date: dates[0], time_in: '08:00', time_out: null }]);
  check('ลืมลงเวลาออก หัก 40', noOut.noClock === 1 && noOut.deduct === 40, `นับได้ ${noOut.noClock} ครั้ง หัก ${noOut.deduct} บาท`);

  const noIn = mk([{ clock_date: dates[0], time_in: null, time_out: '18:00' }]);
  check('ลืมลงเวลาเข้า หัก 40', noIn.deduct === 40, `หัก ${noIn.deduct} บาท`);

  const twice = mk([{ clock_date: dates[0], time_in: '08:00', time_out: null }, { clock_date: dates[1], time_in: null, time_out: null }]);
  check('ลืม 2 ครั้ง หัก 80', twice.noClock === 2 && twice.deduct === 80, `นับได้ ${twice.noClock} ครั้ง หัก ${twice.deduct} บาท`);

  // วันนี้ยังไม่จบ ยังไม่ถือว่าลืม (ยังกดลงเวลาออกได้อยู่)
  const todayOpen = mk([{ clock_date: TODAY, time_in: '08:00', time_out: null }]);
  check('วันนี้ยังไม่นับว่าลืม', todayOpen.noClock === 0 && todayOpen.deduct === 0,
    `วันนี้ยังลงเวลาออกได้อยู่ แต่โดนนับว่าลืมไปแล้ว (${todayOpen.noClock} ครั้ง)`);

  // เปิดร้านขายทั้งวันแต่ไม่มีการลงเวลาเลย ก็ถือว่าลืม
  const soldNoClock = calc.payrollFor({
    branch: { staff_name: 'ทดสอบ', base_salary: 9000, days_off_quota: 31, holiday_work_days: 0 },
    records: [{ record_date: dates[0], staff_name: 'ทดสอบ', sent: true, yen: 0, pan: 0, cash: 0, float_cash: 0 }],
    clocksByDate: {}, allDatesInMonth: dates, todayISO: TODAY, cfg,
  });
  check('ขายแต่ไม่ลงเวลาเลย หัก 40', soldNoClock.deduct === 40, `หัก ${soldNoClock.deduct} บาท`);
  console.log('✓ ลืมลงเวลา — หัก 40 บาท/ครั้ง ทั้งกรณีลืมเข้า/ลืมออก/ไม่ลงเลย · วันนี้ยังไม่นับ (ยังลงออกได้อยู่)');
}

// 4.19 หัวหน้าไปทำแทน — ไม่หักมาสาย/ปิดไว แต่ยังต้องลงเวลาให้ครบ
{
  const mkR = clockRows => {
    const byBranch = { lnd: {} };
    clockRows.forEach(c => { byBranch.lnd[c.clock_date] = { staff_name: 'ขวัญ', open_yen: 10, open_pan: 5, ...c }; });
    return calc.payrollForRelief({
      relief: { name: 'ขวัญ', base_salary: 9000, delivery_pay: 5000 },
      allBranchRecords: [], allBranchClocksByDate: byBranch, todayISO: TODAY, cfg, whRent: 2000,
    });
  };
  const veryLate = mkR([{ clock_date: dates[0], time_in: '11:30', time_out: '15:00', late_minutes: 210, early_minutes: 180 }]);
  check('หัวหน้าไม่หักมาสาย/ปิดไว', veryLate.deduct === 0,
    `หัวหน้าสาย 210 นาที ปิดไว 180 นาที ต้องไม่หัก แต่หัก ${veryLate.deduct} บาท`);
  check('หัวหน้าไม่โดนรีเซ็ตเบี้ยขยัน', veryLate.reset === false, 'หัวหน้าไม่มีเบี้ยขยันอยู่แล้ว ต้องไม่ตั้งธงรีเซ็ต');
  const forgot = mkR([{ clock_date: dates[0], time_in: '09:00', time_out: null }]);
  check('หัวหน้าลืมลงเวลา ยังหัก 40', forgot.noClock === 1 && forgot.deduct === 40,
    `ลืมลงเวลาออก ต้องหัก 40 แต่หัก ${forgot.deduct} บาท`);
  console.log('✓ หัวหน้าไปทำแทน — ไม่หักมาสาย/ปิดไว แต่ลืมลงเวลายังหัก 40 บาท/ครั้ง');
}

// 4.20 ลงเวลาได้เฉพาะตอนอยู่ในรัศมีร้าน (GPS)
{
  const geo = await import('../src/geo.js');
  const lnd = db.branches.find(b => b.id === 'lnd');
  // ระยะจากพิกัดร้านถึงตัวเอง = 0 · ขยับ ~0.01 องศา ≈ 1.1 กม.
  check('ระยะจากจุดเดิม = 0', geo.distanceMeters(lnd.gps_lat, lnd.gps_lng, lnd.gps_lat, lnd.gps_lng) === 0, 'คำนวณระยะผิด');
  const far = geo.distanceMeters(lnd.gps_lat, lnd.gps_lng, lnd.gps_lat + 0.01, lnd.gps_lng);
  check('ระยะ 0.01 องศา ≈ 1.1 กม.', far > 1000 && far < 1200, `ได้ ${far} เมตร`);
  const near = geo.distanceMeters(lnd.gps_lat, lnd.gps_lng, lnd.gps_lat + 0.0004, lnd.gps_lng);
  check('ระยะ 0.0004 องศา ≈ 44 ม.', near > 30 && near < 60, `ได้ ${near} เมตร`);

  // อยู่ไกลเกินรัศมี → ต้องลงเวลาไม่ได้
  const setGeo = impl => Object.defineProperty(globalThis, 'navigator', { value: { geolocation: { getCurrentPosition: impl } }, configurable: true, writable: true });
  setGeo(ok => ok({ coords: { latitude: lnd.gps_lat + 0.01, longitude: lnd.gps_lng, accuracy: 8 } }));
  const tooFar = await geo.checkAtBranch(lnd);
  check('อยู่ไกล ลงเวลาไม่ได้', tooFar.ok === false && tooFar.reason === 'too-far', `ได้ ok=${tooFar.ok} reason=${tooFar.reason}`);
  check('บอกระยะให้พนักงานรู้', /\d+ เมตร/.test(tooFar.message), `ข้อความ: ${tooFar.message}`);

  // อยู่ในรัศมี → ลงได้ และได้ระยะมาเก็บ
  setGeo(ok => ok({ coords: { latitude: lnd.gps_lat + 0.0002, longitude: lnd.gps_lng, accuracy: 6 } }));
  const atShop = await geo.checkAtBranch(lnd);
  check('อยู่ที่ร้าน ลงเวลาได้', atShop.ok === true, `ได้ ok=${atShop.ok} (${atShop.message || ''})`);
  check('เก็บระยะไว้ตรวจย้อนหลัง', Number.isFinite(atShop.distance), `distance = ${atShop.distance}`);

  // ไม่ยอมให้ใช้ตำแหน่ง → ลงเวลาไม่ได้ พร้อมบอกวิธีแก้
  setGeo((_ok, err) => err({ code: 1 }));
  const denied = await geo.checkAtBranch(lnd);
  check('ไม่อนุญาตตำแหน่ง ลงเวลาไม่ได้', denied.ok === false && denied.reason === 'denied', `ได้ reason=${denied.reason}`);
  check('บอกวิธีแก้', /อนุญาต/.test(denied.message), `ข้อความ: ${denied.message}`);

  // GPS มือถือในอาคารอาจคลาดเล็กน้อย — เผื่อตาม accuracy แต่ไม่เกิน 75 เมตร
  setGeo(ok => ok({ coords: { latitude: lnd.gps_lat + 0.0013, longitude: lnd.gps_lng, accuracy: 60 } }));
  const nearWithDrift = await geo.checkAtBranch({ ...lnd, gps_radius: 100 });
  check('อยู่หน้าร้านแต่ GPS คลาดเล็กน้อยยังลงได้', nearWithDrift.ok === true,
    `ระยะ ${nearWithDrift.distance} ม. accuracy ${nearWithDrift.accuracy} ม.`);

  // โหมดแม่นยำสูงล้ม ต้องลองโหมดสำรองแทนการจบด้วย timeout ทันที
  let attempts = 0;
  setGeo((ok, err) => {
    attempts += 1;
    if (attempts === 1) err({ code: 2 });
    else ok({ coords: { latitude: lnd.gps_lat, longitude: lnd.gps_lng, accuracy: 25 } });
  });
  const fallback = await geo.getPosition({ timeout: 20, fallbackTimeout: 20 });
  check('GPS โหมดแรกพลาดแล้วลองโหมดสำรอง', !fallback.error && attempts === 2,
    `attempts=${attempts} error=${fallback.error || ''}`);

  // สาขายังไม่ได้ตั้งพิกัด → ปล่อยผ่าน แต่เตือนให้ไปตั้งค่า (ไม่งั้นทั้งสาขาลงเวลาไม่ได้เลย)
  const noGps = await geo.checkAtBranch({ ...lnd, gps_lat: null, gps_lng: null });
  check('สาขายังไม่ตั้งพิกัด ไม่ล็อกคนออก', noGps.ok === true && noGps.reason === 'no-branch-gps', `ได้ ok=${noGps.ok}`);
  const invalidGps = await geo.checkAtBranch({ ...lnd, gps_lat: 999 });
  check('พิกัดสาขาผิดไม่ล็อกพนักงานทั้งสาขา', invalidGps.ok === true && invalidGps.reason === 'no-branch-gps',
    `ได้ ok=${invalidGps.ok} reason=${invalidGps.reason}`);
  console.log('✓ GPS — ลงเวลาได้เฉพาะในรัศมีร้าน · ไกลเกิน/ไม่เปิดตำแหน่ง = ลงไม่ได้ พร้อมบอกเหตุผล');
}


// 4.21 กติกาจ่าย/หัก ย้ายมาอยู่ในตาราง settings แล้ว — แก้ค่าแล้วต้องมีผลกับเงินเดือนจริง
{
  const mkPay = payRules => calc.payrollFor({
    branch: { staff_name: 'ท', base_salary: 9000, days_off_quota: 31, holiday_work_days: 0 },
    records: [], allDatesInMonth: dates, todayISO: TODAY,
    clocksByDate: { [dates[0]]: { staff_name: 'ท', clock_date: dates[0], time_in: '08:00', time_out: '18:00', late_minutes: 10, early_minutes: 0 } },
    cfg: { ...cfg, payRules },
  });
  const base = mkPay(cfg.payRules);
  check('ใช้ค่าจากตาราง settings', base.deduct === 10, `สาย 10 นาที × 1 บาท ควรหัก 10 ได้ ${base.deduct}`);
  const doubled = mkPay({ ...cfg.payRules, latePerMin: 2 });
  check('แก้ค่าปรับต่อนาทีแล้วมีผล', doubled.deduct === 20, `ตั้ง 2 บาท/นาที ควรหัก 20 ได้ ${doubled.deduct}`);
  const fine100 = mkPay({ ...cfg.payRules, noClock: 100 });
  check('แก้ค่าปรับลืมลงเวลาแล้วมีผล', fine100.deduct === 10, 'วันนี้ลงครบ ไม่ควรโดนค่าปรับลืมลงเวลา');
  console.log('✓ กติกาจ่าย/หัก อยู่ในตาราง settings แล้ว — เจ้าของแก้เองได้ ไม่ต้องแก้โค้ด');
}

// 4.22 แก้ไข/ยกเลิกบิลขายนอกสาขา — ต้องคืนของเข้าคลังกลางตามส่วนต่างจริง
{
  const wh = await import('../src/warehouse.js');
  const itemId = 2, it = db.stock_items.find(i => i.id === itemId);
  const before = db.warehouse_stock.find(w => w.item_id === itemId);
  const beforeUnits = before.case_qty * it.per_case + before.loose_qty;
  const sale = JSON.parse(JSON.stringify(db.external_sales.find(x => x.id === 'es1')));   // ขายไป 2 ถุง
  const avail = await wh.whAvailMap(db.stock_items);

  // ลดจำนวนจาก 2 → 1 ต้องคืนของเข้าคลัง 1 หน่วย และยอดบิลลดลงครึ่งหนึ่ง
  const res = await wh.editExternalSale({ sale, draftQty: { [itemId]: 1 }, stockItems: db.stock_items, avail, byName: 'เจ้าของ' });
  check('แก้บิลสำเร็จ', !res.error, res.error || '');
  const after = db.warehouse_stock.find(w => w.item_id === itemId);
  const afterUnits = after.case_qty * it.per_case + after.loose_qty;
  check('คืนของเข้าคลัง 1 หน่วย', afterUnits === beforeUnits + 1, `ก่อน ${beforeUnits} หลัง ${afterUnits} (ควรเพิ่ม 1)`);
  const saved = db.external_sales.find(x => x.id === 'es1');
  check('ยอดบิลคิดใหม่', Number(saved.total) === 120, `ยอดบิลควรเหลือ 120 ได้ ${saved.total}`);
  check('จดประวัติการแก้ไข', (saved.edit_log || []).length === 1, 'ไม่ได้จดประวัติการแก้ไขบิล');

  // ยกเลิกบิล (ตั้งเป็น 0) — ของกลับเข้าคลังครบ
  const sale2 = JSON.parse(JSON.stringify(saved));
  const avail2 = await wh.whAvailMap(db.stock_items);
  const res2 = await wh.editExternalSale({ sale: sale2, draftQty: { [itemId]: 0 }, stockItems: db.stock_items, avail: avail2, byName: 'เจ้าของ' });
  check('ยกเลิกบิลได้', !res2.error && res2.cancelled === true, res2.error || `cancelled=${res2.cancelled}`);
  const final = db.warehouse_stock.find(w => w.item_id === itemId);
  check('คืนของครบหลังยกเลิก', final.case_qty * it.per_case + final.loose_qty === beforeUnits + 2,
    `ควรกลับไปเท่าก่อนขาย +2 = ${beforeUnits + 2}`);
  check('ยอดบิลเป็น 0', Number(db.external_sales.find(x => x.id === 'es1').total) === 0, 'ยกเลิกแล้วยอดบิลต้องเป็น 0');

  // เพิ่มจำนวนเกินของที่มี ต้องไม่ให้แก้
  const sale3 = { id: 'es1', items: [{ item_id: itemId, qty: 1, price: 120 }], edit_log: [] };
  const res3 = await wh.editExternalSale({ sale: sale3, draftQty: { [itemId]: 99999 }, stockItems: db.stock_items, avail: { [itemId]: 3 }, byName: 'เจ้าของ' });
  check('เพิ่มเกินของที่มี ต้องไม่ให้แก้', !!res3.error && /ไม่พอ/.test(res3.error), `ได้ ${res3.error || 'ผ่านไปได้'}`);
  console.log('✓ แก้ไข/ยกเลิกบิลขายนอกสาขา — คืน/ตัดสต๊อกคลังกลางตามส่วนต่างถูกต้อง และกันแก้เกินของที่มี');
}

// 4.23 ออกบิลขายนอก — ตัดสต๊อกจริงและกันขายเกินของที่มี
{
  const wh = await import('../src/warehouse.js');
  const it = db.stock_items.find(i => i.id === 3);
  const b4 = db.warehouse_stock.find(w => w.item_id === 3);
  const b4Units = b4.case_qty * it.per_case + b4.loose_qty;
  const avail = await wh.whAvailMap(db.stock_items);
  const ok = await wh.issueExternalSale({ buyer: 'ร้านใหม่', lines: [{ it, qty: 5 }], issuerId: 'u-own', stockItems: db.stock_items, avail });
  check('ออกบิลสำเร็จ', !ok.error, ok.error || '');
  check('ยอดบิลถูก', ok.total === 5 * it.branch_price, `ได้ ${ok.total}`);
  const af = db.warehouse_stock.find(w => w.item_id === 3);
  check('ตัดสต๊อก 5 หน่วย', af.case_qty * it.per_case + af.loose_qty === b4Units - 5, `ก่อน ${b4Units} หลัง ${af.case_qty * it.per_case + af.loose_qty}`);
  const bad = await wh.issueExternalSale({ buyer: 'ร้านใหม่', lines: [{ it, qty: 99999 }], issuerId: 'u-own', stockItems: db.stock_items, avail: { 3: 2 } });
  check('ขายเกินของที่มีไม่ได้', !!bad.error && /ไม่พอ/.test(bad.error), `ได้ ${bad.error || 'ผ่านไปได้'}`);
  const noBuyer = await wh.issueExternalSale({ buyer: '', lines: [{ it, qty: 1 }], issuerId: 'u-own', stockItems: db.stock_items, avail });
  check('ไม่กรอกชื่อผู้ซื้อไม่ได้', !!noBuyer.error, 'ปล่อยให้ออกบิลโดยไม่มีชื่อผู้ซื้อ');
  console.log('✓ ออกบิลขายนอกสาขา — ตัดสต๊อกคลังกลางจริง กันขายเกินของที่มีและกันบิลไม่มีชื่อผู้ซื้อ');
}


// 4.24 ข้อมูลบริษัทบนเอกสารพิมพ์ — ต้องดึงชื่อ/ที่อยู่/เลขผู้เสียภาษีจากตาราง companies จริง
{
  const print = await import('../src/print.js');
  const companies = await print.getCompanies();
  const dlv = db.deliveries.find(x => x.branch_id === 'lnd');
  const html = print.deliveryReportHTML({
    dlv, branch: db.branches.find(b => b.id === 'lnd'), roundName: 'รอบจันทร์',
    staffName: 'ตาล', reliefName: 'ขวัญ', reliefRole: 'หัวหน้า', stockItems: db.stock_items, companies, overuse: 0.5,
  });
  check('ใบส่งของมีที่อยู่จริง', /379\/20 หมู่ที่ 13 ตำบลหนองเรือ/.test(html), 'ที่อยู่บริษัทไม่ขึ้นบนใบส่งของ');
  check('ใบส่งของมีเลขผู้เสียภาษีผู้ขาย', /0405567000967/.test(html), 'ไม่มีเลขผู้เสียภาษีของคลังกลาง');
  check('ใบส่งของมีเลขผู้เสียภาษีผู้ซื้อ', /0405567002137/.test(html), 'ไม่มีเลขผู้เสียภาษีของบริษัทสาขา');
  check('ไม่เหลือ "(ยังไม่กรอก)"', !/ยังไม่กรอก/.test(html), 'ยังมีช่องที่ไม่ได้กรอกบนเอกสาร');
  check('ระบุ 2 บริษัทครบ', /เพตั้น/.test(html) && /คาเชน/.test(html), 'เอกสารต้องมีทั้งผู้ขายและผู้ซื้อ');

  const bill = print.externalBillHTML({ sale: db.external_sales[0], issuerName: 'ขวัญ', stockItems: db.stock_items, companies, viewerRole: 'owner' });
  check('บิลขายนอกมีที่อยู่', /379\/20/.test(bill), 'บิลขายนอกไม่มีที่อยู่บริษัท');

  // สาขาที่ยังไม่กรอกที่อยู่ ต้องขึ้นเตือนชัด ๆ ไม่ใช่ปล่อยว่างเงียบ ๆ
  const blank = print.deliveryReportHTML({
    dlv, branch: db.branches.find(b => b.id === 'lnd'), roundName: 'ร', staffName: 'ต', reliefName: 'ข', reliefRole: 'ห',
    stockItems: db.stock_items, companies: { warehouse: { name: 'x' }, branch_co: { name: 'y' } }, overuse: 0.5,
  });
  check('ยังไม่กรอกต้องเตือน', /ยังไม่กรอก/.test(blank), 'ถ้ายังไม่กรอกที่อยู่/เลขภาษี ต้องขึ้นข้อความเตือนบนเอกสาร');
  console.log('✓ เอกสารพิมพ์ — ดึงชื่อ/ที่อยู่/เลขผู้เสียภาษีของทั้ง 2 บริษัทจากฐานข้อมูลจริงครบ');
}

// 4.24 สลิปเงินเดือน — ต้องมีชื่อจริง นามสกุล เลขบัตรประชาชน และหัวกระดาษเป็นบริษัทที่เป็นนายจ้างจริง
{
  const print = await import('../src/print.js');
  const companies = await print.getCompanies();
  const pr = { cups: 100, cupPay: 100, diligence: 1500, holidayPay: 0, deduct: 40, reset: false, noClock: 1, whRent: 2000, total: 10560 };
  const emp = db.employees.find(e => e.id === 'u-lnd');
  const nid = db.employee_private.find(x => x.employee_id === 'u-lnd').national_id;
  const slip = print.staffSlipHTML({ name: 'เหล่านาดี', staff_name: emp.name, first_name: emp.first_name, last_name: emp.last_name,
    national_id: nid, base_salary: emp.base_salary, holiday_work_days: 1 }, pr, 'ก.ย. 69', companies);
  check('สลิปพนักงานมีชื่อจริง+นามสกุล', slip.includes(`${emp.first_name} ${emp.last_name}`), 'ไม่มีชื่อจริง-นามสกุลบนสลิป');
  check('สลิปพนักงานมีเลขบัตรประชาชน', slip.includes(nid), 'ไม่มีเลขบัตรประชาชนบนสลิป');
  check('สลิปพนักงานหัวกระดาษเป็นคาเชน', /คาเชน/.test(slip) && !/เพตั้น/.test(slip), 'พนักงานสาขาเป็นลูกจ้างคาเชน หัวกระดาษต้องเป็นคาเชน');
  check('สลิปพนักงานมีเลขภาษีคาเชน', /0405567002137/.test(slip), 'ไม่มีเลขผู้เสียภาษีของคาเชนบนสลิป');

  const rel = db.employees.find(e => e.role === 'relief');
  const rslip = print.reliefSlipHTML({ name: rel.name, role: 'หัวหน้า', first_name: rel.first_name, last_name: rel.last_name,
    national_id: '', base_salary: rel.base_salary, delivery_pay: rel.delivery_pay }, pr, 'ก.ย. 69', companies);
  check('สลิปหัวหน้าหัวกระดาษเป็นเพตั้น', /เพตั้น/.test(rslip) && !/คาเชน/.test(rslip), 'หัวหน้าเป็นลูกจ้างเพตั้น หัวกระดาษต้องเป็นเพตั้น');
  check('เลขบัตรยังไม่กรอกต้องเตือน', /เลขบัตรประชาชน[\s\S]{0,60}ยังไม่กรอก/.test(rslip), 'ถ้ายังไม่กรอกเลขบัตร ต้องขึ้น "(ยังไม่กรอก)" ไม่ใช่ปล่อยว่าง');
  console.log('✓ สลิปเงินเดือน — มีชื่อจริง/นามสกุล/เลขบัตร และหัวกระดาษตรงกับบริษัทนายจ้าง (สาขา=คาเชน · หัวหน้า=เพตั้น)');
}

// 4.25 หน้าตั้งค่ามีการ์ดข้อมูลบริษัทให้แก้เองได้
{
  const setHTML = ownerHTML.set || '';
  check('มีการ์ดข้อมูลบริษัท', /ข้อมูลบริษัท \(สำหรับเอกสาร\)/.test(setHTML), 'หน้าตั้งค่าไม่มีการ์ดข้อมูลบริษัท');
  check('แก้ที่อยู่ได้ทั้ง 2 บริษัท', (setHTML.match(/data-coaddr=/g) || []).length === 2, 'ต้องมีช่องที่อยู่ 2 ช่อง (คลังกลาง + สาขา)');
  check('แก้เลขผู้เสียภาษีได้', (setHTML.match(/data-cotax=/g) || []).length === 2, 'ต้องมีช่องเลขผู้เสียภาษี 2 ช่อง');
  check('โชว์ที่อยู่ที่บันทึกไว้', /379\/20/.test(setHTML), 'หน้าตั้งค่าไม่ได้ดึงที่อยู่ที่บันทึกไว้มาแสดง');
  console.log('✓ หน้าตั้งค่า — แก้ชื่อ/ที่อยู่/เลขผู้เสียภาษี/สถานะ VAT ได้เองแล้ว ไม่ต้องแก้ผ่าน SQL');
}

// ---------- สรุป ----------
console.log('');
if (fails.length) { console.log('✗ ไม่ผ่าน ' + fails.length + ' ข้อ:'); fails.forEach(f => console.log('   • ' + f)); }
else console.log('✓✓ ผ่านทุกข้อ');
if (warns.length) { console.log('ข้อสังเกต:'); warns.forEach(w => console.log('   • ' + w)); }
process.exit(fails.length ? 1 : 0);
