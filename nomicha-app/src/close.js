// ปิดยอดประจำวัน — ฟอร์ม/ตรวจค่า/บันทึก ใช้ร่วมกันทั้งพนักงานสาขาและหัวหน้าตอนไปแทนสาขา
// พอร์ตตรงจาก makeDraft()/numField()/closeDay() ในต้นแบบ nomicha.html
//
// เดิมโค้ดชุดนี้เขียนซ้ำสองที่ (staff.js กับ relief.js) แล้วเพี้ยนกันจริง ๆ 2 จุด:
//   1) ฝั่งหัวหน้าเก็บสต๊อกของเมื่อวานทับมาทั้งก้อน ทำให้ "แถวแก้ว" ในสต๊อกเป็นของเมื่อวาน ไม่ใช่ยอดที่นับวันนี้
//      (กระทบรายการที่ต้องจัดส่งรอบถัดไป เพราะ pickList อ่านสต๊อกแถวแก้วจากตรงนี้)
//   2) ฝั่งพนักงานเด้งข้อความบอก "เงินสดขาด/เกิน" หลังกดส่ง ซึ่งผิดกติกาที่ตกลงกันไว้ว่าพนักงานต้องไม่เห็นผลตรวจสอบ
// รวมมาไว้ที่เดียวแล้ว แก้ทีเดียวมีผลทั้งสองฝั่ง ไม่มีทางเพี้ยนกันอีก
import { supabase } from './supabaseClient.js';
import { N, esc } from './util.js';

export const CLOSE_REASON_OPTIONS = [
  { value: 'approved_leave', label: 'หยุดส่วนตัว (ไม่มีคนแทน)', quota: 1 },
  { value: 'absent', label: 'พนักงานขาดงาน', quota: 2 },
  { value: 'owner_or_necessary', label: 'เจ้าของสั่งปิด / ร้านมีเหตุจำเป็น', quota: 0 },
];

const closureReason = value => CLOSE_REASON_OPTIONS.find(x => x.value === value) || CLOSE_REASON_OPTIONS[2];

// เก็บเป็น daily record เพื่อให้วันถัดไปดึงยอดเมื่อวานได้ตามปกติ แต่ไม่ใช่วันเปิดขาย
// สำหรับ approved_leave ระบบฐานข้อมูลจะคัดลอกแก้วคงเหลือ สต๊อก และเงินทอนจากวันก่อนหน้า
// พร้อมบันทึกรายได้/รายจ่าย/โอน/Grab เป็น 0 จึงไม่สร้างยอดขายปลอมในวันหยุด
export async function closeStore({ branchId, dateISO, reason }) {
  const rule = closureReason(reason);
  const { data, error } = await supabase.rpc('record_store_closure', {
    p_branch_id: branchId, p_record_date: dateISO, p_reason: rule.value,
  });
  return error ? { error: error.message } : { reason: rule, data };
}

export function updateClosure({ recordId, reason }) {
  return supabase.rpc('owner_update_closure', { p_record_id: recordId, p_reason: reason });
}

export function cancelClosure({ recordId, reason }) {
  return supabase.rpc('owner_cancel_closure', { p_record_id: recordId, p_reason: reason || 'ยกเลิกสถานะปิดร้าน' });
}

// ฟอร์มปิดยอดที่ยังกรอกไม่เสร็จ — เงินทอนตั้งต้นใช้ค่าที่กรอกไว้ครั้งล่าสุด (ต้นแบบเก็บทับลง b.float หลังส่งยอด
// ระบบจริงอ่านจากยอดปิดล่าสุดแทน ได้ผลเหมือนกันโดยไม่ต้องให้พนักงานมีสิทธิ์แก้ข้อมูลสาขา)
export function defaultDraft(prev, branch, stockItems) {
  const stock = {};
  stockItems.forEach(it => { stock[it.id] = prev && prev.stock_snapshot ? (prev.stock_snapshot[it.id] ?? it.min_qty) : it.min_qty; });
  return {
    yen: '', yenAdd: 0, pan: '', panAdd: 0, cupOwn: 0, topping: 0, other: 0,
    ice: 0, water: 0, etc: 0, cash: '', transfer: 0, grab: 0, thaichaithai: 0,
    float: prev && prev.float_cash != null ? prev.float_cash : branch.float_cash,
    stock,
  };
}

