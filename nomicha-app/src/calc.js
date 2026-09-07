// สูตรคำนวณที่ใช้ร่วมกันหลายหน้า (เงินเดือน/กำไรขาดทุน/รายการที่ต้องจัดส่ง) — พอร์ตตรงจากต้นแบบ nomicha.html
// เป็นฟังก์ชัน "บริสุทธิ์" ทั้งหมด (รับ array ข้อมูลที่ดึงมาแล้วเข้ามา ไม่ยิง query เอง) เพื่อให้ทดสอบเทียบกับต้นแบบได้ง่าย
// และใช้ซ้ำได้ทั้งหน้าหัวหน้า/หน้าเจ้าของ โดยไม่ต้องเขียนสูตรซ้ำสองที่
//
// หมายเหตุสำคัญที่ต่างจากต้นแบบเล็กน้อย (ตั้งใจ ไม่ใช่บั๊ก): ต้นแบบคำนวณ "ยอดตั้งต้นแก้ว" ของแต่ละวัน (baseYen/basePan)
// จากยอดปิดของวันก่อนหน้า ถ้าวันนั้นไม่มีการนับแก้วยืนยัน (clock.openYen) เพราะข้อมูลสาธิตบางวันไม่ครบ
// ระบบจริงบังคับให้พนักงานยืนยันนับแก้ว (clock_records.open_yen/open_pan) ทุกวันก่อนปิดยอดได้เสมอ (ดู pages/staff.js)
// จึงใช้ค่า open_yen/open_pan ของ "วันนั้นเอง" เป็นฐานได้ตรง ๆ โดยไม่ต้องไล่ย้อนหาวันก่อนหน้า — ง่ายกว่าและถูกต้องเท่ากัน
import { N, isoDate, hmToMin } from './util.js';

export const isSettled = (a, todayISO) => a.repaid || a.due_date < todayISO;

// พอร์ตจาก rentAt()/whRentAt() — ค่าเช่าที่มีผล ณ วันที่กำหนด (แก้ค่าเช่าวันนี้ไม่มีผลย้อนหลังไปเดือนที่ผ่านไปแล้ว)
// history: [{from:'YYYY-MM-DD', rent:น้ำหนัก}] เรียงจากเก่าไปใหม่ (ตรงกับ branch_rent_history/warehouse_rent_history)
export function rentAt(history, dateISO) {
  if (!history || !history.length) return 0;
  let v = history[0].rent;
  for (const e of history) { if (e.from <= dateISO) v = e.rent; else break; }
  return v;
}

// พอร์ตจาก isAdvanceDay()/nextSettleDate() — ใช้ตอนพนักงานขอเบิกเงิน/เงินกู้
export const isAdvanceDay = (dateISO, advanceDay) => new Date(dateISO + 'T00:00:00').getDate() === advanceDay;
// วันครบกำหนดหักคืนของเงินเบิก/เงินกู้ — ต้องใช้ isoDate() ห้าม toISOString() (ที่ไทยจะได้วันที่เลื่อนไป 1 วัน
// ทำให้เงินกู้ถูกนับว่า "หักคืนแล้ว" เร็วไป 1 วัน แล้วยอดหักไปโผล่ผิดงวด) — ต้นแบบใช้ isoDate เหมือนกัน
export function nextSettleDate(dateISO, settleDays) {
  const d0 = new Date(dateISO + 'T00:00:00');
  for (let i = 1; i <= 40; i++) {
    const t = new Date(d0); t.setDate(d0.getDate() + i);
    if (settleDays.includes(t.getDate())) return isoDate(t);
  }
  return dateISO;
}

// พอร์ตจาก outstanding()/loanRoom()/roomFor() — วงเงินเบิก/กู้ที่ยังขอได้อีกของคนคนหนึ่ง
const outstanding = (advancesForPerson, todayISO, type) =>
  advancesForPerson.filter(a => !isSettled(a, todayISO) && a.type === type).reduce((s, a) => s + a.amount, 0);
const loanRoom = (advancesForPerson, todayISO, loanCap) =>
  Math.max(0, loanCap - outstanding(advancesForPerson, todayISO, 'loan'));
export const roomFor = (advancesForPerson, todayISO, onAdvDay, cfg) => onAdvDay
  ? Math.max(0, cfg.advanceCap - outstanding(advancesForPerson, todayISO, 'advance'))
  : loanRoom(advancesForPerson, todayISO, cfg.loanCap);

