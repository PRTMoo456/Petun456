// หน้าพนักงานสาขา — ลงเวลา + นับแก้วก่อนขาย + ปิดยอด + จองวันหยุด + ส่งเงินสด + เช็ควัตถุดิบนำเข้า + เงินเดือน
// พอร์ตตรงจาก staffView()/staffHome()/staffClose()/staffMe() และฟังก์ชันที่เกี่ยวข้องในต้นแบบ nomicha.html (3 แท็บ: หน้าแรก/ปิดยอด/ของฉัน)
//
// ตรวจสอบแล้ว (5 ก.ย. 69): เทียบสูตร calcExpected()/calcDay() กับ calc() ของต้นแบบด้วยข้อมูลจริง — ตรงกันทุกบิต (ดูคอมเมนต์ใน calc.js)
//
// แก้ไข (รอบสอง, 5 ก.ย. 69): ก่อนหน้านี้เข้าใจผิดว่าต้นแบบบังคับ "นับแก้วก่อนขาย" เฉพาะวันเปลี่ยนมือ — พบว่าจริง ๆ บังคับทุกวัน
// (แค่ขึ้นข้อความต่างกัน) ต้นแบบกรอกยอดเมื่อวานไว้ล่วงหน้าให้ กดยืนยันเฉยๆ ได้เลยถ้าตรง — เวอร์ชันนี้ pre-fill ตรงกันแล้ว
//
// พนักงานแก้ยอดที่ส่งแล้วได้ภายในวันเดียวกัน ทุกครั้งเก็บประวัติ ส่วนวันย้อนหลังให้เจ้าของแก้เท่านั้น
import { supabase } from '../supabaseClient.js';
import { loadRefs } from '../refs.js';
import { getSettings } from '../settings.js';
import { $, N, numIn, numIn0, baht, esc, toast, todayISO, nowHM, fmtDate, monthKey, monthLabel, monthDates } from '../util.js';
import { quotaReport, dayChip, OFF_LEGEND, quotaHTML, futureDates } from '../dayoff.js';
import { getCompanies, staffSlipHTML, printDoc } from '../print.js';
import { defaultDraft, draftFromRecord, closeFormHTML, validateClose, submitClose, updateClose } from '../close.js';
import { verifyForClock } from '../geo.js';
import * as calc from '../calc.js';

let ME, BRANCH, TODAY, STOCK_ITEMS = [];
let S = { tab: 'home', draft: null, openDraft: null, errors: {}, editingToday: false,
  receivedOpen: true, receivedDraft: null };
let clockBusy = false;

export async function renderStaffApp(root, me) {
  ME = me;
  TODAY = todayISO();
  const [{ data: branch, error }, refs] = await Promise.all([
    supabase.from('branches').select('id,name,float_cash,days_off_quota,holiday_work_days,gps_lat,gps_lng,gps_radius,work_start,work_end,late_grace_min,company_id,active,cash_tracking_from').eq('id', me.branch_id).single(),
    loadRefs(),
  ]);
  if (error || !branch) { root.innerHTML = `<div class="wrap"><p class="sub">หาสาขาของคุณไม่เจอ — แจ้งเจ้าของ</p></div>`; return; }
  BRANCH = branch;
  STOCK_ITEMS = refs.stockItems;
  await draw(root);
}

async function draw(root) {
  const liveToday = todayISO();
  if (TODAY !== liveToday) {
    TODAY = liveToday;
    S = { tab: 'home', draft: null, openDraft: null, errors: {}, editingToday: false,
      receivedOpen: true, receivedDraft: null };
  }
  root.innerHTML = `<div class="wrap phone" id="staffRoot"><div class="boot">กำลังโหลดข้อมูลวันนี้…</div></div>`;
  const box = $('#staffRoot');
  const future = futureDates(TODAY, 31).slice(0, 14);
  const monthStart = TODAY.slice(0, 8) + '01';

  const [
    { data: clockRow }, { data: prevRows }, { data: todayRow },
    { data: dayOffsAll }, { data: reliefOffs }, { data: rounds },
    { data: deliveries }, { data: allBranches },
  ] = await Promise.all([
    supabase.from('clock_records').select('*').eq('branch_id', BRANCH.id).eq('clock_date', TODAY).maybeSingle(),
    supabase.from('daily_records').select('*').eq('branch_id', BRANCH.id).lt('record_date', TODAY).order('record_date', { ascending: false }).limit(1),
    supabase.from('daily_records').select('*').eq('branch_id', BRANCH.id).eq('record_date', TODAY).maybeSingle(),
    supabase.from('day_offs').select('*').gte('off_date', TODAY).lte('off_date', future[future.length - 1]),
    supabase.from('relief_day_offs').select('*').gte('off_date', TODAY).lte('off_date', future[future.length - 1]),
    loadRefs().then(refs => ({ data: refs.rounds })),
    supabase.from('deliveries').select('*').eq('branch_id', BRANCH.id).eq('delivery_date', TODAY),
    supabase.from('branches').select('id,name'),
  ]);
  const ctx = {
    clock: clockRow || null, prev: (prevRows && prevRows[0]) || null, today: todayRow || null,
    dayOffsAll: dayOffsAll || [], reliefOffs: (reliefOffs || []).map(x => x.off_date),
    rounds: rounds || [], deliveries: deliveries || [],
    branchNames: (allBranches || []).reduce((a, b) => (a[b.id] = b.name, a), {}),
    future,
  };

  box.innerHTML = shell(ctx);
  wireTabs(box, ctx);
  wireEvents(box, ctx);
}

