// แสดงยอดส่งเงินแยกรายวัน — ใช้ร่วมกันทั้งหน้าพนักงาน หัวหน้า และเจ้าของ (เจ้าของสั่ง 9 ต.ค. 69)
import { baht, esc, fmtDate } from './util.js';

const dm = d => d.slice(8, 10) + '/' + d.slice(5, 7);

// รายการวันละบรรทัด: "06/10  1,990"
export function dayLinesHTML(days) {
  if (!days || !days.length) return '<span class="sub">—</span>';
  return days.map(d => `<div class="between" style="gap:12px"><span class="sub">${dm(d.date)}</span><span class="n">${baht(d.amount)}</span></div>`).join('');
}

// ข้อความสั้นบรรทัดเดียว: "06/10 1,990 · 07/10 848"
export function dayInlineText(days) {
  return (days || []).map(d => `${dm(d.date)} ${baht(d.amount)}`).join(' · ');
}

// ช่วงวันที่ครอบคลุม: "06/10–08/10 (3 วัน)"
export function dayRangeText(days) {
  if (!days || !days.length) return '—';
  const a = dm(days[0].date), b = dm(days[days.length - 1].date);
  return (a === b ? a : `${a}–${b}`) + ` (${days.length} วัน)`;
}

// สถานะของแต่ละครั้งที่ส่ง
export function remitStatusHTML(r) {
  if (r.method === 'transfer') return '<span class="pill ok">โอนเข้าบัญชี</span>';
  if (!r.received_at) return '<span class="pill warn">รอหัวหน้ารับ</span>';
  const got = Number(r.received_amount ?? r.amount), diff = got - Number(r.amount);
  return `<span class="pill ${diff ? 'bad' : 'ok'}">รับแล้ว ${baht(got)}${diff ? ` · ${diff < 0 ? 'ขาด' : 'เกิน'} ${baht(Math.abs(diff))}` : ''}</span>`;
}

export { fmtDate, esc };