// พอร์ตจาก advBreakdown() — สรุปยอดเบิก/กู้ที่ยังไม่ครบกำหนดของคนคนหนึ่ง แยกเป็น 3 ก้อนตามที่มา
function advBreakdown(advancesForPerson, todayISO, advanceDay) {
  const list = advancesForPerson.filter(a => !isSettled(a, todayISO));
  const sum = f => list.filter(f).reduce((s, a) => s + a.total, 0);
  const isRemit = a => a.source === 'remit';
  const due20 = a => new Date(a.due_date + 'T00:00:00').getDate() === advanceDay;
  const advance = sum(a => !isRemit(a) && a.type === 'advance');
  const loanAll = sum(a => !isRemit(a) && a.type === 'loan');
  const remitAll = sum(isRemit);
  const loan20 = sum(a => !isRemit(a) && a.type === 'loan' && due20(a));
  const remit20 = sum(a => isRemit(a) && due20(a));
  const absLoan = Math.min(advance, loan20);
  const absRemit = Math.min(Math.max(0, advance - loan20), remit20);
  const loan = loanAll - absLoan, remit = remitAll - absRemit;
  return {
    loan, advance, remit, total: loan + advance + remit,
    // r20 = สรุปยอดที่ "หักกลบกันแล้ว" ในรอบจ่ายเงินเบิกวันที่ 20 — เจ้าของใช้ดูตอนจ่ายรอบนั้น (ตารางเงินเดือน ownPay)
    r20: { advance, loan: loan20, remit: remit20, payout: Math.max(0, advance - loan20 - remit20) },
  };
}

/* ============================== มาสาย / ปิดไว ==============================
   เทียบเวลาที่ลงจริง (เวลาไทย) กับเวลาทำงานของสาขานั้น — คิดตอนกดลงเวลา แล้วเก็บลง clock_records
   เก็บเป็นตัวเลขไว้เลย ไม่คิดสดตอนทำเงินเดือน เพราะถ้าเจ้าของแก้เวลาทำงานทีหลัง ต้องไม่ย้อนไปเปลี่ยนของเดือนที่จ่ายไปแล้ว
   (หลักการเดียวกับค่าเช่าที่เก็บเป็นประวัติ — แก้วันนี้ไม่มีผลย้อนหลัง) */
export function lateMinutes(timeIn, workStart, graceMin = 0) {
  const t = hmToMin(timeIn), s = hmToMin(workStart);
  if (t == null || s == null) return 0;
  return Math.max(0, t - s - N(graceMin));
}
export function earlyMinutes(timeOut, workEnd) {
  const t = hmToMin(timeOut), e = hmToMin(workEnd);
  if (t == null || e == null) return 0;
  return Math.max(0, e - t);
}

// พอร์ตจาก calc() — คำนวณยอดขาย/รายจ่าย/เงินสดที่ควรมีของ 1 วัน จาก record จริง + clock ของวันเดียวกัน (open_yen/open_pan)
export function calcDay(rec, clock, cfg) {
  if (!rec) return null;
  const openYen = clock ? clock.open_yen : null, openPan = clock ? clock.open_pan : null;
  const cupYen = openYen != null ? (openYen + N(rec.yen_add) - N(rec.yen)) : 0;
  const cupPan = openPan != null ? (openPan + N(rec.pan_add) - N(rec.pan)) : 0;
  const income = cupYen * cfg.cupPrice.yen + cupPan * cfg.cupPrice.pan + N(rec.cup_own) + N(rec.topping) + N(rec.other);
  const expense = N(rec.ice) + N(rec.water) + N(rec.etc);
  const expectedTotal = N(rec.float_cash) + income - expense;
  const expectedCash = expectedTotal - (N(rec.transfer) + N(rec.grab) * (1 - cfg.grabCommissionPct) + N(rec.thaichaithai));
  return { cupYen, cupPan, cups: cupYen + cupPan, income, expense, expectedTotal, variance: N(rec.cash) - expectedCash };
}

// ยอดขายสุทธิของสาขาในเดือน — ต้องการ records + map ของ clock ตาม record_date (clocksByDate[date] = clock row)
export function aggregateBranchSales(records, clocksByDate, cfg) {
  let sales = 0, grab = 0;
  for (const r of records) {
    if (!r.sent) continue;
    const c = calcDay(r, clocksByDate[r.record_date], cfg);
    if (c) { sales += c.income - c.expense; grab += N(r.grab); }
  }
  return { sales, grab };
}

/* นับ "ลืมลงเวลา" ของคนคนหนึ่ง — หัก 40 บาท/ครั้ง (RULES.noClock)
   ต้องลงเวลาให้ครบทั้งเข้าและออก ลงไม่ครบถือว่าลืม · นับเฉพาะวันที่ผ่านไปแล้ว เพราะวันนี้ยังไม่จบ ยังลงเวลาออกได้อยู่
   คิดตอนทำเงินเดือน ไม่ได้เก็บเป็นธงตอนกดลงเวลา เพราะตอนนั้นยังไม่รู้ว่าสุดท้ายจะลืมลงเวลาออกหรือเปล่า */