function shell(ctx) {
  const sentToday = !!(ctx.today && ctx.today.sent);
  const storeClosed = !!(ctx.today && ctx.today.store_closed);
  let body = S.tab === 'home' ? homeTab(ctx) : S.tab === 'close' ? closeTab(ctx) : meTab(ctx);
  return `<div id="staffHead">
      <div class="app-head">
        <div><h1>${esc(ME.name)}</h1><div class="sub">สาขา${esc(BRANCH.name)} · ${fmtDate(TODAY)}</div></div>
        <span class="pill ${storeClosed ? 'warn' : sentToday ? 'ok' : 'wait'}">${storeClosed ? 'ปิดร้าน' : sentToday ? 'ส่งยอดแล้ว' : 'ยังไม่ส่งยอด'}</span>
      </div>
    </div>
    <div id="staffBody">${body}</div>
    <nav class="tabs">
      <button data-tab="home" aria-pressed="${S.tab === 'home'}"><span class="dot"></span>หน้าแรก</button>
      <button data-tab="close" aria-pressed="${S.tab === 'close'}"><span class="dot"></span>ปิดยอดวันนี้</button>
      <button data-tab="me" aria-pressed="${S.tab === 'me'}"><span class="dot"></span>ของฉัน</button>
    </nav>`;
}

const hhmm = t => String(t || '').slice(0, 5) || '—';

function isRoundOn(rounds, dateISO) {
  const dow = new Date(dateISO + 'T00:00:00').getDay();
  return rounds.find(r => r.day_of_week === dow) || null;
}

/* ============================== แท็บหน้าแรก ============================== */
function homeTab(ctx) {
  const { clock, prev, today } = ctx;
  const clockedIn = !!(clock && clock.time_in);
  const openSet = clock && clock.open_yen != null && clock.open_pan != null;
  const alreadySent = !!(today && today.sent);
  const isHandoff = !!(prev && prev.staff_name !== ME.name);

  const myOff = ctx.dayOffsAll.filter(x => x.branch_id === BRANCH.id).map(x => x.off_date);
  const report = quotaReport(myOff, ctx.future, BRANCH.days_off_quota);
  const monthFull = new Map(report.map(r => [r.label, r.used >= BRANCH.days_off_quota]));
  const dayChips = ctx.future.map(d => {
    const taken = ctx.dayOffsAll.find(x => x.off_date === d);
    const mine = taken && taken.branch_id === BRANCH.id;
    const otherId = taken && !mine ? taken.branch_id : null;
    const roundOnD = isRoundOn(ctx.rounds, d);
    const round = !!roundOnD;
    const headOff = ctx.reliefOffs.includes(d);
    const blocked = round || headOff;
    const full = monthFull.get(monthLabel(d)) || false;
    const newMonth = d === ctx.future.find(x => monthKey(x) === monthKey(d));
    const cls = round ? 'round' : mine ? 'mine' : otherId ? 'taken' : blocked ? 'round' : full ? 'full' : 'free';
    const otherName = otherId ? (ctx.branchNames[otherId] || otherId) : '';
    const title = round ? `วันส่งของ (${roundOnD.name}) — ห้ามหยุด`
      : headOff ? 'หัวหน้าหยุดวันนี้แล้ว ไม่มีคนมาแทน'
      : otherId ? `สาขา${otherName} จองวันนี้ไปแล้ว`
      : full && !mine ? `ครบโควตาของเดือน ${monthLabel(d)} แล้ว` : '';
    const tag = round ? '<span class="dt">ส่งของ</span>' : otherId ? `<span class="dt">${esc(otherName)}</span>`
      : mine ? '<span class="dt">หยุด</span>' : cls === 'free' ? '<span class="dt ok">ว่าง</span>' : '';
    return dayChip(d, 'off', cls, otherId || blocked || (full && !mine), title, tag, newMonth);
  }).join('');

  const round = isRoundOn(ctx.rounds, TODAY);
  const dlv = round ? ctx.deliveries.find(x => x.round_id === round.id) : null;

  if (today && today.store_closed) return `
    <div class="card pad" style="border-left:3px solid var(--amber);margin-bottom:14px">
      <div class="between"><div class="eyebrow">วันนี้ปิดร้าน</div><span class="pill warn">ปิดร้าน</span></div>
      <p class="sub" style="margin:8px 0 0">เจ้าของหรือหัวหน้าบันทึกปิดร้านแล้ว วันนี้ไม่ต้องลงเวลาและไม่ต้องปิดยอด ระบบเก็บยอดแก้วและเงินทอนต่อจากเมื่อวานไว้ให้แล้ว</p>
    </div>
    <div class="card pad">
      <div class="eyebrow" style="margin-bottom:4px">จองวันหยุด</div>
      <p class="sub" style="margin:0 0 10px">จองล่วงหน้าได้ 14 วัน · แตะวันที่ขึ้น <b style="color:var(--brand)">ว่าง</b> เพื่อจอง · โควตานับแยกเป็นรายเดือน</p>
      <div class="daygrid">${dayChips}</div>
      ${OFF_LEGEND}
      ${quotaHTML(report, BRANCH.days_off_quota)}
    </div>`;

  return `
    <div class="card pad clockcard" style="margin-bottom:14px">
      <div class="between"><div class="eyebrow">ลงเวลาทำงาน</div>
        <span class="sub">เวลาร้าน ${esc(hhmm(BRANCH.work_start))}–${esc(hhmm(BRANCH.work_end))}${N(BRANCH.late_grace_min) ? ` (ผ่อนผัน ${N(BRANCH.late_grace_min)} น.)` : ''}</span></div>
      <div class="bigtime">${nowHM()}</div>
      <div class="sub">${clock && clock.time_in ? `เข้า ${clock.time_in}${N(clock.late_minutes) ? ` · สาย ${N(clock.late_minutes)} น.` : ''}` : ''}${clock && clock.time_out ? ` · ออก ${clock.time_out}${N(clock.early_minutes) ? ` · ปิดไว ${N(clock.early_minutes)} น.` : ''}` : ''}</div>
      ${!clockedIn && calc.lateMinutes(nowHM(), BRANCH.work_start, BRANCH.late_grace_min) > 0
        ? `<div class="note" style="margin-top:8px">ตอนนี้เลยเวลาเข้างานแล้ว ${calc.lateMinutes(nowHM(), BRANCH.work_start, BRANCH.late_grace_min)} นาที — กดลงเวลาเลยเพื่อไม่ให้สายเพิ่ม</div>` : ''}
      ${clockedIn && !clock.time_out
        ? `<div class="note" style="margin-top:8px"><b>อย่าลืมกดลงเวลาออกก่อนกลับ</b> — ลืมลงเวลาหัก 40 บาท (ต้องลงให้ครบทั้งเข้าและออก)</div>` : ''}
      <p class="sub" style="margin:8px 0 0;font-size:12px">ลงเวลาได้เฉพาะตอนอยู่ที่ร้าน (ในระยะ ${N(BRANCH.gps_radius) || 100} เมตร) — ต้องเปิดตำแหน่ง/GPS ของเครื่องไว้</p>
      ${!clockedIn
        ? `<button class="btn primary big" id="clockInBtn" style="margin-top:12px">ลงเวลาเข้างาน</button>`
        : !clock.time_out
          ? `<button class="btn big" id="clockOutBtn" style="margin-top:10px">ลงเวลาออกงาน</button>`
          : `<div class="pill ok" style="margin-top:10px">ลงเวลาครบวันนี้แล้ว</div>`}
    </div>

    ${clockedIn && !openSet && !alreadySent ? renderOpenCount({ prev, isHandoff }) : ''}

    <div class="card pad">
      <div class="eyebrow" style="margin-bottom:4px">จองวันหยุด</div>
      <p class="sub" style="margin:0 0 10px">จองล่วงหน้าได้ 14 วัน · แตะวันที่ขึ้น <b style="color:var(--brand)">ว่าง</b> เพื่อจอง · โควตานับแยกเป็นรายเดือน</p>
      <div class="daygrid">${dayChips}</div>
      ${OFF_LEGEND}
      ${quotaHTML(report, BRANCH.days_off_quota)}
    </div>

    <div class="card pad" id="remitCard">กำลังโหลดยอดเงินสดค้างส่ง…</div>

    ${round ? receivedCardHTML(round, dlv) : ''}

    ${alreadySent ? `<div class="locked">ส่งยอดของวันนี้แล้ว<br><span class="sub">หากกดผิด ยังแก้ได้ภายในวันนี้</span>
      ${today.store_closed ? '' : '<button class="btn" id="editTodayHomeBtn" style="margin-top:10px">แก้ไขยอดวันนี้</button>'}</div>` : ''}
  `;
}

