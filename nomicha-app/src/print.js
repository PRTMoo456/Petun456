// เอกสารพิมพ์ได้ — สลิปเงินเดือน / ใบส่งของ / บิลขายนอกสาขา / สรุปทั้งเดือน
// พอร์ตตรงจาก slipShell()/slipHTML()/reliefSlipHTML()/deliveryReportHTML()/externalBillHTML()/externalMonthHTML()/deliveryMonthHTML()
// และ printDoc()/showDocOverlay()/closeDocOverlay() ในต้นแบบ nomicha.html (คอมเมนต์ในต้นแบบ 4 ก.ย. 69: เดิมรันในกรอบ iframe
// ของแอป สั่ง window.print() แล้วพิมพ์ผิดหน้าหรือโดนบล็อก — วิธีนี้เปิดเป็นหน้าเว็บใหม่แล้วสั่งพิมพ์จากตรงนั้น ได้ A4 เต็มใบจริง
// ถ้าเบราว์เซอร์บล็อกป๊อปอัป ค่อย fallback ไปโชว์เต็มจอในแอปแทน (ต้อง <div id="printSlips" class="print-slips"></div> ใน index.html)
import { supabase } from './supabaseClient.js';
import { $, baht, esc, fmtDate, toast } from './util.js';

/* ============================== ข้อมูลบริษัท (จากตาราง companies) ============================== */
// เลขผู้เสียภาษี/ที่อยู่เป็นข้อมูลจริงที่เจ้าของต้องกรอกเองในหน้าตั้งค่า — ถ้ายังไม่กรอกจะโชว์ "(ยังไม่กรอก)"
// ชัดๆ แทนการปล่อยว่างเงียบๆ (กันเผลอเอาไปยื่นจริงทั้งที่เลขยังไม่ครบ)
export async function getCompanies() {
  const { data } = await supabase.from('companies').select('*');
  const byId = {};
  (data || []).forEach(c => { byId[c.id] = c; });
  return byId;
}
const taxLine = c => `เลขผู้เสียภาษี ${c?.tax_id ? esc(c.tax_id) : '(ยังไม่กรอก)'}`;
const addrLine = c => c?.address ? esc(c.address) : '(ยังไม่กรอกที่อยู่)';

/* ============================== พิมพ์เอกสาร (โครง A4 ร่วมกันทุกเอกสาร) ============================== */
const DOC_CSS = `*{box-sizing:border-box}
body{margin:0;background:#fff;color:#111;
  font-family:"IBM Plex Mono",ui-monospace,"Courier New",monospace}
.slip{padding:26px 30px}
.slip+.slip{page-break-before:always}
.slip-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:16px}
.slip-head h2{font-size:18px;margin:0 0 2px}
.sub{color:#444}
.slip-title{text-align:right}
.slip-title .big{font-size:20px;font-weight:700}
.slip-row{display:flex;justify-content:space-between;gap:16px;padding:6px 0;border-bottom:1px solid #ddd;font-size:13.5px}
.slip-row.neg span:last-child{color:#b3261e}
.slip-row.total{border-bottom:none;border-top:2px solid #111;margin-top:6px;padding-top:10px;font-size:15px;font-weight:700}
.slip-foot{margin-top:18px;font-size:11.5px;color:#555}
@page{size:A4;margin:14mm}
@media print{body{-webkit-print-color-adjust:exact}}`;

export function printDoc(html, emptyMsg) {
  if (!html) { toast(emptyMsg || 'ไม่มีข้อมูลให้ปริ้น'); return; }
  const doc = '<!doctype html><html lang="th"><head><meta charset="utf-8">'
    + '<title>เอกสาร โนมิชา</title><style>' + DOC_CSS + '</style></head><body>' + html
    + '<' + 'script>window.onload=function(){setTimeout(function(){window.print();},300);};<' + '/script></body></html>';
  let w = null;
  try { w = window.open('', '_blank'); } catch (e) { w = null; }
  if (w && w.document) {
    try {
      w.document.open(); w.document.write(doc); w.document.close(); w.focus();
      toast('เปิดหน้าต่างปริ้นแล้ว — เลือกเครื่องพิมพ์ หรือ "บันทึกเป็น PDF" ก็ได้');
      return;
    } catch (e) { try { w.close(); } catch (e2) { /* ignore */ } }
  }
  showDocOverlay(html);
}
function showDocOverlay(html) {
  const box = $('#printSlips'); if (!box) return;
  box.innerHTML = `<div class="docbar">
      <span class="sub">ตัวอย่างเอกสาร (A4)</span>
      <button class="mini" id="docCloseBtn" style="margin-left:0">ปิด</button>
    </div>
    <div class="docnote"><b>เปิดหน้าต่างสำหรับปริ้นไม่ได้</b> — เบราว์เซอร์บล็อกการเปิดหน้าต่างใหม่ของหน้านี้อยู่
      กด <b>อนุญาตป๊อปอัป</b> (ไอคอนท้ายช่องที่อยู่เว็บ) แล้วกดปริ้นอีกครั้ง จะได้เอกสาร A4 พร้อมพิมพ์หรือบันทึกเป็น PDF ·
      ระหว่างนี้ตรวจความถูกต้องจากตัวอย่างข้างล่างนี้ได้เลย</div>
    ${html}`;
  box.classList.add('on');
  const cb = $('#docCloseBtn'); if (cb) cb.addEventListener('click', closeDocOverlay);
}
function closeDocOverlay() { const box = $('#printSlips'); if (box) { box.classList.remove('on'); box.innerHTML = ''; } }

