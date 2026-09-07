// ฟังก์ชันช่วยทั่วไป — พอร์ตตรงจากต้นแบบ nomicha.html (เครื่องมือ/สูตรคำนวณ) ให้ผลลัพธ์เหมือนเดิมทุกจุด
export const N = v => (v === '' || v == null || isNaN(v)) ? 0 : +v;

/* อ่านตัวเลขจากช่องกรอกอย่างปลอดภัย — พอร์ตจาก numIn()/numIn0()/numSet() ในต้นแบบ
   ช่องกรอกพวกนี้เป็น text + inputmode=numeric พิมพ์อะไรลงไปก็ได้ ถ้าเก็บค่าดิบไว้ตรง ๆ แล้วค่อยแปลงตอนบันทึก
   พิมพ์ "1,250" จะกลายเป็น 0 เงียบ ๆ (ยอดขาย/เงินสด/เงินเดือนเพี้ยนทั้งสายโดยไม่มีใครรู้)
   ตัวกรองนี้ตัดคอมมา/ช่องว่างออกก่อน ถ้ายังไม่ใช่ตัวเลขจริงถือว่า "ยังไม่ได้กรอก" (ค่าว่าง) แล้วให้ตอนกดส่งเตือนแทน */
export const numIn = v => { const t = String(v).replace(/[,\s]/g, '');
  return /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? +t : ''; };   // "0x10"/"1e9"/เลขไทย ถือว่ายังไม่ได้กรอก
export const numIn0 = v => { const n = numIn(v); return n === '' ? 0 : n; };
// ช่องที่พิมพ์แล้วมีผลกับค่าจริงทันที (ตั้งค่า/ราคา/ระดับสต๊อก) — พิมพ์ผิดให้คงค่าเดิมไว้ ปลอดภัยกว่ากลายเป็น 0
export const numSet = (v, cur) => { const n = numIn(v); return n === '' ? cur : n; };
export const baht = v => Math.round(v).toLocaleString('th-TH');
export const signed = v => (v > 0 ? '+' : '') + baht(v);
const pad2 = n => String(n).padStart(2, '0');
export const isoDate = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

/* ============================== เวลาไทยเป็นหลัก ==============================
   ร้านอยู่ไทยทั้งหมด "วันนี้" และ "ตอนนี้กี่โมง" ต้องคิดตามเวลาไทยเสมอ ไม่ใช่ตามเครื่องของคนใช้
   ถ้ายึดเวลาเครื่อง: มือถือที่ตั้งเขตเวลาผิด (หรือเจ้าของเปิดดูจากต่างประเทศ) จะบันทึกยอดลงผิดวัน
   และเวลาเข้า-ออกงานที่เก็บไว้จะเทียบกับเวลาทำงานของสาขาไม่ได้ */
export const TZ_TH = 'Asia/Bangkok';
const thParts = (d = new Date()) => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_TH, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
  return p;
};
// วันที่วันนี้ตามเวลาไทย (YYYY-MM-DD)
export const todayISO = () => { const p = thParts(); return `${p.year}-${p.month}-${p.day}`; };
// เวลาตอนนี้ตามเวลาไทย (HH:MM) — ใช้ตอนลงเวลาเข้า-ออกงาน
export const nowHM = () => { const p = thParts(); return `${p.hour}:${p.minute}`; };
// "HH:MM" → จำนวนนาทีนับจากเที่ยงคืน (ใช้เทียบกับเวลาทำงานของสาขา)
export const hmToMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };

const THMONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
export { THMONTHS };
export const DAYS = ['อา','จ','อ','พ','พฤ','ศ','ส'];
export const dt = s => new Date(s + 'T00:00:00');
export const fmtDate = s => { const d = dt(s); return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getFullYear() % 100); };
export const monthKey = s => s.slice(0, 7);
export const monthLabel = s => { const d = dt(s); return THMONTHS[d.getMonth()] + ' ' + ((d.getFullYear() + 543) % 100); };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), 2600);
}

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];

// วันที่ทั้งหมดของเดือนปัจจุบัน (ตาม todayISO) ตั้งแต่วันที่ 1 ถึงวันสุดท้ายของเดือน — ใช้เป็น allDatesInMonth ของ calc.payrollFor()
export function monthDates(todayISO) {
  const d = dt(todayISO);
  const y = d.getFullYear(), m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const out = [];
  for (let i = 1; i <= last; i++) out.push(y + '-' + pad2(m + 1) + '-' + pad2(i));
  return out;
}