function renderOpenCount({ prev, isHandoff }) {
  if (!S.openDraft) S.openDraft = { yen: prev ? prev.yen : '', pan: prev ? prev.pan : '' };
  const msg = !prev
    ? 'นับแก้วเย็น/ปั่นที่เหลืออยู่จริงก่อนเริ่มขายวันนี้ แล้วกดยืนยัน'
    : isHandoff
      ? `วันนี้มาทำงานต่อจากที่${esc(prev.staff_name)}ทำ — ระบบขึ้นยอดที่ปิดไว้เมื่อวานให้แล้ว เช็ค/แก้ให้ตรงกับที่นับจริงก่อนเริ่มขาย แล้วกดยืนยัน`
      : 'ระบบขึ้นยอดที่ปิดไว้เมื่อวานให้แล้ว เช็คให้ตรงกับที่นับจริงก่อนเริ่มขาย แก้ได้ถ้าไม่ตรง แล้วกดยืนยัน';
  return `
    <div class="card pad" style="border-left:3px solid var(--amber)">
      <div class="eyebrow">นับแก้วก่อนเริ่มขาย</div>
      <p class="sub" style="margin:6px 0 10px">${esc(msg)}</p>
      <div class="field"><label>แก้วเย็นคงเหลือตอนนี้ (ใบ)</label>
        <input inputmode="numeric" id="openYen" value="${S.openDraft.yen}" /></div>
      <div class="field"><label>แก้วปั่นคงเหลือตอนนี้ (ใบ)</label>
        <input inputmode="numeric" id="openPan" value="${S.openDraft.pan}" /></div>
      <button class="btn primary big" id="openCountBtn" style="margin-top:10px">ยืนยันนับแก้ว</button>
    </div>`;
}

function receivedCardHTML(round, dlv) {
  if (!dlv) return `<div class="card pad">
      <div class="eyebrow">วัตถุดิบนำเข้า</div>
      <p class="sub" style="margin-top:6px">วันนี้เป็นรอบส่งของ (${esc(round.name)}) — รอหัวหน้าจัดของให้ก่อน ถึงจะเช็ครายการได้</p>
    </div>`;
  const items = Object.entries(dlv.items);
  if (dlv.received) {
    return `<div class="card pad">
      <div class="between"><div class="eyebrow">วัตถุดิบนำเข้า</div><span class="pill ok">เช็คแล้ว</span></div>
      <p class="sub" style="margin-top:6px">เช็ครายการที่ได้รับของรอบนี้เรียบร้อยแล้ว ${items.length} รายการ — ถ้าตัวเลขผิด แจ้งเจ้าของให้แก้ให้</p>
    </div>`;
  }
  const draft = S.receivedDraft || {};
  const rows = items.map(([id, qty]) => {
    const it = STOCK_ITEMS.find(x => String(x.id) === String(id)); if (!it) return '';
    const v = draft[id] !== undefined ? draft[id] : '';
    return `<div class="stockrow">
      <div><div class="nm">${esc(it.name)}</div><div class="un">${esc(it.unit)} · หัวหน้าส่งมา ${qty}</div></div>
      <input data-received="${id}" inputmode="decimal" placeholder="${qty}" value="${v}">
    </div>`;
  }).join('');
  return `<div class="card pad" id="receivedBox" data-dlv="${dlv.id}">
    <div class="between" style="margin-bottom:4px">
      <div class="eyebrow">วัตถุดิบนำเข้า</div>
      <button class="mini" id="receivedToggleBtn">${S.receivedOpen ? 'ซ่อน' : 'เช็ครายการ'}</button>
    </div>
    ${S.receivedOpen ? `
    <p class="sub" style="margin:0 0 10px">หัวหน้าส่งของมาแล้ว ${items.length} รายการ — นับของจริงแล้วกรอกจำนวนที่ได้รับ ช่องไหนไม่กรอกถือว่าได้ตามที่ส่งมา</p>
    <div class="stocklist">${rows}</div>
    <button class="btn primary" id="receivedSubmitBtn" style="width:100%;margin-top:10px">ยืนยันของที่ได้รับ</button>
    ` : ''}
  </div>`;
}