/* ============================== สลิปเงินเดือน ==============================
   rows = [ชื่อรายการ, จำนวนเงิน, เป็นรายการหักหรือเปล่า] — ใช้โครงเดียวกันทั้งพนักงานสาขาและหัวหน้า */
function slipShell(co, sub, who, rows, total, monthLabelStr) {
  return `<div class="slip">
    <div class="slip-head">
      <div><h2>${esc(co?.name || 'บริษัท เพตั้น จำกัด')} (โนมิชา)</h2>
        <div class="sub">${taxLine(co)}</div>
        <div class="sub">${addrLine(co)}</div>
        <div class="sub">${sub}</div></div>
      <div class="slip-title"><div class="big">สลิปเงินเดือน</div><div class="sub">งวด ${esc(monthLabelStr)}</div></div>
    </div>
    ${who}
    ${rows.filter(Boolean).map(([l, v, neg], i) =>
      `<div class="slip-row${neg ? ' neg' : ''}"${i === 0 ? ' style="margin-top:10px"' : ''}><span>${l}</span><span>${neg ? '−' : ''}${baht(v)} บาท</span></div>`).join('')}
    <div class="slip-row total"><span>ยอดจ่ายสุทธิ</span><span>${baht(total)} บาท</span></div>
    <div class="slip-foot">ยอดประมาณการจากระบบ · จ่ายจริงทุกวันที่ 5 ของเดือนถัดไป</div>
  </div>`;
}
/* ชื่อ-นามสกุล-เลขบัตรประชาชน บนสลิป — เจ้าของสั่งไว้ 5 ก.ย. 69 ว่าต้องมีเพราะใช้เป็นหลักฐานจ่ายเงินเดือน
   ถ้ายังไม่ได้กรอกในหน้าจัดการสาขา จะขึ้น "(ยังไม่กรอก)" ชัด ๆ แทนการปล่อยว่างเงียบ ๆ */
const idRows = p => `<div class="slip-row"><span>ชื่อ-นามสกุล</span><span>${
    [p.first_name, p.last_name].filter(Boolean).join(' ') || '(ยังไม่กรอก)'}</span></div>
    <div class="slip-row"><span>เลขบัตรประชาชน</span><span>${p.national_id ? esc(p.national_id) : '(ยังไม่กรอก)'}</span></div>`;

