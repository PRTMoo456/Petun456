// ปฏิทินจองวันหยุด — ใช้ร่วมกันทั้งพนักงานสาขา (day_offs) และหัวหน้า (relief_day_offs)
// พอร์ตตรงจาก quotaReport()/dayChip()/OFF_LEGEND/quotaHTML ในต้นแบบ nomicha.html
import { dt, esc, isoDate, THMONTHS, monthKey, monthLabel } from './util.js';

// สรุปโควตาวันหยุดแยกเป็นรายเดือน ตามเดือนที่ปรากฏในช่วงวันที่กำลังแสดง (windowDates)
export function quotaReport(offDates, windowDates, quota) {
  const months = [];
  windowDates.forEach(d => { const mk = monthKey(d); if (!months.some(m => m.mk === mk)) months.push({ mk, sample: d }); });
  return months.map(({ mk, sample }) => {
    const inMonth = offDates.filter(d => monthKey(d) === mk).sort();
    return { label: monthLabel(sample), used: inMonth.length, dates: inMonth, remain: Math.max(0, quota - inMonth.length) };
  });
}

export function dayChip(d, attr, cls, disabled, title, tag, newMonth) {
  const dd = dt(d);
  return `<button class="daychip ${cls}" data-${attr}="${d}" ${disabled ? 'disabled' : ''} title="${esc(title)}">
      ${newMonth ? `<span class="dm">${THMONTHS[dd.getMonth()]}</span>` : ''}
      <span class="dd">${dd.getDate()}</span>
      <span class="dw">${['อา','จ','อ','พ','พฤ','ศ','ส'][dd.getDay()]}</span>
      ${tag}
    </button>`;
}

export const OFF_LEGEND = `<div class="legend">
        <span><i class="dot free"></i> ว่าง เลือกได้</span>
        <span><i class="dot mine"></i> วันที่จองแล้ว</span>
        <span><i class="dot busy"></i> จองไม่ได้</span>
      </div>`;

export const quotaHTML = (report, quota) => `<div class="quotarep">${report.map(r => `
        <div class="qrow">
          <span class="qmonth">${r.label}</span>
          <span class="qcount">จองแล้ว ${r.used}/${quota}${r.dates.length ? ' — ' + r.dates.map(d => {
            const dd = dt(d); return String(dd.getDate()).padStart(2,'0') + '/' + String(dd.getMonth()+1).padStart(2,'0');
          }).join(' · ') : ''}</span>
          <span class="qremain ${r.remain === 0 ? 'zero' : ''}">เหลืออีก ${r.remain} วัน</span>
        </div>`).join('')}</div>`;

// รายการวันที่ 31 วันข้างหน้า (พรุ่งนี้เป็นต้นไป) — ใช้ตั้งต้นช่วงจองวันหยุด/ตารางงาน
// ใช้ isoDate() (วันที่ตามเวลาเครื่อง) ห้ามใช้ toISOString() เด็ดขาด — ที่ไทย (UTC+7) toISOString() จะได้วันที่
// เลื่อนไป 1 วันเพราะแปลงกลับเป็นเวลา UTC ก่อน (เที่ยงคืนไทย = 17:00 ของเมื่อวานตามเวลา UTC) ต้นแบบใช้ isoDate เหมือนกัน
export function futureDates(fromISO, days = 31) {
  const out = []; const d0 = dt(fromISO);
  for (let i = 1; i <= days; i++) { const d = new Date(d0); d.setDate(d0.getDate() + i); out.push(isoDate(d)); }
  return out;
}