async function loadRemitCard(ctx) {
  const el = $('#remitCard'); if (!el) return;
  // การ์ดนี้อยู่ใต้ส่วนหลักของหน้า จึงโหลดหลังหน้าพร้อมใช้งานแล้วและเก็บผลไว้กับ context เดียวกัน
  if (!ctx.remitDataPromise) {
    ctx.remitDataPromise = supabase.from('cash_remittances')
      .select('remit_date,amount,method,through_record_date,created_at').eq('branch_id', BRANCH.id)
      .order('created_at', { ascending: false }).limit(1).then(async ({ data: remits, error: remitError }) => {
      if (remitError) throw remitError;
      const cutoff = remits?.[0]?.through_record_date || remits?.[0]?.remit_date || null;
      const { data: recentRecords } = await supabase.from('daily_records').select('record_date,cash,float_cash,sent')
        .eq('branch_id', BRANCH.id).eq('sent', true).gte('record_date', BRANCH.cash_tracking_from || '2000-01-01')
        .order('record_date', { ascending: false });
      return { cutoff, recentRecords: recentRecords || [] };
    });
  }
  let data;
  try { data = await ctx.remitDataPromise; }
  catch (error) { el.innerHTML = `<p class="sub">โหลดยอดเงินสดไม่สำเร็จ — ${esc(error.message || 'ลองใหม่อีกครั้ง')}</p>`; return; }
  const p = calc.cashPending(data.recentRecords, data.cutoff);
  const round = isRoundOn(ctx.rounds, TODAY);
  el.innerHTML = `
    <div class="between" style="margin-bottom:4px">
      <div class="eyebrow">เงินสดค้างส่งหัวหน้า</div>
      <span class="sub">ค้าง ${p.dates.length} วัน</span>
    </div>
    <div class="bigtime">${baht(p.amount)} <span class="sub" style="font-size:13px;font-weight:400">บาท</span></div>
    ${round ? `
      <p class="sub" style="margin:8px 0 10px">วันนี้หัวหน้ามาส่งของ (${esc(round.name)}) — ส่งเงินสดสะสมให้ด้วย</p>
      <div class="row" style="gap:8px">
        <button class="btn primary" data-remit="cash" style="flex:1" ${p.amount <= 0 ? 'disabled' : ''}>ส่งเงินสดแล้ว</button>
        <button class="btn" data-remit="transfer" style="flex:1" ${p.amount <= 0 ? 'disabled' : ''}>โอนเงินแทน</button>
      </div>
    ` : `<p class="sub" style="margin-top:8px">หัวหน้าจะมารับตามรอบส่งของถัดไป${nextRoundText(ctx)}</p>`}
  `;
  wireRemitButtons(el, p);
}

// รอบส่งของถัดไปคือวันไหน — พนักงานจะได้รู้ว่าต้องเตรียมเงินสดไว้ให้หัวหน้าวันไหน
function nextRoundText(ctx) {
  if (!ctx.rounds.length) return '';
  const d = futureDates(TODAY, 14).find(x => isRoundOn(ctx.rounds, x));
  if (!d) return '';
  const r = isRoundOn(ctx.rounds, d);
  return ` — ${fmtDate(d)} (${r.name})`;
}

function wireRemitButtons(el, p) {
  el.querySelectorAll('[data-remit]').forEach(btn => btn.addEventListener('click', () => doRemit(btn.dataset.remit, p)));
}

