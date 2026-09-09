// สูตรคำนวณที่ใช้ร่วมกันหลายหน้า (เงินเดือน/กำไรขาดทุน/รายการที่ต้องจัดส่ง) — พอร์ตตรงจากต้นแบบ nomicha.html
// เป็นฟังก์ชัน "บริสุทธิ์" ทั้งหมด (รับ array ข้อมูลที่ดึงมาแล้วเข้ามา ไม่ยิง query เอง) เพื่อให้ทดสอบเทียบกับต้นแบบได้ง่าย
// และใช้ซ้ำได้ทั้งหน้าหัวหน้า/หน้าเจ้าของ โดยไม่ต้องเขียนสูตรซ้ำสองที่
//
// หมายเหตุสำคัญที่ต่างจากต้นแบบเล็กน้อย (ตั้งใจ ไม่ใช่บั๊ก): ต้นแบบคำนวณ "ยอดตั้งต้นแก้ว" ของแต่ละวัน (baseYen/basePan)
// จากยอดปิดของวันก่อนหน้า ถ้าวันนั้นไม่มีการนับแก้วยืนยัน (clock.openYen) เพราะข้อมูลสาธิตบางวันไม่ครบ
// ระบบจริงบังคับให้พนักงานยืนยันนับแก้ว (clock_records.open_yen/open_pan) ทุกวันก่อนปิดยอดได้เสมอ (ดู pages/staff.js)
// จึงใช้ค่า open_yen/open_pan ของ "วันนั้นเอง" เป็นฐานได้ตรง ๆ โดยไม่ต้องไล่ย้อนหาวันก่อนหน้า — ง่ายกว่าและถูกต้องเท่ากัน
import { N, hmToMin } from './util.js';

// พอร์ตจาก rentAt()/whRentAt() — ค่าเช่าที่มีผล ณ วันที่กำหนด (แก้ค่าเช่าวันนี้ไม่มีผลย้อนหลังไปเดือนที่ผ่านไปแล้ว)
// history: [{from:'YYYY-MM-DD', rent:น้ำหนัก}] เรียงจากเก่าไปใหม่ (ตรงกับ branch_rent_history/warehouse_rent_history)
export function rentAt(history, dateISO) {
  if (!history || !history.length) return 0;
  let v = history[0].rent;
  for (const e of history) { if (e.from <= dateISO) v = e.rent; else break; }
  return v;
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
  if (rec.store_closed) {
    const float = N(rec.float_cash);
    return { cupYen: 0, cupPan: 0, cups: 0, income: 0, expense: 0,
      expectedTotal: float, variance: N(rec.cash) - float };
  }
  const openYen = rec.open_yen != null ? rec.open_yen : (clock ? clock.open_yen : null);
  const openPan = rec.open_pan != null ? rec.open_pan : (clock ? clock.open_pan : null);
  const cupYen = openYen != null ? (openYen + N(rec.yen_add) - N(rec.yen)) : 0;
  const cupPan = openPan != null ? (openPan + N(rec.pan_add) - N(rec.pan)) : 0;
  const yenPrice = rec.cup_price_yen != null ? N(rec.cup_price_yen) : cfg.cupPrice.yen;
  const panPrice = rec.cup_price_pan != null ? N(rec.cup_price_pan) : cfg.cupPrice.pan;
  const grabPct = rec.grab_commission_pct != null ? N(rec.grab_commission_pct) : cfg.grabCommissionPct;
  const income = cupYen * yenPrice + cupPan * panPrice + N(rec.cup_own) + N(rec.topping) + N(rec.other);
  const expense = N(rec.ice) + N(rec.water) + N(rec.etc);
  const expectedTotal = N(rec.float_cash) + income - expense;
  const expectedCash = expectedTotal - (N(rec.transfer) + N(rec.grab) * (1 - grabPct) + N(rec.thaichaithai));
  return { cupYen, cupPan, cups: cupYen + cupPan, income, expense, expectedTotal,
    grabCommission: N(rec.grab) * grabPct, variance: N(rec.cash) - expectedCash };
}