// branch = {name, staff_name, first_name, last_name, national_id, base_salary, holiday_work_days}
// companies = ผลจาก getCompanies() — พนักงานสาขาเป็นลูกจ้าง "คาเชน" (branch_co) หัวกระดาษจึงเป็นคาเชน
export function staffSlipHTML(branch, pr, monthLabelStr, companies) {
  return slipShell(companies?.branch_co, `สาขา${esc(branch.name)}`,
    `<div class="slip-row"><span>พนักงาน</span><span>${esc(branch.staff_name || '(ยังไม่ผูกบัญชี)')}</span></div>
    ${idRows(branch)}
    <div class="slip-row"><span>สาขา</span><span>${esc(branch.name)}</span></div>`,
    [['เงินเดือนฐาน', branch.base_salary],
     [`เบี้ยขยัน${pr.reset ? ' (โดนรีเซ็ตเดือนนี้)' : ''}`, pr.diligence],
     pr.holidayPay && [`ค่าทำงานวันหยุด (${branch.holiday_work_days || 0} วัน)`, pr.holidayPay],
     [`ค่าแก้ว (${pr.cups} ใบ)`, pr.cupPay],
     pr.deduct && ['หัก สาย/ปิดไว/ไม่ลงเวลา/หยุดเกินโควตา', pr.deduct, true],
     pr.advanceDeduct && ['หักเบิกล่วงหน้า/เงินกู้ค้างอยู่', pr.advanceDeduct, true]],
    pr.total, monthLabelStr);
}
// relief = {name, role, first_name, last_name, national_id, base_salary, delivery_pay} — pr จาก calc.payrollForRelief()
// หัวหน้าเป็นลูกจ้าง "เพตั้น" (warehouse) หัวกระดาษจึงเป็นเพตั้น
export function reliefSlipHTML(relief, pr, monthLabelStr, companies) {
  return slipShell(companies?.warehouse, 'คลังกลาง',
    `<div class="slip-row"><span>พนักงาน</span><span>${esc(relief.name)}</span></div>
    ${idRows(relief)}
    <div class="slip-row"><span>ตำแหน่ง</span><span>${esc(relief.role || 'หัวหน้า')}</span></div>`,
    [['เงินเดือนฐาน', relief.base_salary],
     ['เงินส่งของ', relief.delivery_pay],
     ['ค่าเช่าคลังกลาง', pr.whRent],
     [`ค่าแก้ว (${pr.cups} ใบ)`, pr.cupPay],
     pr.deduct && [`หัก ลืมลงเวลา${pr.noClock ? ` ${pr.noClock} ครั้ง` : ''} (ไม่หักมาสาย/ปิดไว)`, pr.deduct, true],
     pr.advanceDeduct && ['หักเบิกล่วงหน้า/เงินกู้ค้างอยู่', pr.advanceDeduct, true]],
    pr.total, monthLabelStr);
}

const slipHead = (companies, title, sub, rightSub) => `<div class="slip-head">
      <div><h2>${esc(companies.warehouse?.name || 'บริษัท เพตั้น จำกัด')}</h2>
        <div class="sub">${taxLine(companies.warehouse)}</div>
        <div class="sub">${addrLine(companies.warehouse)}</div>
        <div class="sub">${sub}</div></div>
      <div class="slip-title"><div class="big">${title}</div><div class="sub">${rightSub || ''}</div></div>
    </div>`;

/* ============================== ใบส่งของ ==============================
   dlv = แถวจากตาราง deliveries (items/received เป็น jsonb {item_id:qty}) · stockItems = STOCK_ITEMS ที่หน้านั้นโหลดไว้แล้ว (เรียงตาม display_order) */