async function doRemit(method, p) {
  if (p.amount <= 0) { toast('ไม่มีเงินสดค้างส่ง'); return; }
  if (todayISO() !== TODAY) { await draw($('#roleRoot')); toast('ข้ามวันแล้ว โหลดข้อมูลวันใหม่ให้แล้ว'); return; }
  const btn = document.querySelector(`[data-remit="${method}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }
  const { error } = await supabase.from('cash_remittances').insert({
    branch_id: BRANCH.id, remit_date: TODAY, amount: p.amount, method, through_record_date: p.throughDate,
  });
  if (error) { if (btn) btn.disabled = false; toast('บันทึกไม่สำเร็จ: ' + error.message); return; }
  toast((method === 'cash' ? 'บันทึกว่าส่งเงินสดแล้ว ' : 'บันทึกว่าโอนเงินแล้ว ') + baht(p.amount) + ' บาท');
  await draw($('#roleRoot'));
}

/* ============================== แท็บปิดยอดวันนี้ ============================== */
function closeTab(ctx) {
  const { clock, prev, today } = ctx;
  if (today && today.store_closed) {
    return `<div class="locked"><h3>วันนี้ปิดร้าน</h3><p class="sub" style="margin:8px 0 0">รายการนี้แก้ได้โดยเจ้าของเท่านั้น</p></div>`;
  }
  if (today && today.sent && !S.editingToday) {
    return `<div class="locked"><h3>ส่งยอดวันนี้เรียบร้อย</h3>
      <p class="sub" style="margin:8px 0 10px">หากกดตัวเลขผิด แก้ได้ถึงสิ้นวันนี้ หลังจากนั้นให้เจ้าของแก้</p>
      <button class="btn primary" id="editTodayBtn">แก้ไขยอดวันนี้</button></div>`;
  }
  const openSet = clock && clock.open_yen != null && clock.open_pan != null;
  if (!clock || !clock.time_in) return `<div class="card pad"><p class="sub">ลงเวลาเข้างานก่อน (แท็บหน้าแรก) ถึงจะเริ่มนับแก้ว/ปิดยอดได้</p></div>`;
  if (!openSet) return `<div class="card pad"><p class="sub">นับแก้วก่อนเริ่มขายให้เสร็จก่อน (แท็บหน้าแรก) ถึงจะปิดยอดได้</p></div>`;
  return renderCloseForm({ clock, prev, today });
}

function renderCloseForm({ clock, prev, today }) {
  const d = S.draft || (S.draft = today && S.editingToday ? draftFromRecord(today, STOCK_ITEMS) : defaultDraft(prev, BRANCH, STOCK_ITEMS));
  return `<div class="stack">
      ${S.editingToday ? `<div class="card pad"><div class="eyebrow">ยอดแก้วตอนเริ่มขาย</div>
        <p class="sub" style="margin:6px 0 10px">แก้ส่วนนี้ได้หากตอนเริ่มวันกดตัวเลขผิด ระบบจะคำนวณยอดขายใหม่ให้</p>
        <div class="field"><label>แก้วเย็นตอนเริ่มขาย</label><input id="editOpenYen" inputmode="numeric" value="${S.openDraft?.yen ?? clock.open_yen ?? 0}"></div>
        <div class="field"><label>แก้วปั่นตอนเริ่มขาย</label><input id="editOpenPan" inputmode="numeric" value="${S.openDraft?.pan ?? clock.open_pan ?? 0}"></div>
      </div>` : ''}
      ${closeFormHTML({ draft: d, errors: S.errors, prev, cfg: getSettings(), attr: 'f', stockItems: STOCK_ITEMS })}
      ${S.editingToday ? '<button class="btn primary big" id="sendBtn">บันทึกยอดที่แก้</button><button class="btn big" id="cancelTodayEditBtn">ยกเลิกการแก้ไข</button>'
        : '<button class="btn primary big" id="sendBtn">ส่งยอด</button>'}
      <p class="sub" style="text-align:center;margin:0">${S.editingToday ? 'ระบบเก็บประวัติตัวเลขเดิมและตัวเลขใหม่ทุกครั้ง' : 'ตรวจให้ครบก่อนกด หากผิดยังแก้ได้ภายในวันนี้'}</p>
    </div>`;
}

/* ============================== แท็บของฉัน (เงินเดือน + ประวัติ) ============================== */
function meTab(ctx) {
  return `<div class="stack" id="meBox"><div class="boot">กำลังคำนวณเงินเดือน…</div></div>`;
}

async function loadMeTab(ctx) {
  const box = $('#meBox'); if (!box) return;
  const cfg = getSettings();
  const dates = monthDates(TODAY);
  const monthStart = dates[0];
  const [{ data: records }, { data: clocks }, { data: reliefName }] = await Promise.all([
    supabase.from('daily_records').select('*').eq('branch_id', BRANCH.id).gte('record_date', monthStart).lte('record_date', dates[dates.length - 1]),
    supabase.from('clock_records').select('*').eq('branch_id', BRANCH.id).gte('clock_date', monthStart).lte('clock_date', dates[dates.length - 1]),
    supabase.rpc('relief_name'),   // กันวันที่หัวหน้ามาทำแทนออกจากยอดของสาขา (ดู calc.payrollFor)
  ]);
  const clocksByDate = {}; (clocks || []).forEach(c => { clocksByDate[c.clock_date] = c; });
  const pr = calc.payrollFor({
    branch: { relief_name: reliefName || '', base_salary: N(ME.base_salary), days_off_quota: BRANCH.days_off_quota, holiday_work_days: BRANCH.holiday_work_days || 0 },
    records: records || [], clocksByDate, allDatesInMonth: dates, todayISO: TODAY, cfg,
  });
  const rows = (clocks || []).filter(c => c.staff_name !== reliefName).slice().sort((a, b) => b.clock_date < a.clock_date ? -1 : 1).slice(0, 15).map(c => {
    const r = (records || []).find(x => x.record_date === c.clock_date);
    const cc = r ? calc.calcDay(r, c, cfg) : null;
    return `<tr><td>${fmtDate(c.clock_date)}</td><td class="n">${c.time_in || '–'}</td><td class="n">${c.time_out || '–'}</td>
      <td class="n">${cc ? cc.cups : '–'}</td>
      <td>${c.no_clock ? `<span class="pill bad">ไม่ลงเวลา</span>`
        : [c.late_minutes ? `<span class="pill warn">สาย ${c.late_minutes} น.</span>` : '',
           c.early_minutes ? `<span class="pill warn">ปิดไว ${c.early_minutes} น.</span>` : ''].join(' ')}</td></tr>`;
  }).join('');

  box.innerHTML = `
    <div class="card pad">
      <div class="between" style="margin-bottom:2px"><div class="eyebrow">สรุปเงินเดือน (ประมาณการเดือนนี้)</div>
        <button class="mini" id="printSlipBtn">ปริ้นสลิป</button></div>
      <div class="bigtime" style="margin:6px 0 2px">${baht(pr.total)} <span class="sub" style="font-size:13px;font-weight:400">บาท</span></div>
      <div class="sub" style="margin-bottom:10px">ยอดสุทธิโดยประมาณ · จ่ายจริงทุกวันที่ 5</div>
      <div class="payrows">
        <div class="payrow"><span>เงินเดือนฐาน</span><span class="n">${baht(N(ME.base_salary))}</span></div>
        <div class="payrow"><span>เบี้ยขยัน${pr.reset ? ' <span class="sub" style="color:var(--bad)">— โดนรีเซ็ตเดือนนี้</span>' : ''}</span><span class="n">${baht(pr.diligence)}</span></div>
        ${pr.holidayPay ? `<div class="payrow"><span>ค่าทำงานวันหยุด</span><span class="n">${baht(pr.holidayPay)}</span></div>` : ''}
        <div class="payrow"><span>ค่าแก้ว (${pr.cups} ใบ)</span><span class="n">${baht(pr.cupPay)}</span></div>
        <div class="payrow"><span>ใช้โควตาวันหยุด</span><span class="n">${pr.daysOffTaken} / ${BRANCH.days_off_quota} วัน</span></div>
        ${pr.deduct ? `<div class="payrow neg"><span>หัก สาย ${pr.late} น. / ปิดไว ${pr.early} น.${pr.noClock ? ` / ลืมลงเวลา ${pr.noClock} ครั้ง` : ''}${pr.excess ? ` / หยุดเกิน ${pr.excess} วัน` : ''}</span><span class="n">−${baht(pr.deduct)}</span></div>` : ''}
      </div>
      <div class="note" style="margin-top:10px">ผ่อนผันมาสายรวมปิดไวได้ไม่เกิน ${cfg.diligenceRules.lateAllowance} นาที/เดือน เกินแล้วเบี้ยขยันเป็น 0</div>
    </div>

    <div class="tablewrap"><table><thead><tr><th>วันที่</th><th>เข้า</th><th>ออก</th><th>แก้ว</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
  `;
  const pb = $('#printSlipBtn'); if (pb) pb.addEventListener('click', async () => {
    const [companies, { data: mine }] = await Promise.all([
      getCompanies(),
      supabase.from('employee_private').select('*').eq('employee_id', ME.id).maybeSingle(),   // อ่านได้เฉพาะของตัวเอง
    ]);
    const html = staffSlipHTML({ name: BRANCH.name, staff_name: ME.name, first_name: ME.first_name, last_name: ME.last_name,
      national_id: mine?.national_id || '', base_salary: N(ME.base_salary), holiday_work_days: BRANCH.holiday_work_days || 0 },
      pr, monthLabel(dates[dates.length - 1]), companies);
    printDoc(html, 'ยังไม่มีสลิปให้ออก');
  });
}

/* ============================== ปุ่ม/อีเวนต์ ============================== */
function wireTabs(box, ctx) {
  box.querySelectorAll('nav.tabs button[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => { S.tab = btn.dataset.tab; box.querySelector('#staffBody').innerHTML = S.tab === 'home' ? homeTab(ctx) : S.tab === 'close' ? closeTab(ctx) : meTab(ctx);
      box.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      wireEvents(box, ctx);
      if (S.tab === 'home') loadRemitCard(ctx);
      if (S.tab === 'me') loadMeTab(ctx);
    });
  });
  if (S.tab === 'home') loadRemitCard(ctx);
  if (S.tab === 'me') loadMeTab(ctx);
}

function wireEvents(box, ctx) {
  const cIn = $('#clockInBtn'); if (cIn) cIn.addEventListener('click', () => doClock('in'));
  const cOut = $('#clockOutBtn'); if (cOut) cOut.addEventListener('click', () => doClock('out'));
  const openBtn = $('#openCountBtn'); if (openBtn) openBtn.addEventListener('click', () => doOpenCount(ctx));
  box.querySelectorAll('.daychip[data-off]').forEach(chip => {
    chip.addEventListener('click', () => doToggleOff(chip.dataset.off, ctx));
  });
  const recToggle = $('#receivedToggleBtn'); if (recToggle) recToggle.addEventListener('click', () => { S.receivedOpen = !S.receivedOpen; draw($('#roleRoot')); });
  box.querySelectorAll('input[data-received]').forEach(inp => {
    inp.addEventListener('input', () => { S.receivedDraft = S.receivedDraft || {}; S.receivedDraft[inp.dataset.received] = numIn(inp.value); });
  });
  const recSubmit = $('#receivedSubmitBtn'); if (recSubmit) recSubmit.addEventListener('click', () => doSubmitReceived(ctx));
  const beginTodayEdit = () => {
    S.editingToday = true; S.draft = draftFromRecord(ctx.today, STOCK_ITEMS);
    S.openDraft = { yen: ctx.today.open_yen ?? ctx.clock?.open_yen ?? 0, pan: ctx.today.open_pan ?? ctx.clock?.open_pan ?? 0 };
    S.errors = {}; S.tab = 'close';
    draw($('#roleRoot'));
  };
  const editToday = $('#editTodayBtn'); if (editToday) editToday.addEventListener('click', beginTodayEdit);
  const editTodayHome = $('#editTodayHomeBtn'); if (editTodayHome) editTodayHome.addEventListener('click', beginTodayEdit);
  const cancelTodayEdit = $('#cancelTodayEditBtn'); if (cancelTodayEdit) cancelTodayEdit.addEventListener('click', () => {
    S.editingToday = false; S.draft = null; S.openDraft = null; S.errors = {}; draw($('#roleRoot'));
  });
  const editOpenYen = $('#editOpenYen'); if (editOpenYen) editOpenYen.addEventListener('input', () => { S.openDraft.yen = numIn(editOpenYen.value); });
  const editOpenPan = $('#editOpenPan'); if (editOpenPan) editOpenPan.addEventListener('input', () => { S.openDraft.pan = numIn(editOpenPan.value); });

  box.querySelectorAll('input[data-f]').forEach(inp => {
    inp.addEventListener('input', () => { S.draft[inp.dataset.f] = numIn(inp.value); });
  });
  box.querySelectorAll('input[data-stock]').forEach(inp => {
    inp.addEventListener('input', () => { S.draft.stock[inp.dataset.stock] = numIn0(inp.value); });
  });
  const sendBtn = $('#sendBtn'); if (sendBtn) sendBtn.addEventListener('click', () => doSend(ctx));
}

// ลงเวลาเข้า-ออก — ตรวจ GPS ทุกครั้ง ป้องกันกดซ้ำ และรองรับ Supabase รุ่นก่อน migration
function missingDistanceColumn(error) {
  const message = String((error && error.message) || '');
  return ['PGRST204', '42703'].includes(error && error.code)
    && /(?:in|out)_distance_m|schema cache/i.test(message);
}

function friendlyClockError(error) {
  const message = String((error && error.message) || '');
  if ((error && error.code) === '42501' || /row.level security|permission denied/i.test(message)) {
    return 'บัญชีนี้ไม่มีสิทธิ์บันทึกเวลาของสาขา กรุณาออกจากระบบแล้วเข้าใหม่ หากยังไม่ได้ให้แจ้งเจ้าของ';
  }
  if (/failed to fetch|network|load failed/i.test(message)) {
    return 'เชื่อมต่อฐานข้อมูลไม่ได้ กรุณาเช็คอินเทอร์เน็ตแล้วกดลองใหม่';
  }
  return message || 'ฐานข้อมูลไม่ตอบกลับ กรุณาลองใหม่';
}

async function saveClock(kind, timeStr, minutes, distance) {
  if (kind === 'in') {
    const payload = {
      branch_id: BRANCH.id, clock_date: TODAY, staff_name: ME.name,
      time_in: timeStr, late_minutes: minutes, in_distance_m: distance,
    };
    let result = await supabase.from('clock_records').upsert(payload, { onConflict: 'branch_id,clock_date' });
    if (result.error && missingDistanceColumn(result.error)) {
      console.warn('GPS audit column is not installed; saving clock-in without distance');
      const { in_distance_m, ...compatible } = payload;
      result = await supabase.from('clock_records').upsert(compatible, { onConflict: 'branch_id,clock_date' });
    }
    return result.error || null;
  }

  const payload = { time_out: timeStr, early_minutes: minutes, out_distance_m: distance };
  let result = await supabase.from('clock_records').update(payload)
    .eq('branch_id', BRANCH.id).eq('clock_date', TODAY);
  if (result.error && missingDistanceColumn(result.error)) {
    console.warn('GPS audit column is not installed; saving clock-out without distance');
    const { out_distance_m, ...compatible } = payload;
    result = await supabase.from('clock_records').update(compatible)
      .eq('branch_id', BRANCH.id).eq('clock_date', TODAY);
  }
  return result.error || null;
}

async function doClock(kind) {
  if (clockBusy) return;
  clockBusy = true;
  const btn = $(kind === 'in' ? '#clockInBtn' : '#clockOutBtn');
  const originalText = btn && btn.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังตรวจตำแหน่ง… อาจใช้เวลาสักครู่'; }

  try {
    const at = await verifyForClock(BRANCH, toast);
    if (!at) return;
    if (btn) btn.textContent = 'กำลังบันทึกเวลา…';

    const timeStr = nowHM();
    const minutes = kind === 'in'
      ? calc.lateMinutes(timeStr, BRANCH.work_start, BRANCH.late_grace_min)
      : calc.earlyMinutes(timeStr, BRANCH.work_end);
    const error = await saveClock(kind, timeStr, minutes, at.distance ?? null);
    if (error) { toast('ลงเวลาไม่สำเร็จ: ' + friendlyClockError(error)); return; }

    if (kind === 'in') {
      toast(minutes ? `ลงเวลาเข้างานแล้ว ${timeStr} — สาย ${minutes} นาที` : 'ลงเวลาเข้างานแล้ว ' + timeStr);
    } else {
      toast(minutes ? `ลงเวลาออกงานแล้ว ${timeStr} — ปิดก่อนเวลา ${minutes} นาที` : 'ลงเวลาออกงานแล้ว ' + timeStr);
    }
    await draw($('#roleRoot'));
  } catch (error) {
    console.error('Clock operation failed', error);
    toast('ลงเวลาไม่สำเร็จ: ' + friendlyClockError(error));
  } finally {
    clockBusy = false;
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = originalText; }
  }
}

async function doOpenCount(ctx) {
  const yenEl = $('#openYen'), panEl = $('#openPan');
  if (yenEl.value === '' || panEl.value === '') { toast('กรอกแก้วเย็น/ปั่นให้ครบก่อนยืนยัน'); return; }
  const parsedYen = numIn(yenEl.value), parsedPan = numIn(panEl.value);
  if (parsedYen === '' || parsedPan === '' || parsedYen < 0 || parsedPan < 0 || !Number.isInteger(parsedYen) || !Number.isInteger(parsedPan)) {
    toast('จำนวนแก้วต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป'); return;
  }
  const newYen = parsedYen, newPan = parsedPan;
  const { error } = await supabase.from('clock_records')
    .update({ open_yen: newYen, open_pan: newPan }).eq('branch_id', BRANCH.id).eq('clock_date', TODAY);
  if (error) { toast('บันทึกไม่สำเร็จ: ' + error.message); return; }

  const prev = ctx.prev;
  if (prev && (newYen !== prev.yen || newPan !== prev.pan)) {
    const cfg = getSettings();
    const valueDiff = (newYen - prev.yen) * cfg.cupPrice.yen + (newPan - prev.pan) * cfg.cupPrice.pan;
    await supabase.from('recount_requests').insert({
      branch_id: BRANCH.id, request_date: TODAY, prev_record_id: prev.id, staff_name: ME.name,
      old_yen: prev.yen, old_pan: prev.pan, new_yen: newYen, new_pan: newPan, value_diff: valueDiff,
    });
    toast('บันทึกยอดนับแก้วแล้ว — ยอดไม่ตรงกับเมื่อวาน ส่งคำขอให้เจ้าของตรวจสอบแล้ว');
  } else {
    toast('บันทึกยอดนับแก้วก่อนเริ่มขายแล้ว');
  }
  S.openDraft = null;
  await draw($('#roleRoot'));
}

// จองวันหยุด/ยกเลิก — พอร์ตจาก toggleOff() ในต้นแบบ
async function doToggleOff(dateISO, ctx) {
  const mine = ctx.dayOffsAll.find(x => x.off_date === dateISO && x.branch_id === BRANCH.id);
  if (mine) {
    const { error } = await supabase.from('day_offs').delete().eq('off_date', dateISO).eq('branch_id', BRANCH.id);
    if (error) { toast('ยกเลิกวันหยุดไม่สำเร็จ: ' + error.message); return; }
    toast('ยกเลิกวันหยุด ' + fmtDate(dateISO));
    await draw($('#roleRoot')); return;
  }
  const rd = isRoundOn(ctx.rounds, dateISO);
  if (rd) { toast(`วันส่งของ (${rd.name}) ห้ามหยุด`); return; }
  if (ctx.reliefOffs.includes(dateISO)) { toast('หัวหน้าหยุดวันนี้แล้ว ไม่มีคนมาแทน'); return; }
  const taken = ctx.dayOffsAll.find(x => x.off_date === dateISO);
  if (taken) { toast(`วันนี้สาขา${ctx.branchNames[taken.branch_id] || taken.branch_id} จองไปแล้ว`); return; }
  const used = ctx.dayOffsAll.filter(x => x.branch_id === BRANCH.id && monthKey(x.off_date) === monthKey(dateISO)).length;
  if (used >= BRANCH.days_off_quota) { toast(`จองครบ ${BRANCH.days_off_quota} วันของเดือน ${monthLabel(dateISO)} แล้ว`); return; }
  const { error } = await supabase.from('day_offs').insert({ off_date: dateISO, branch_id: BRANCH.id });
  if (error) { toast('จองไม่สำเร็จ: ' + error.message); return; }
  toast('แจ้งวันหยุด ' + fmtDate(dateISO) + ' — หัวหน้าจะมาแทน');
  await draw($('#roleRoot'));
}

async function doSubmitReceived(ctx) {
  const box = $('#receivedBox'); if (!box) return;
  const dlvId = box.dataset.dlv;
  const dlv = ctx.deliveries.find(x => x.id === dlvId);
  if (!dlv) return;
  const draft = S.receivedDraft || {};
  const received = {};
  Object.keys(dlv.items).forEach(id => {
    const v = draft[id];
    received[id] = (v !== undefined && v !== '' && !isNaN(+v)) ? N(v) : dlv.items[id];
  });
  if (Object.values(received).some(v => v < 0)) { toast('จำนวนที่ได้รับติดลบไม่ได้'); return; }
  const btn = $('#receivedSubmitBtn'); if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }
  const { error } = await supabase.from('deliveries').update({ received, received_at: new Date().toISOString() }).eq('id', dlvId);
  if (error) { if (btn) btn.disabled = false; toast('บันทึกไม่สำเร็จ: ' + error.message); return; }
  S.receivedDraft = null;
  toast('บันทึกวัตถุดิบนำเข้าเรียบร้อย');
  await draw($('#roleRoot'));
}

async function doSend(ctx) {
  const d = S.draft;
  if (!d || !ctx.clock) return;   // กันกดปุ่มรัว ๆ บนมือถือ — คลิกที่สองมาถึงตอนฟอร์มถูกล้างไปแล้ว
  const openYen = S.editingToday ? numIn(S.openDraft?.yen) : ctx.clock.open_yen;
  const openPan = S.editingToday ? numIn(S.openDraft?.pan) : ctx.clock.open_pan;
  if (openYen === '' || openPan === '' || openYen < 0 || openPan < 0 || !Number.isInteger(openYen) || !Number.isInteger(openPan)) {
    toast('ยอดแก้วตอนเริ่มขายต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป'); return;
  }
  const effectiveClock = { ...ctx.clock, open_yen: openYen, open_pan: openPan };
  const errs = validateClose(d, effectiveClock);
  if (Object.keys(errs).length) {
    S.errors = errs; await draw($('#roleRoot')); toast('กรอกข้อมูลให้ครบและถูกต้องก่อน');
    const first = document.querySelector('.field input.err'); if (first) first.scrollIntoView({ block: 'center' });
    return;
  }
  if (todayISO() !== TODAY) { await draw($('#roleRoot')); toast('ข้ามวันแล้ว โหลดข้อมูลวันใหม่ให้แล้ว'); return; }
  const button = $('#sendBtn'); if (button) { button.disabled = true; button.textContent = 'กำลังบันทึก…'; }
  const params = {
    branchId: BRANCH.id, dateISO: TODAY, staffName: ME.name, draft: d, cfg: getSettings(),
    stockItems: STOCK_ITEMS, prevSnapshot: ctx.prev ? ctx.prev.stock_snapshot : {}, createdBy: ME.id,
    openYen, openPan,
  };
  const { error } = S.editingToday
    ? await updateClose({ recordId: ctx.today.id, draft: d, cfg: params.cfg, stockItems: STOCK_ITEMS,
      prevSnapshot: ctx.today.stock_snapshot || {}, openYen, openPan })
    : await submitClose(params);
  if (error) { toast('ส่งยอดไม่สำเร็จ: ' + error.message); return; }
  const wasEditing = S.editingToday;
  S.draft = null; S.openDraft = null; S.errors = {}; S.editingToday = false; S.tab = 'home';
  // ไม่บอกผลขาด/เกินให้พนักงานเห็น — ตามกติกาที่ตกลงไว้ว่าเจ้าของตรวจฝ่ายเดียว
  toast(wasEditing ? 'แก้ไขยอดวันนี้แล้ว — เก็บประวัติไว้เรียบร้อย' : 'ส่งยอดเรียบร้อย — แจ้งเจ้าของแล้ว');
  await draw($('#roleRoot'));
}