export function draftFromRecord(rec, stockItems) {
  const stock = {};
  stockItems.forEach(it => { stock[it.id] = rec?.stock_snapshot?.[it.id] ?? 0; });
  return {
    yen: N(rec.yen), yenAdd: N(rec.yen_add), pan: N(rec.pan), panAdd: N(rec.pan_add),
    cupOwn: N(rec.cup_own), topping: N(rec.topping), other: N(rec.other),
    ice: N(rec.ice), water: N(rec.water), etc: N(rec.etc), cash: N(rec.cash),
    transfer: N(rec.transfer), grab: N(rec.grab), thaichaithai: N(rec.thaichaithai),
    float: N(rec.float_cash), stock,
  };
}

// ช่องกรอกตัวเลขหนึ่งช่อง — attr = ชื่อ data-attribute ที่หน้าจอนั้นใช้ผูกอีเวนต์ (staff='f', relief='rf')
const numField = (d, err, attr) => (key, label, opts = {}) => `
    <div class="field">
      <label>${label}${opts.hint ? `<span class="hint">${opts.hint}</span>` : ''}</label>
      <input inputmode="${opts.decimal ? 'decimal' : 'numeric'}" data-${attr}="${key}"
        value="${d[key] ?? ''}" class="${err[key] ? 'err' : ''}" placeholder="0" />
    </div>
    ${err[key] ? `<div class="errmsg">${esc(err[key])}</div>` : ''}`;