export function deliveryReportHTML({ dlv, branch, roundName, staffName, reliefName, reliefRole, stockItems, companies, overuse = 0.5 }) {
  const entries = Object.entries(dlv.items || {});
  const totalQty = entries.reduce((s, [, qty]) => s + qty, 0);
  const totalCost = entries.reduce((s, [id, qty]) => { const it = stockItems.find(x => String(x.id) === String(id)); return s + (it ? qty * it.branch_price : 0); }, 0);
  const items = stockItems.filter(it => dlv.items && dlv.items[it.id] != null).map(it => {
    const qty = dlv.items[it.id];
    const rq = dlv.received ? dlv.received[it.id] : null;
    const diff = rq != null ? qty - rq : null;
    return `<div class="slip-row"><span>${esc(it.name)}</span>
      <span>${qty} ${esc(it.unit)}${rq != null ? ` · รับจริง ${rq}${Math.abs(diff) > overuse ? ' ⚠' : ''}` : ''}</span></div>`;
  }).join('');
  return `<div class="slip">
    <div class="slip-head">
      <div><h2>${esc(companies.warehouse?.name || 'บริษัท เพตั้น จำกัด')}</h2><div class="sub">${taxLine(companies.warehouse)} · ${addrLine(companies.warehouse)}</div></div>
      <div class="slip-title"><div class="big">ใบส่งของ</div><div class="sub">${fmtDate(dlv.delivery_date)} · ${esc(roundName)}</div></div>
    </div>
    <div class="slip-row"><span>ผู้ขาย/ผู้ส่ง</span><span>${esc(companies.warehouse?.name || '')}</span></div>
    <div class="slip-row"><span>ผู้ซื้อ/ผู้รับ</span><span>${esc(companies.branch_co?.name || '')} — สาขา${esc(branch.name)}</span></div>
    <div class="slip-row"><span>เลขผู้เสียภาษีผู้ซื้อ</span><span>${companies.branch_co?.tax_id ? esc(companies.branch_co.tax_id) : '(ยังไม่กรอก)'}</span></div>
    <div class="slip-row"><span>พนักงานประจำสาขา</span><span>${esc(staffName || '(ยังไม่ผูกบัญชี)')}</span></div>
    <div class="slip-row"><span>ผู้ส่งของ (ผู้ปฏิบัติงาน)</span><span>${esc(reliefName || '—')}${reliefRole ? ` (${esc(reliefRole)})` : ''}</span></div>
    <div class="slip-row"><span>สถานะการเช็ครับของ</span><span>${dlv.received ? 'พนักงานเช็ครับแล้ว' : 'ยังไม่เช็ครับ'}</span></div>
    <div style="margin:14px 0 4px;font-weight:700;font-size:13px">รายการวัตถุดิบ ${entries.length} รายการ</div>
    ${items || '<p class="sub">ไม่มีรายการ</p>'}
    <div class="slip-row total"><span>รวม ${totalQty} ชิ้น · มูลค่าตามราคาส่งสาขา</span><span>${baht(totalCost)} บาท</span></div>
    <div style="margin-top:26px;display:flex;gap:24px">
      <div style="flex:1;border-top:1px dashed #999;padding-top:6px;text-align:center;font-size:12px">ผู้ส่งของ (${esc(companies.warehouse?.name || '')})</div>
      <div style="flex:1;border-top:1px dashed #999;padding-top:6px;text-align:center;font-size:12px">ผู้รับของ (${esc(companies.branch_co?.name || '')})</div>
    </div>
    <div class="slip-foot">ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม (VAT) — เอกสารนี้เป็นใบส่งของ/ใบกำกับสินค้าระหว่าง 2 บริษัท ไม่มีการคำนวณ VAT
      · ออกจากประวัติการส่งของในระบบ ("รับจริง" มาจากที่พนักงานเช็ค "วัตถุดิบนำเข้า" · ⚠ = ต่างจากที่ส่งเกิน ${overuse} หน่วย)
      · เลขผู้เสียภาษี/ที่อยู่มาจากหน้าตั้งค่า — เจ้าของโปรดตรวจสอบว่าตรงกับหนังสือรับรองบริษัทจริงก่อนใช้พิมพ์ยื่นจริง</div>
  </div>`;
}

/* ============================== บิลขายนอกสาขา / สรุปทั้งเดือน ==============================
   sale = แถวจากตาราง external_sales · items = [{item_id, qty, price}] · stockItems ใช้หา name/unit */
export function externalBillHTML({ sale, issuerName, stockItems, companies, viewerRole }) {
  const lines = (sale.items || []).map(li => {
    const it = stockItems.find(x => String(x.id) === String(li.item_id)); if (!it) return '';
    return `<div class="slip-row"><span>${esc(it.name)} <span class="sub">${li.qty} ${esc(it.unit)} × ${Number(li.price).toFixed(2)}</span></span>
      <span>${baht(li.qty * li.price)}</span></div>`;
  }).join('');
  const qty = (sale.items || []).reduce((s, li) => s + li.qty, 0);
  return `<div class="slip">
    ${slipHead(companies, 'บิลขายวัตถุดิบ', 'ขายวัตถุดิบนอกสาขา — คลังกลาง', `${fmtDate(sale.sale_date)} · เลขที่ ${esc(String(sale.id).slice(0, 8))}`)}
    <div class="slip-row"><span>ผู้ซื้อ</span><span>${esc(sale.buyer)}</span></div>
    <div class="slip-row"><span>ผู้ออกบิล</span><span>${esc(issuerName || '—')}</span></div>
    ${viewerRole === 'owner' ? `<div class="slip-row"><span>สถานะการชำระเงิน</span><span>${sale.paid ? 'โอนแล้ว' : 'รอลูกค้าโอน'}</span></div>` : ''}
    <div style="margin:14px 0 4px;font-weight:700;font-size:13px">รายการ ${(sale.items || []).length} รายการ</div>
    ${lines || '<p class="sub">บิลนี้ถูกยกเลิก (ไม่เหลือรายการ)</p>'}
    <div class="slip-row total"><span>รวม ${qty} หน่วย</span><span>${baht(sale.total)} บาท</span></div>
    <div style="margin-top:26px;display:flex;gap:24px">
      <div style="flex:1;border-top:1px dashed #999;padding-top:6px;text-align:center;font-size:12px">ผู้ส่งของ</div>
      <div style="flex:1;border-top:1px dashed #999;padding-top:6px;text-align:center;font-size:12px">ผู้รับของ</div>
    </div>
    <div class="slip-foot">ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม (VAT) ไม่มีการคำนวณ VAT ในบิลนี้ · ชำระโดยโอนเข้าบัญชีบริษัทเท่านั้น ไม่รับเงินสด · ราคาต่อหน่วยเป็นราคาส่งสาขา
      · เลขผู้เสียภาษี/ที่อยู่มาจากหน้าตั้งค่า — เจ้าของโปรดตรวจสอบก่อนใช้พิมพ์ยื่นจริง</div>
  </div>`;
}
export function externalMonthHTML({ list, monthLabelStr, companies, viewerRole }) {
  if (!list.length) return '';
  const total = list.reduce((s, x) => s + x.total, 0);
  const rows = list.map(x => `<div class="slip-row"><span>${fmtDate(x.sale_date)} · ${esc(x.buyer)}
      <span class="sub">${(x.items || []).length} รายการ${viewerRole === 'owner' ? ` · ${x.paid ? 'โอนแล้ว' : 'รอลูกค้าโอน'}` : ''}</span></span>
    <span>${baht(x.total)}</span></div>`).join('');
  return `<div class="slip">
    ${slipHead(companies, 'สรุปขายนอกสาขา', 'ขายวัตถุดิบนอกสาขา — คลังกลาง', esc(monthLabelStr))}
    <div style="margin:4px 0;font-weight:700;font-size:13px">${list.length} บิล</div>
    ${rows}
    <div class="slip-row total"><span>รวมทั้งเดือน</span><span>${baht(total)} บาท</span></div>
    <div class="slip-foot">ออกจากประวัติบิลขายนอกสาขาในระบบ · เงินลูกค้าโอนเข้าบัญชีบริษัทโดยตรง ไม่ผ่านเงินสดหน้าร้าน</div>
  </div>`;
}