// ยอดขายสุทธิของสาขาในเดือน — ต้องการ records + map ของ clock ตาม record_date (clocksByDate[date] = clock row)
export function aggregateBranchSales(records, clocksByDate, cfg) {
  let sales = 0, grab = 0, grabCommission = 0;
  for (const r of records) {
    if (!r.sent) continue;
    const c = calcDay(r, clocksByDate[r.record_date], cfg);
    if (c) { sales += c.income - c.expense; grab += N(r.grab); grabCommission += N(c.grabCommission); }
  }
  return { sales, grab, grabCommission };
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
export function payrollFor({ branch, records, clocksByDate, allDatesInMonth, todayISO, cfg }) {
  const ofBranch = n => !branch.relief_name || n !== branch.relief_name;   // ทุกคนที่ไม่ใช่หัวหน้า = คนของสาขา
  const workRecords = records.filter(r => !r.store_closed);
  const closureByDate = new Map(records.filter(r => r.store_closed).map(r => [r.record_date, r]));
  let cups = 0, late = 0, early = 0;
  workRecords.forEach(r => {
    if (ofBranch(r.staff_name) && r.sent) {
      const c = calcDay(r, clocksByDate[r.record_date], cfg);
      cups += c ? c.cups : 0;
    }
  });
  const myClocks = Object.values(clocksByDate).filter(c => c && ofBranch(c.staff_name));
  myClocks.forEach(c => { late += c.late_minutes || 0; early += c.early_minutes || 0; });
  // รายการย้อนหลังที่นำเข้าผ่าน SQL ไม่มี created_by และไม่มีหลักฐานเวลาเข้า-ออก
  // ยังนับยอดขาย/ค่าแก้วตามจริง แต่ไม่สร้างค่าปรับ "ลืมลงเวลา" ขึ้นมาเองจากข้อมูลที่ไฟล์ไม่มี
  // รายการที่พนักงานหรือเจ้าของบันทึกผ่านแอปมี created_by เสมอ จึงใช้กติกาเดิมครบถ้วน
  const clockRequiredDates = workRecords
    .filter(r => ofBranch(r.staff_name) && r.created_by != null)
    .map(r => r.record_date);
  const noClock = countNoClock(myClocks, clockRequiredDates, todayISO);

  const counted = allDatesInMonth.filter(d => {
    const closure = closureByDate.get(d);
    if (closure && N(closure.leave_quota_days) === 0) return false;
    return d < todayISO || records.some(r => r.record_date === d) || clocksByDate[d];
  });
  const worked = counted.filter(d => workRecords.some(r => r.record_date === d && ofBranch(r.staff_name))).length;
  const closurePenalty = [...closureByDate.values()].reduce((sum, r) => sum + Math.max(0, N(r.leave_quota_days) - 1), 0);
  const daysOffTaken = Math.max(0, counted.length - worked) + closurePenalty;
  const excess = Math.max(0, daysOffTaken - branch.days_off_quota);
  const reset = (late + early) > cfg.diligenceRules.lateAllowance || excess > 0;
  const dilBase = Math.min(cfg.diligenceRules.cap, cfg.diligenceRules.step * 3);
  const diligence = reset ? 0 : dilBase;
  const holidays = branch.holiday_work_days || 0;
  const holidayPay = holidays ? cfg.holidayPayScale.slice(0, holidays).reduce((a, c) => a + c, 0) : 0;
  const R = cfg.payRules;
  const cupPay = cups * R.cupPay;
  const deduct = late * R.latePerMin + early * R.earlyPerMin + noClock * R.noClock + excess * R.excessDayOff;
  const total = branch.base_salary + diligence + holidayPay + cupPay - deduct;
  return { cups, late, early, noClock, daysOffTaken, excess, reset, diligence, holidayPay, cupPay, deduct, total };
}

/* พอร์ตจาก payrollForRelief() — เงินเดือนหัวหน้า (ไม่ผูกสาขาเดียว วนดูทุกสาขาที่ไปแทน)
   ต่างจากพนักงานสาขา (เจ้าของสั่งแก้ 5 ก.ย. 69): หัวหน้าไปทำแทนหลายสาขาคนละเวลา บางวันต้องไปส่งของก่อนแล้วค่อยไปเปิดร้าน
   จึงไม่หัก "มาสาย/ปิดไว" กับหัวหน้า — แต่ยัง "ต้องลงเวลาให้ครบเข้า-ออก" เหมือนกัน ลืมลงเวลายังหัก 40 บาท/ครั้ง */
export function payrollForRelief({ relief, allBranchRecords, allBranchClocksByDate, todayISO, cfg, whRent }) {
  let cups = 0;
  allBranchRecords.forEach(r => {
    if (!r.store_closed && r.sent && r.staff_name === relief.name) {
      const c = calcDay(r, allBranchClocksByDate[r.branch_id]?.[r.record_date], cfg);
      cups += c ? c.cups : 0;
    }
  });
  const myClocks = [];
  Object.values(allBranchClocksByDate).forEach(byDate => Object.values(byDate).forEach(c => {
    if (c && c.staff_name === relief.name) myClocks.push(c);
  }));
  const workedDates = allBranchRecords
    .filter(r => !r.store_closed && r.staff_name === relief.name && r.created_by != null)
    .map(r => r.record_date);
  const noClock = countNoClock(myClocks, workedDates, todayISO);
  const cupPay = cups * cfg.payRules.cupPay;
  const deduct = noClock * cfg.payRules.noClock;   // ไม่มีหักมาสาย/ปิดไว
  const total = relief.base_salary + relief.delivery_pay + whRent + cupPay - deduct;
  return { cups, noClock, deduct, cupPay, whRent, total, diligence: 0, holidayPay: 0, reset: false, late: 0, early: 0 };
}

// พอร์ตจาก branchPL() — กำไร/ขาดทุนรายสาขาในเดือนที่กำหนด
export function branchPL({ sales, grab, materialCost, rent, repairs, grabCommissionPct, grabCommission: snapCommission, payroll }) {
  const materialRate = sales > 0 ? materialCost / sales : 0;
  const labor = payroll.total;
  const repairsTotal = repairs.reduce((s, x) => s + Number(x.cost), 0);
  const grabCommission = snapCommission == null ? grab * grabCommissionPct : snapCommission;
  const net = (sales - materialCost) - labor - rent - repairsTotal - grabCommission;
  return { sales, materialCost, materialRate, labor, rent, repairs: repairsTotal, grabCommission, net };
}

// ต้นทุนวัตถุดิบของสาขาในเดือน = ของที่คลังกลางจัดส่งไปจริงตามใบส่งของ (ใช้ยอด "รับจริง" ถ้าเช็คแล้ว) × ราคาส่งสาขา
export function monthMaterialCost(deliveries, stockItemsById) {
  return deliveries.reduce((s, dlv) => s + Object.entries(dlv.items).reduce((s2, [id, qty]) => {
    const it = stockItemsById[id]; if (!it) return s2;
    const actual = dlv.received && dlv.received[id] != null ? dlv.received[id] : qty;
    const price = dlv.price_snapshot && dlv.price_snapshot[id] != null ? N(dlv.price_snapshot[id]) : it.branch_price;
    return s2 + actual * price;
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
  const add = (qty, price, itemId, unitCost) => { sales += qty * price; cost += qty * (unitCost ?? avgCostById[itemId] ?? 0); };
  deliveries.forEach(dlv => Object.entries(dlv.items).forEach(([id, qty]) => {
    const it = stockItemsById[id]; if (!it) return;
    const actual = dlv.received && dlv.received[id] != null ? dlv.received[id] : qty;
    const price = dlv.price_snapshot && dlv.price_snapshot[id] != null ? N(dlv.price_snapshot[id]) : it.branch_price;
    const unitCost = dlv.cost_snapshot && dlv.cost_snapshot[id] != null ? N(dlv.cost_snapshot[id]) : undefined;
    add(actual, price, id, unitCost);
  }));
  externalSales.forEach(sale => sale.items.forEach(li => add(li.qty, li.price, li.item_id, li.cost)));
  const headLabor = reliefPayroll.total;
  return { sales, cost, materialMargin: sales - cost, headLabor, net: sales - cost - headLabor };
}

// พอร์ตจาก cashSurplus()/cashPending() — เงินสดที่สาขาเก็บไว้เกินเงินทอนตั้งต้น ต้องส่งให้หัวหน้า
export function cashPending(records, lastRemitDate) {
  const pendingRows = records.filter(r => r.sent && (!lastRemitDate || r.record_date > lastRemitDate));
  const cashRows = pendingRows.filter(r => N(r.cash) > N(r.float_cash));
  const raw = cashRows.reduce((s, r) => s + N(r.cash) - N(r.float_cash), 0);
  return { dates: cashRows.map(r => r.record_date), amount: Math.max(0, raw),
    throughDate: pendingRows.reduce((m, r) => !m || r.record_date > m ? r.record_date : m, lastRemitDate || null) };
}