function countNoClock(clockRows, workedDates, todayISO) {
  let n = 0;
  const seen = new Set();
  clockRows.forEach(c => {
    seen.add(c.clock_date);
    if (c.clock_date >= todayISO) return;               // วันนี้ยังไม่จบ ยังไม่ถือว่าลืม
    if (c.no_clock) { n++; return; }                    // เจ้าของทำเครื่องหมายไว้เอง
    if (!c.time_in || !c.time_out) n++;                 // ลงเวลาไม่ครบ (ขาดเข้า หรือขาดออก)
  });
  workedDates.forEach(d => { if (d < todayISO && !seen.has(d)) n++; });  // เปิดร้านขายทั้งวันแต่ไม่มีการลงเวลาเลย
  return n;
}

/* พอร์ตจาก payrollFor() — เงินเดือน "ของสาขา" ในเดือนที่กำหนด (1 สาขา = 1 บัญชี = 1 ก้อนเงินเดือน)
   records/clocks = ทุกแถวของสาขานั้นในเดือนนั้น ฟังก์ชันกรองเอง: นับทุกแถวของสาขา ยกเว้นวันที่หัวหน้ามาทำแทน
   (เจ้าของเลือกไว้ 5 ก.ย. 69 — ถ้าเปลี่ยนคนกลางเดือน ยอดยังรวมเป็นก้อนเดียวของสาขา ไม่แยกตามชื่อคน) */
export function payrollFor({ branch, records, clocksByDate, allDatesInMonth, advancesForStaff, todayISO, cfg }) {
  const ofBranch = n => !branch.relief_name || n !== branch.relief_name;   // ทุกคนที่ไม่ใช่หัวหน้า = คนของสาขา
  let cups = 0, late = 0, early = 0;
  records.forEach(r => {
    if (ofBranch(r.staff_name) && r.sent) {
      const c = calcDay(r, clocksByDate[r.record_date], cfg);
      cups += c ? c.cups : 0;
    }
  });
  const myClocks = Object.values(clocksByDate).filter(c => c && ofBranch(c.staff_name));
  myClocks.forEach(c => { late += c.late_minutes || 0; early += c.early_minutes || 0; });
  const noClock = countNoClock(myClocks, records.filter(r => ofBranch(r.staff_name)).map(r => r.record_date), todayISO);

  const counted = allDatesInMonth.filter(d => d < todayISO || records.some(r => r.record_date === d) || clocksByDate[d]);
  const worked = counted.filter(d => records.some(r => r.record_date === d && ofBranch(r.staff_name))).length;
  const daysOffTaken = Math.max(0, counted.length - worked);
  const excess = Math.max(0, daysOffTaken - branch.days_off_quota);
  const reset = (late + early) > cfg.diligenceRules.lateAllowance || excess > 0;
  const dilBase = Math.min(cfg.diligenceRules.cap, cfg.diligenceRules.step * 3);
  const diligence = reset ? 0 : dilBase;
  const holidays = branch.holiday_work_days || 0;
  const holidayPay = holidays ? cfg.holidayPayScale.slice(0, holidays).reduce((a, c) => a + c, 0) : 0;
  const R = cfg.payRules;
  const cupPay = cups * R.cupPay;
  const deduct = late * R.latePerMin + early * R.earlyPerMin + noClock * R.noClock + excess * R.excessDayOff;
  const advBreak = advBreakdown(advancesForStaff, todayISO, cfg.advanceDay);
  const total = branch.base_salary + diligence + holidayPay + cupPay - deduct - advBreak.total;
  return { cups, late, early, noClock, excess, reset, diligence, holidayPay, cupPay, deduct, advBreak, total, advanceDeduct: advBreak.total };
}

/* พอร์ตจาก payrollForRelief() — เงินเดือนหัวหน้า (ไม่ผูกสาขาเดียว วนดูทุกสาขาที่ไปแทน)
   ต่างจากพนักงานสาขา (เจ้าของสั่งแก้ 5 ก.ย. 69): หัวหน้าไปทำแทนหลายสาขาคนละเวลา บางวันต้องไปส่งของก่อนแล้วค่อยไปเปิดร้าน
   จึงไม่หัก "มาสาย/ปิดไว" กับหัวหน้า — แต่ยัง "ต้องลงเวลาให้ครบเข้า-ออก" เหมือนกัน ลืมลงเวลายังหัก 40 บาท/ครั้ง */