/* ============================== สรุปการส่งของทั้งเดือน (ทุกสาขา) ==============================
   list = แถวจาก deliveries ในเดือนนั้น (เรียงวันที่แล้ว) · branches = BRANCHES · stockItems = STOCK_ITEMS */
export function deliveryMonthHTML({ list, branches, stockItems, monthLabelStr, companies }) {
  if (!list.length) return '';
  const valOf = dlv => Object.entries(dlv.items || {}).reduce((s, [id, qty]) => {
    const it = stockItems.find(x => String(x.id) === String(id)); if (!it) return s;
    const actual = (dlv.received && dlv.received[id] != null) ? dlv.received[id] : qty;
    return s + actual * it.branch_price;
  }, 0);
  const total = list.reduce((s, x) => s + valOf(x), 0);
  const rows = list.map(dlv => {
    const b = branches.find(x => x.id === dlv.branch_id);
    const rn = dlv.round_name || dlv.round_id;
    const qty = Object.values(dlv.items || {}).reduce((s, q) => s + q, 0);
    return `<div class="slip-row"><span>${fmtDate(dlv.delivery_date)} · สาขา${esc(b ? b.name : '—')}
      <span class="sub">${esc(rn)} · ${Object.keys(dlv.items || {}).length} รายการ · ${qty} ชิ้น${dlv.received ? ' · เช็ครับแล้ว' : ''}</span></span>
      <span>${baht(valOf(dlv))}</span></div>`;
  }).join('');
  const perBranch = branches.map(b => {
    const v = list.filter(x => x.branch_id === b.id).reduce((s, x) => s + valOf(x), 0);
    return v ? `<div class="slip-row"><span>สาขา${esc(b.name)}</span><span>${baht(v)}</span></div>` : '';
  }).join('');
  return `<div class="slip">
    ${slipHead(companies, 'สรุปการส่งของ', 'วัตถุดิบที่คลังกลางส่งให้สาขา', esc(monthLabelStr))}
    <div style="margin:4px 0;font-weight:700;font-size:13px">รายรอบ (${list.length} รอบ)</div>
    ${rows}
    <div style="margin:16px 0 4px;font-weight:700;font-size:13px">รวมรายสาขา</div>
    ${perBranch}
    <div class="slip-row total"><span>รวมทั้งเดือน</span><span>${baht(total)} บาท</span></div>
    <div class="slip-foot">มูลค่าคิดตามราคาส่งสาขา · ใช้ยอด "รับจริง" ถ้าสาขาเช็ควัตถุดิบนำเข้าแล้ว</div>
  </div>`;
}