// ฟอร์มปิดยอด — ฝั่งหัวหน้าไม่มีส่วนนับสต๊อกวัตถุดิบ (ตามที่ออกแบบไว้ในต้นแบบ) ส่งมาเป็น stockItems=null
export function closeFormHTML({ draft, errors, prev, cfg, attr, stockItems, intro }) {
  const d = draft, err = errors || {};
  const field = numField(d, err, attr);
  const stockCard = !stockItems ? '' : (() => {
    const rows = stockItems.map((it, i) => {
      const auto = i === 0 ? 'yen' : i === 1 ? 'pan' : null;
      if (auto) {
        const rows2 = Math.floor(N(d[auto]) / cfg.cupsPerRow[auto]);
        return `<div class="stockrow"><div><div class="nm">${esc(it.name)}</div>
          <div class="un">${esc(it.unit)} · คิดจากยอดนับแก้วด้านบนให้แล้ว</div></div>
          <input value="${d[auto] === '' ? '–' : rows2}" disabled></div>`;
      }
      const cur = d.stock[it.id];
      const was = prev && prev.stock_snapshot ? prev.stock_snapshot[it.id] : null;
      const changed = was != null && Number(cur) !== Number(was);
      return `<div class="stockrow"><div><div class="nm">${esc(it.name)}</div>
        <div class="un">${esc(it.unit)}${was != null ? ` · เมื่อวาน ${was}` : ''}</div></div>
        <input data-stock="${it.id}" inputmode="decimal" value="${cur}" class="${changed ? 'changed' : ''} ${err[`stock_${it.id}`] ? 'err' : ''}">
        ${err[`stock_${it.id}`] ? `<div class="errmsg">${esc(err[`stock_${it.id}`])}</div>` : ''}</div>`;
    }).join('');
    return `<div class="card pad">
        <div class="section-t" style="margin-top:0"><h3>สต๊อกวัตถุดิบ</h3><span class="line"></span>
          <span class="sub">${stockItems.length} รายการ</span></div>
        <p class="sub" style="margin:0 0 6px">ขึ้นยอดเมื่อวานไว้ให้แล้ว แก้เฉพาะตัวที่เปลี่ยน</p>
        ${rows}
      </div>`;
  })();

  return `
      <div class="card pad">
        <div class="section-t" style="margin-top:0"><h3>${stockItems ? 'นับแก้วคงเหลือ' : 'ปิดยอดแทนสาขา'}</h3><span class="line"></span></div>
        ${intro ? `<p class="sub" style="margin:0 0 10px">${esc(intro)}</p>` : ''}
        ${field('yen', 'แก้วเย็นคงเหลือ (ใบ)', { hint: prev ? `เมื่อวาน ${prev.yen}` : '' })}
        ${field('yenAdd', 'แก้วเย็นที่เติมวันนี้ (ใบ)', { hint: `1 แถว = ${cfg.cupsPerRow.yen} ใบ` })}
        ${field('pan', 'แก้วปั่นคงเหลือ (ใบ)', { hint: prev ? `เมื่อวาน ${prev.pan}` : '' })}
        ${field('panAdd', 'แก้วปั่นที่เติมวันนี้ (ใบ)', { hint: `1 แถว = ${cfg.cupsPerRow.pan} ใบ` })}
      </div>
      <div class="card pad">
        <div class="section-t" style="margin-top:0"><h3>รายได้เพิ่ม</h3><span class="line"></span></div>
        ${field('cupOwn', 'แก้วมาเอง', { decimal: true })}
        ${field('topping', 'เพิ่มไข่มุก / ไซรัป', { decimal: true })}
        ${field('other', 'เงินได้อื่น', { decimal: true })}
      </div>
      <div class="card pad">
        <div class="section-t" style="margin-top:0"><h3>รายจ่ายหน้าร้าน</h3><span class="line"></span></div>
        ${field('ice', 'ค่าน้ำแข็ง', { decimal: true })}
        ${field('water', 'ค่าน้ำเปล่า', { decimal: true })}
        ${field('etc', 'ค่าใช้จ่ายอื่นๆ', { decimal: true })}
      </div>
      <div class="card pad">
        <div class="section-t" style="margin-top:0"><h3>เงินที่นับได้</h3><span class="line"></span></div>
        ${field('float', 'เงินทอนตั้งต้น', { decimal: true, hint: 'ค่าที่กรอกไว้ครั้งล่าสุด แก้ได้ถ้าวันนี้ไม่เท่า' })}
        ${field('cash', 'เงินสดทั้งหมด', { decimal: true })}
        ${field('transfer', 'เงินโอน / พร้อมเพย์', { decimal: true })}
        ${field('grab', 'GRAB', { decimal: true })}
        ${field('thaichaithai', 'ไทยช่วยไทย', { decimal: true })}
      </div>
      ${stockCard}`;
}

// ตรวจค่าก่อนส่ง — กันเฉพาะค่าที่เป็นไปไม่ได้จริง ๆ ตามที่ตกลงกันไว้ (ไม่ตรวจว่าเงินขาด/เกิน ตรงนั้นเจ้าของดูเอง)
export function validateClose(d, clock) {
  const e = {};
  if (d.yen === '' || d.yen == null) e.yen = 'ยังไม่ได้กรอกแก้วเย็นคงเหลือ';
  if (d.pan === '' || d.pan == null) e.pan = 'ยังไม่ได้กรอกแก้วปั่นคงเหลือ';
  if (d.cash === '' || d.cash == null) e.cash = 'ยังไม่ได้กรอกเงินสดทั้งหมด';
  [['yen', 'yenAdd', clock.open_yen, 'แก้วเย็น'], ['pan', 'panAdd', clock.open_pan, 'แก้วปั่น']].forEach(([k, add, base, nm]) => {
    if (d[k] !== '' && d[k] != null && base != null && N(d[k]) > base + N(d[add])) {
      e[k] = `${nm}เหลือมากกว่าที่มี — นับไว้ตอนเริ่มขาย ${base} + เติม ${N(d[add])} = ${base + N(d[add])} ใบ`;
    }
  });
  const nonNegative = [
    ['yen', 'แก้วเย็น'], ['yenAdd', 'แก้วเย็นที่เติม'], ['pan', 'แก้วปั่น'], ['panAdd', 'แก้วปั่นที่เติม'],
    ['cupOwn', 'รายได้แก้วมาเอง'], ['topping', 'รายได้ไข่มุก/ไซรัป'], ['other', 'รายได้อื่น'],
    ['ice', 'ค่าน้ำแข็ง'], ['water', 'ค่าน้ำ'], ['etc', 'ค่าใช้จ่ายอื่น'], ['float', 'เงินทอน'],
    ['cash', 'เงินสด'], ['transfer', 'เงินโอน'], ['grab', 'Grab'], ['thaichaithai', 'ไทยช่วยไทย'],
  ];
  nonNegative.forEach(([key, label]) => { if (N(d[key]) < 0) e[key] = `${label}ติดลบไม่ได้`; });
  ['yen', 'yenAdd', 'pan', 'panAdd'].forEach(key => {
    if (d[key] !== '' && d[key] != null && !Number.isInteger(N(d[key]))) e[key] = 'จำนวนแก้วต้องเป็นจำนวนเต็ม';
  });
  Object.entries(d.stock || {}).forEach(([id, value]) => {
    if (N(value) < 0) e[`stock_${id}`] = 'จำนวนสต๊อกติดลบไม่ได้';
  });
  return e;
}