export function payrollForRelief({ relief, allBranchRecords, allBranchClocksByDate, advancesForRelief, todayISO, cfg, whRent }) {
  let cups = 0;
  allBranchRecords.forEach(r => {
    if (r.sent && r.staff_name === relief.name) {
      const c = calcDay(r, allBranchClocksByDate[r.branch_id]?.[r.record_date], cfg);
      cups += c ? c.cups : 0;
    }
  });
  const myClocks = [];
  Object.values(allBranchClocksByDate).forEach(byDate => Object.values(byDate).forEach(c => {
    if (c && c.staff_name === relief.name) myClocks.push(c);
  }));
  const workedDates = allBranchRecords.filter(r => r.staff_name === relief.name).map(r => r.record_date);
  const noClock = countNoClock(myClocks, workedDates, todayISO);
  const cupPay = cups * cfg.payRules.cupPay;
  const deduct = noClock * cfg.payRules.noClock;   // ไม่มีหักมาสาย/ปิดไว
  const advBreak = advBreakdown(advancesForRelief, todayISO, cfg.advanceDay);
  const total = relief.base_salary + relief.delivery_pay + whRent + cupPay - deduct - advBreak.total;
  return { cups, noClock, deduct, cupPay, whRent, advBreak, total, advanceDeduct: advBreak.total, diligence: 0, holidayPay: 0, reset: false, late: 0, early: 0 };
}

// พอร์ตจาก branchPL() — กำไร/ขาดทุนรายสาขาในเดือนที่กำหนด
export function branchPL({ sales, grab, materialCost, rent, repairs, grabCommissionPct, payroll }) {
  const materialRate = sales > 0 ? materialCost / sales : 0;
  const labor = payroll.total + payroll.advanceDeduct;
  const repairsTotal = repairs.reduce((s, x) => s + Number(x.cost), 0);
  const grabCommission = grab * grabCommissionPct;
  const net = (sales - materialCost) - labor - rent - repairsTotal - grabCommission;
  return { sales, materialCost, materialRate, labor, rent, repairs: repairsTotal, grabCommission, net };
}

// ต้นทุนวัตถุดิบของสาขาในเดือน = ของที่คลังกลางจัดส่งไปจริงตามใบส่งของ (ใช้ยอด "รับจริง" ถ้าเช็คแล้ว) × ราคาส่งสาขา
export function monthMaterialCost(deliveries, stockItemsById) {
  return deliveries.reduce((s, dlv) => s + Object.entries(dlv.items).reduce((s2, [id, qty]) => {
    const it = stockItemsById[id]; if (!it) return s2;
    const actual = dlv.received && dlv.received[id] != null ? dlv.received[id] : qty;
    return s2 + actual * it.branch_price;
  }, 0), 0);
}

// พอร์ตจาก pickList() — รายการที่ต้องจัดส่งให้สาขา (par - have) เฉพาะที่ยังขาด
export function pickList(stockItems, parByItemId, lastStockSnapshot) {
  return stockItems.map(it => {
    const par = parByItemId[it.id] ?? 0;
    const have = lastStockSnapshot ? (lastStockSnapshot[it.id] ?? 0) : 0;
    return { it, par, have, need: Math.max(0, par - have) };
  }).filter(x => x.need > 0);
}

// พอร์ตจาก warehousePL() — กำไรคลังกลาง (ส่วนต่างราคาวัตถุดิบของทุกอย่างที่ส่งออกไปในเดือน ลบค่าแรงหัวหน้าเต็มจำนวน)
export function warehousePL({ deliveries, externalSales, stockItemsById, avgCostById, reliefPayroll }) {
  let sales = 0, cost = 0;
  const add = (qty, price, itemId) => { sales += qty * price; cost += qty * (avgCostById[itemId] ?? 0); };
  deliveries.forEach(dlv => Object.entries(dlv.items).forEach(([id, qty]) => {
    const it = stockItemsById[id]; if (!it) return;
    const actual = dlv.received && dlv.received[id] != null ? dlv.received[id] : qty;
    add(actual, it.branch_price, id);
  }));
  externalSales.forEach(sale => sale.items.forEach(li => add(li.qty, li.price, li.item_id)));
  const headLabor = reliefPayroll.total + reliefPayroll.advanceDeduct;
  return { sales, cost, materialMargin: sales - cost, headLabor, net: sales - cost - headLabor };
}

// พอร์ตจาก cashSurplus()/cashPending() — เงินสดที่สาขาเก็บไว้เกินเงินทอนตั้งต้น ต้องส่งให้หัวหน้า
export function cashPending(records, lastRemitDate, remitLoanOffset) {
  const dates = records.filter(r => r.sent && (!lastRemitDate || r.record_date > lastRemitDate));
  const raw = dates.reduce((s, r) => s + Math.max(0, N(r.cash) - N(r.float_cash)), 0);
  return { dates: dates.map(r => r.record_date), amount: Math.max(0, raw - (remitLoanOffset || 0)) };
}