function stockSnapshot(d, cfg, stockItems, previous) {
  const snap = { ...(previous || {}) };
  stockItems.forEach((it, i) => {
    if (i === 0) snap[it.id] = Math.floor(N(d.yen) / cfg.cupsPerRow.yen);
    else if (i === 1) snap[it.id] = Math.floor(N(d.pan) / cfg.cupsPerRow.pan);
    else if (d.stock && d.stock[it.id] !== undefined) snap[it.id] = N(d.stock[it.id]);
  });
  return snap;
}

function recordValues(d, cfg, stockItems, previous, openYen, openPan, staffName) {
  const values = {
    open_yen: N(openYen), open_pan: N(openPan),
    yen: N(d.yen), yen_add: N(d.yenAdd), pan: N(d.pan), pan_add: N(d.panAdd),
    cup_own: N(d.cupOwn), topping: N(d.topping), other: N(d.other), ice: N(d.ice), water: N(d.water), etc: N(d.etc),
    cash: N(d.cash), transfer: N(d.transfer), grab: N(d.grab), thaichaithai: N(d.thaichaithai),
    float_cash: N(d.float), stock_snapshot: stockSnapshot(d, cfg, stockItems, previous),
    cup_price_yen: N(cfg.cupPrice.yen), cup_price_pan: N(cfg.cupPrice.pan),
    grab_commission_pct: N(cfg.grabCommissionPct),
  };
  if (staffName) values.staff_name = staffName;
  return values;
}

// บันทึกยอดปิดร้านลงตาราง daily_records — "แถวแก้ว" ในสต๊อก (2 รายการแรก) คิดจากยอดที่นับวันนี้เสมอ
// ทั้งฝั่งพนักงานและฝั่งหัวหน้า (ต้นแบบทำแบบนี้ใน closeDay) รายการที่เหลือฝั่งหัวหน้าใช้ของเมื่อวานเพราะไม่ได้นับ
export async function submitClose({ branchId, dateISO, staffName, draft: d, cfg, stockItems, prevSnapshot, createdBy, openYen, openPan }) {
  const values = recordValues(d, cfg, stockItems, prevSnapshot, openYen, openPan);
  return supabase.from('daily_records').insert({
    branch_id: branchId, record_date: dateISO, staff_name: staffName,
    ...values, sent: true, closed: true, created_by: createdBy,
  });
}

export function updateClose({ recordId, draft: d, cfg, stockItems, prevSnapshot, openYen, openPan, reason, staffName }) {
  return supabase.rpc('update_daily_record', {
    p_record_id: recordId,
    p_values: recordValues(d, cfg, stockItems, prevSnapshot, openYen, openPan, staffName),
    p_reason: reason || 'แก้ยอดภายในวันเดียวกัน',
  });
}
