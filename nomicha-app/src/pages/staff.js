// หน้าพนักงานสาขา — ลงเวลา + นับแก้วก่อนขาย + ปิดยอด + จองวันหยุด + ส่งเงินสด + เช็ควัตถุดิบนำเข้า + เงินเดือน/เบิกเงิน
// พอร์ตตรงจาก staffView()/staffHome()/staffClose()/staffMe() และฟังก์ชันที่เกี่ยวข้องในต้นแบบ nomicha.html (3 แท็บ: หน้าแรก/ปิดยอด/ของฉัน)
//
// ตรวจสอบแล้ว (5 ก.ย. 69): เทียบสูตร calcExpected()/calcDay() กับ calc() ของต้นแบบด้วยข้อมูลจริง — ตรงกันทุกบิต (ดูคอมเมนต์ใน calc.js)
//
// แก้ไข (รอบสอง, 5 ก.ย. 69): ก่อนหน้านี้เข้าใจผิดว่าต้นแบบบังคับ "นับแก้วก่อนขาย" เฉพาะวันเปลี่ยนมือ — พบว่าจริง ๆ บังคับทุกวัน
// (แค่ขึ้นข้อความต่างกัน) ต้นแบบกรอกยอดเมื่อวานไว้ล่วงหน้าให้ กดยืนยันเฉยๆ ได้เลยถ้าตรง — เวอร์ชันนี้ pre-fill ตรงกันแล้ว
//
// แก้ไข (รอบสาม, 5 ก.ย. 69): พบว่ารุ่นก่อนหน้าของไฟล์นี้ยังขาดฟีเจอร์ที่ต้นแบบมีจริงหลายอย่าง (ไล่โค้ดต้นแบบซ้ำตอนทำ "ทำต่อให้เสร็จ")
// เพิ่มในรุ่นนี้: จองวันหยุด (day_offs), ส่งเงินสดให้หัวหน้า + เก็บไว้เป็นเงินกู้แทน (cash_remittances/remit_loan_offsets),
// เช็ควัตถุดิบนำเข้า (deliveries.received), แท็บ "ของฉัน" (สรุปเงินเดือน + ขอเบิกเงิน/เงินกู้ + ประวัติลงเวลา)
import { supabase } from '../supabaseClient.js';
import { getSettings } from '../settings.js';
import { $, N, numIn, numIn0, baht, esc, toast, todayISO, nowHM, fmtDate, monthKey, monthLabel, monthDates } from '../util.js';
import { quotaReport, dayChip, OFF_LEGEND, quotaHTML, futureDates } from '../dayoff.js';
import { getCompanies, staffSlipHTML, printDoc } from '../print.js';
import { defaultDraft, closeFormHTML, validateClose, submitClose } from '../close.js';
import { verifyForClock } from '../geo.js';
import * as calc from '../calc.js';

let ME, BRANCH, TODAY, STOCK_ITEMS = [];
let S = { tab: 'home', draft: null, openDraft: null, errors: {}, advOpen: false, advAmount: '',
  loanRemitOpen: false, loanRemitAmt: '', receivedOpen: true, receivedDraft: null };

export async function renderStaffApp(root, me) {
  ME = me;
  TODAY = todayISO();
  const [{ data: branch, error }, { data: items }] = await Promise.all([
    supabase.from('branches').select('id,name,float_cash,days_off_quota,holiday_work_days,gps_lat,gps_lng,gps_radius,work_start,work_end,late_grace_min,company_id,active').eq('id', me.branch_id).single(),
    supabase.from('stock_items').select('id,name,unit,min_qty,per_case,branch_price,category_id,display_order,active').eq('active', true).order('display_order'),
  ]);
  if (error || !branch) { root.innerHTML = `<div class="wrap"><p class="sub">หาสาขาของคุณไม่เจอ — แจ้งเจ้าของ</p></div>`; return; }
  BRANCH = branch;
  STOCK_ITEMS = items || [];
  await draw(root);
}

async function draw(root) {
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
    supabase.from('delivery_rounds').select('*'),
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
  let body = S.tab === 'home' ? homeTab(ctx) : S.tab === 'close' ? closeTab(ctx) : meTab(ctx);
  return `<div id="staffHead">
      <div class="app-head">
        <div><h1>${esc(ME.name)}</h1><div class="sub">สาขา${esc(BRANCH.name)} · ${fmtDate(TODAY)}</div></div>
        <span class="pill ${sentToday ? 'ok' : 'wait'}">${sentToday ? 'ส่งยอดแล้ว' : 'ยังไม่ส่งยอด'}</span>
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

    ${alreadySent ? `<div class="locked">ส่งยอดของวันนี้แล้ว<br><span class="sub">ถ้าตัวเลขผิด แจ้งเจ้าของให้แก้ให้</span></div>` : ''}
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
  const cfg = getSettings();
  // การ์ดนี้อยู่ใต้ส่วนหลักของหน้า จึงโหลดหลังหน้าพร้อมใช้งานแล้ว
  // และเก็บผลไว้กับ context เดียวกันเพื่อไม่ยิงซ้ำเมื่อเปิด/ปิดฟอร์มกู้เงิน
  if (!ctx.advancesPromise) {
    ctx.advancesPromise = supabase.from('advances').select('*').eq('branch_id', BRANCH.id)
      .order('request_date', { ascending: false }).then(({ data }) => data || []);
  }
  if (!ctx.remitDataPromise) {
    ctx.remitDataPromise = Promise.all([
      supabase.from('cash_remittances').select('remit_date,amount,method').eq('branch_id', BRANCH.id).order('remit_date', { ascending: false }),
      supabase.from('remit_loan_offsets').select('amount').eq('branch_id', BRANCH.id).maybeSingle(),
      ctx.advancesPromise,
    ]).then(async ([{ data: remits }, { data: offsetRow }, { data: advances }]) => {
      const lastRemitDate = remits?.[0]?.remit_date || '2000-01-01';
      const { data: recentRecords } = await supabase.from('daily_records').select('record_date,cash,float_cash,sent')
        .eq('branch_id', BRANCH.id).eq('sent', true).gte('record_date', lastRemitDate)
        .order('record_date', { ascending: false });
      return { remits: remits || [], remitOffset: offsetRow ? N(offsetRow.amount) : 0, advances: advances || [], recentRecords: recentRecords || [] };
    });
  }
  const { remits, remitOffset, advances, recentRecords } = await ctx.remitDataPromise;
  ctx.advances = advances;
  ctx.remitOffset = remitOffset;
  const p = calc.cashPending(recentRecords, remits[0]?.remit_date || null, remitOffset);
  const round = isRoundOn(ctx.rounds, TODAY);
  const myAdv = advances.filter(a => !calc.isSettled(a, TODAY));
  const advLines = myAdv.map(a => `<div class="between"><span>${a.type === 'advance' ? 'คำขอเบิกเงิน' : 'เงินกู้'} ${baht(a.total)} บาท</span><span class="sub">หักเงินเดือนงวดถัดไป</span></div>`).join('');
  el.innerHTML = `
    <div class="between" style="margin-bottom:4px">
      <div class="eyebrow">เงินสดค้างส่งหัวหน้า</div>
      <span class="sub">ค้าง ${p.dates.length} วัน</span>
    </div>
    <div class="bigtime">${baht(p.amount)} <span class="sub" style="font-size:13px;font-weight:400">บาท</span></div>
    ${myAdv.length ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line-2);display:flex;flex-direction:column;gap:4px">
      ${advLines}
      <p class="sub" style="margin-top:2px">เงินก้อนนี้ได้รับไปแล้วจริง จึงหักจากเงินเดือนได้เลย — คนละก้อนกับเงินสดที่ต้องส่งด้านบน</p>
    </div>` : ''}
    ${round ? `
      <p class="sub" style="margin:8px 0 10px">วันนี้หัวหน้ามาส่งของ (${esc(round.name)}) — ส่งเงินสดสะสมให้ด้วย</p>
      <div class="row" style="gap:8px">
        <button class="btn primary" data-remit="cash" style="flex:1" ${p.amount <= 0 ? 'disabled' : ''}>ส่งเงินสดแล้ว</button>
        <button class="btn" data-remit="transfer" style="flex:1" ${p.amount <= 0 ? 'disabled' : ''}>โอนเงินแทน</button>
      </div>
      <button class="btn" id="loanRemitToggleBtn" style="width:100%;margin-top:8px" ${p.amount <= 0 ? 'disabled' : ''}>${S.loanRemitOpen ? 'ยกเลิก' : 'กู้เงิน/เบิกเงินแทน (หักเงินเดือน)'}</button>
      ${S.loanRemitOpen ? (() => {
        const onAdvDay = calc.isAdvanceDay(TODAY, cfg.advanceDay);
        const room = Math.min(p.amount, calc.roomFor(myAdv, TODAY, onAdvDay, cfg));
        return `<div style="margin-top:8px">
          <label class="sub" style="display:block;margin-bottom:4px">จำนวนที่จะกู้/เบิกแทนการส่งเงินสด (ไม่เกิน ${baht(room)} บาท)</label>
          <input id="loanRemitAmt" inputmode="numeric" value="${S.loanRemitAmt}" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--line-2);border-radius:8px;background:var(--surface);font-size:15px">
          <p class="sub" id="loanRemitPreview" style="margin:6px 0 0;color:var(--brand)">${esc(loanRemitPreviewText(ctx, cfg, p.amount, myAdv))}</p>
          <button class="btn primary" id="loanRemitConfirmBtn" style="width:100%;margin-top:8px">ยืนยัน</button>
        </div>`;
      })() : ''}
    ` : `<p class="sub" style="margin-top:8px">หัวหน้าจะมารับตามรอบส่งของถัดไป${nextRoundText(ctx)}</p>`}
  `;
  wireRemitButtons(el, ctx, p, myAdv);
}

// รอบส่งของถัดไปคือวันไหน — พนักงานจะได้รู้ว่าต้องเตรียมเงินสดไว้ให้หัวหน้าวันไหน
function nextRoundText(ctx) {
  if (!ctx.rounds.length) return '';
  const d = futureDates(TODAY, 14).find(x => isRoundOn(ctx.rounds, x));
  if (!d) return '';
  const r = isRoundOn(ctx.rounds, d);
  return ` — ${fmtDate(d)} (${r.name})`;
}

function wireRemitButtons(el, ctx, p, myAdv) {
  el.querySelectorAll('[data-remit]').forEach(btn => btn.addEventListener('click', () => doRemit(btn.dataset.remit, p)));
  const t = $('#loanRemitToggleBtn'); if (t) t.addEventListener('click', () => { S.loanRemitOpen = !S.loanRemitOpen; loadRemitCard(ctx); });
  const c = $('#loanRemitConfirmBtn'); if (c) c.addEventListener('click', () => doRemitAsLoan(ctx, p, myAdv));
  const inp = $('#loanRemitAmt'); if (inp) inp.addEventListener('input', () => {
    S.loanRemitAmt = numIn(inp.value);
    const prev = $('#loanRemitPreview');
    if (prev) prev.textContent = loanRemitPreviewText(ctx, getSettings(), p.amount, myAdv);
  });
}

async function doRemit(method, p) {
  if (p.amount <= 0) { toast('ไม่มีเงินสดค้างส่ง'); return; }
  const { error } = await supabase.from('cash_remittances').insert({ branch_id: BRANCH.id, remit_date: TODAY, amount: p.amount, method });
  if (error) { toast('บันทึกไม่สำเร็จ: ' + error.message); return; }
  await supabase.from('remit_loan_offsets').upsert({ branch_id: BRANCH.id, amount: 0 }, { onConflict: 'branch_id' });
  toast((method === 'cash' ? 'บันทึกว่าส่งเงินสดแล้ว ' : 'บันทึกว่าโอนเงินแล้ว ') + baht(p.amount) + ' บาท');
  await draw($('#roleRoot'));
}

async function doRemitAsLoan(ctx, p, myAdv) {
  if (p.amount <= 0) { toast('ไม่มีเงินสดค้างส่ง'); return; }
  const cfg = getSettings();
  const onAdvDay = calc.isAdvanceDay(TODAY, cfg.advanceDay);
  const max = Math.min(p.amount, calc.roomFor(myAdv, TODAY, onAdvDay, cfg));
  if (max <= 0) { toast('มีเงินกู้ค้างหักคืนครบวงเงินแล้ว — ต้องส่งเงินสดตามปกติ'); return; }
  let amt = Math.round(N(S.loanRemitAmt === '' ? max : S.loanRemitAmt));
  if (amt <= 0) { toast('กรอกจำนวนเงินให้ถูกต้อง'); return; }
  if (amt > max) amt = max;
  const { error } = await insertAdvance(amt, onAdvDay, cfg, 'remit');
  if (error) { toast('บันทึกไม่สำเร็จ: ' + error.message); return; }
  const full = amt >= p.amount;
  if (full) {
    await supabase.from('cash_remittances').insert({ branch_id: BRANCH.id, remit_date: TODAY, amount: p.amount, method: 'loan' });
    await supabase.from('remit_loan_offsets').upsert({ branch_id: BRANCH.id, amount: 0 }, { onConflict: 'branch_id' });
  } else {
    // เก็บไว้บางส่วน — บวกสะสมทับของเดิม (เดิมโค้ดล้างเป็น 0 ก่อนแล้วค่อยบวก ทำให้ยอดที่เคยเก็บไว้ก่อนหน้าหายไป
    // พนักงานจะกลายเป็นค้างส่งเงินสดเกินจริง) ต้นแบบใช้ remitLoanOffset[b.id] = (เดิม||0) + amt
    await supabase.from('remit_loan_offsets').upsert(
      { branch_id: BRANCH.id, amount: N(ctx.remitOffset) + amt }, { onConflict: 'branch_id' });
  }
  S.loanRemitOpen = false; S.loanRemitAmt = '';
  toast('เก็บเงินสด ' + baht(amt) + ' บาทไว้เป็น' + (onAdvDay ? 'เงินเบิก' : 'เงินกู้') + 'ของคุณแล้ว' +
    (full ? '' : ` (เหลือค้างส่งอีก ${baht(p.amount - amt)} บาท)`));
  await draw($('#roleRoot'));
}

// บันทึกเงินเบิก/เงินกู้ 1 รายการ — ใช้ร่วมกันทั้งตอนขอเบิกเองและตอนขอเก็บเงินสดไว้แทนการส่ง
function insertAdvance(amt, onAdvDay, cfg, source) {
  const interest = onAdvDay ? 0 : Math.round(amt * cfg.loanInterestPct);
  return supabase.from('advances').insert({
    branch_id: BRANCH.id, staff_name: ME.name, request_date: TODAY,
    amount: amt, type: onAdvDay ? 'advance' : 'loan', interest, total: amt + interest,
    due_date: calc.nextSettleDate(TODAY, cfg.settleDays), source,
  });
}

/* ============================== แท็บปิดยอดวันนี้ ============================== */
function closeTab(ctx) {
  const { clock, prev, today } = ctx;
  if (today && today.sent) {
    return `<div class="locked"><h3>ส่งยอดวันนี้เรียบร้อย</h3>
      <p class="sub" style="margin:8px 0 0">ข้อมูลถูกล็อกไว้แล้ว แก้ไขไม่ได้<br>ถ้าตัวเลขผิด แจ้งเจ้าของให้แก้ให้</p></div>`;
  }
  const openSet = clock && clock.open_yen != null && clock.open_pan != null;
  if (!clock || !clock.time_in) return `<div class="card pad"><p class="sub">ลงเวลาเข้างานก่อน (แท็บหน้าแรก) ถึงจะเริ่มนับแก้ว/ปิดยอดได้</p></div>`;
  if (!openSet) return `<div class="card pad"><p class="sub">นับแก้วก่อนเริ่มขายให้เสร็จก่อน (แท็บหน้าแรก) ถึงจะปิดยอดได้</p></div>`;
  return renderCloseForm({ clock, prev });
}

function renderCloseForm({ clock, prev }) {
  const d = S.draft || (S.draft = defaultDraft(prev, BRANCH, STOCK_ITEMS));
  return `<div class="stack">
      ${closeFormHTML({ draft: d, errors: S.errors, prev, cfg: getSettings(), attr: 'f', stockItems: STOCK_ITEMS })}
      <button class="btn primary big" id="sendBtn">ส่งยอด</button>
      <p class="sub" style="text-align:center;margin:0">ส่งแล้วแก้เองไม่ได้ ตรวจให้ครบก่อนกด</p>
    </div>`;
}

/* ============================== แท็บของฉัน (เงินเดือน + เบิกเงิน + ประวัติ) ============================== */
function meTab(ctx) {
  return `<div class="stack" id="meBox"><div class="boot">กำลังคำนวณเงินเดือน…</div></div>`;
}

async function loadMeTab(ctx) {
  const box = $('#meBox'); if (!box) return;
  const cfg = getSettings();
  const dates = monthDates(TODAY);
  const monthStart = dates[0];
  // ประวัติเงินเบิกไม่ใช่ข้อมูลของหน้าแรก จึงอ่านเมื่อเปิดแท็บนี้เท่านั้น
  const advancesPromise = ctx.advancesPromise || (ctx.advancesPromise = supabase.from('advances').select('*')
    .eq('branch_id', BRANCH.id).order('request_date', { ascending: false }).then(({ data }) => data || []));
  const [{ data: records }, { data: clocks }, { data: reliefName }, advances] = await Promise.all([
    supabase.from('daily_records').select('*').eq('branch_id', BRANCH.id).gte('record_date', monthStart).lte('record_date', dates[dates.length - 1]),
    supabase.from('clock_records').select('*').eq('branch_id', BRANCH.id).gte('clock_date', monthStart).lte('clock_date', dates[dates.length - 1]),
    supabase.rpc('relief_name'),   // กันวันที่หัวหน้ามาทำแทนออกจากยอดของสาขา (ดู calc.payrollFor)
    advancesPromise,
  ]);
  ctx.advances = advances;
  const clocksByDate = {}; (clocks || []).forEach(c => { clocksByDate[c.clock_date] = c; });
  const pr = calc.payrollFor({
    branch: { relief_name: reliefName || '', base_salary: N(ME.base_salary), days_off_quota: BRANCH.days_off_quota, holiday_work_days: BRANCH.holiday_work_days || 0 },
    records: records || [], clocksByDate, allDatesInMonth: dates, advancesForStaff: ctx.advances, todayISO: TODAY, cfg,
  });
  const myAdv = ctx.advances.slice(0, 20);
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
        ${pr.deduct ? `<div class="payrow neg"><span>หัก สาย ${pr.late} น. / ปิดไว ${pr.early} น.${pr.noClock ? ` / ลืมลงเวลา ${pr.noClock} ครั้ง` : ''}${pr.excess ? ` / หยุดเกิน ${pr.excess} วัน` : ''}</span><span class="n">−${baht(pr.deduct)}</span></div>` : ''}
        ${pr.advanceDeduct ? `<div class="payrow neg"><span>หักเบิกล่วงหน้า/เงินกู้ค้างอยู่</span><span class="n">−${baht(pr.advanceDeduct)}</span></div>` : ''}
      </div>
      <div class="note" style="margin-top:10px">ผ่อนผันมาสายรวมปิดไวได้ไม่เกิน ${cfg.diligenceRules.lateAllowance} นาที/เดือน เกินแล้วเบี้ยขยันเป็น 0</div>
    </div>

    ${pendingBreakdownCard(pr)}

    <div class="card pad">
      <div class="between" style="margin-bottom:4px">
        <div class="eyebrow">เบิกเงิน</div>
        <button class="mini" id="advToggleBtn">${S.advOpen ? 'ปิด' : '+ ขอเบิกเงิน'}</button>
      </div>
      <p class="sub" style="margin:0 0 10px">รอบเบิกวันที่ ${cfg.advanceDay} เบิกได้ไม่เกิน ${baht(cfg.advanceCap)} บาท ไม่มีดอกเบี้ย · เบิกวันอื่นถือเป็น<b>เงินกู้ ดอก ${(cfg.loanInterestPct * 100).toFixed(0)}% วงเงินไม่เกิน ${baht(cfg.loanCap)} บาท</b></p>
      ${S.advOpen ? `
        <div class="field"><label for="advAmt">จำนวนเงินที่จะเบิก (บาท)</label>
          <input id="advAmt" inputmode="numeric" value="${S.advAmount}"></div>
        <p class="sub" id="advPreview" style="margin:4px 0 12px;color:var(--brand)">${esc(advPreviewText(ctx, cfg, N(S.advAmount)))}</p>
        <button class="btn primary big" id="advSubmitBtn">ยืนยันขอเบิก</button>
      ` : ''}
      ${myAdv.length ? `<div class="advlist" style="margin-top:${S.advOpen ? '14' : '0'}px">${myAdv.map(a => `
        <div class="advrow">
          <div><div class="nm">${a.type === 'advance' ? 'เบิกเงิน' : 'เงินกู้'} ${baht(a.amount)} บาท${a.interest ? ` <span class="sub">+ดอก ${baht(a.interest)}</span>` : ''}</div>
            <div class="sub">${fmtDate(a.request_date)}</div></div>
          <span class="pill ${calc.isSettled(a, TODAY) ? 'ok' : 'warn'}">${calc.isSettled(a, TODAY) ? 'หักคืนแล้ว' : 'รอหักคืน ' + fmtDate(a.due_date)}</span>
        </div>`).join('')}</div>` : ''}
    </div>

    <div class="tablewrap"><table><thead><tr><th>วันที่</th><th>เข้า</th><th>ออก</th><th>แก้ว</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
  `;
  wireMeTab(box, ctx, cfg);
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

// แจงว่าเงินเดือนถูกหักจากอะไรบ้าง — ยอดสุดท้ายตรงกับการ์ดด้านบน (พอร์ตจาก pendingBreakdownCard ในต้นแบบ)
function pendingBreakdownCard(pr) {
  const gross = pr.total + pr.advanceDeduct;
  const ab = pr.advBreak;
  const line = (label, v) => `<div class="payrow${v ? ' neg' : ''}"><span>${label}</span><span class="n">${v ? '−' + baht(v) : '0'}</span></div>`;
  return `<div class="card pad">
    <div class="eyebrow">เงินที่จะได้รับ</div>
    <div class="payrows" style="margin-top:8px">
      <div class="payrow"><span>เงินเดือน</span><span class="n">${baht(gross)}</span></div>
      ${line('หัก เงินกู้', ab.loan)}
      ${line('หัก เงินเบิก', ab.advance)}
      ${line('หักเงินสด นำกลับก่อน', ab.remit)}
      <div class="payrow total"><span>เงินที่จะได้รับ</span><span class="n">${baht(pr.total)}</span></div>
    </div>
    <p class="sub" style="margin-top:8px">แจงว่าหักจากอะไรบ้าง — <b>เงินกู้/เงินเบิก</b> คือที่ขอไว้ผ่านปุ่ม "ขอเบิกเงิน" · <b>เงินสด นำกลับก่อน</b> คือเงินสดค้างส่งที่เลือกเก็บไว้เองแทนการส่งจริง</p>
  </div>`;
}

// ข้อความพรีวิวตอนขอเก็บเงินสดไว้เป็นเงินกู้แทนการส่ง — ต้องเห็นดอกเบี้ย/ยอดหักคืน/ยอดที่ยังค้างส่งก่อนกดยืนยัน
function loanRemitPreviewText(ctx, cfg, pAmount, myAdv) {
  if (pAmount <= 0) return '';
  const onAdvDay = calc.isAdvanceDay(TODAY, cfg.advanceDay);
  const max = Math.min(pAmount, calc.roomFor(myAdv, TODAY, onAdvDay, cfg));
  if (max <= 0) return `กู้เพิ่มไม่ได้ — มีเงินกู้ค้างหักคืนครบวงเงิน ${baht(cfg.loanCap)} บาทแล้ว ต้องส่งเงินสดตามปกติ`;
  const raw = S.loanRemitAmt === '' ? max : N(S.loanRemitAmt);
  const amt = Math.min(Math.max(0, raw), max);
  if (amt <= 0) return `กรอกจำนวนเงินให้ถูกต้อง (ไม่เกิน ${baht(max)} บาท)`;
  const base = advPreviewText(ctx, cfg, amt);
  const remain = pAmount - amt;
  return remain > 0 ? `${base} · เหลือค้างส่งอีก ${baht(remain)} บาท ต้องส่งตามปกติ` : base;
}

function advPreviewText(ctx, cfg, amt) {
  if (!amt || amt <= 0) return '';
  const onAdv = calc.isAdvanceDay(TODAY, cfg.advanceDay);
  const nm = onAdv ? 'เงินเบิก' : 'เงินกู้';
  const cap = onAdv ? cfg.advanceCap : cfg.loanCap;
  const room = calc.roomFor(ctx.advances, TODAY, onAdv, cfg);
  const due = fmtDate(calc.nextSettleDate(TODAY, cfg.settleDays));
  if (amt > room) return room <= 0
    ? `ขอเพิ่มไม่ได้ — มี${nm}ค้างหักคืนครบวงเงิน ${baht(cap)} บาทแล้ว`
    : `เกินวงเงิน — ขอได้อีกไม่เกิน ${baht(room)} บาท`;
  if (onAdv) return `เบิกรอบวันที่ ${cfg.advanceDay} · ไม่มีดอกเบี้ย · หักคืนตอนเงินเดือนออก ${due}`;
  const interest = Math.round(amt * cfg.loanInterestPct);
  return `นอกรอบเบิก — ถือเป็นเงินกู้ ดอก ${(cfg.loanInterestPct * 100).toFixed(0)}% (+${baht(interest)} บาท) รวมหักคืน ${baht(amt + interest)} บาท ในรอบ ${due}`;
}

function wireMeTab(box, ctx, cfg) {
  const t = $('#advToggleBtn'); if (t) t.addEventListener('click', () => { S.advOpen = !S.advOpen; loadMeTab(ctx); });
  const inp = $('#advAmt'); if (inp) inp.addEventListener('input', () => {
    S.advAmount = numIn(inp.value);
    const prev = $('#advPreview'); if (prev) prev.textContent = advPreviewText(ctx, cfg, N(inp.value));
  });
  const sub = $('#advSubmitBtn'); if (sub) sub.addEventListener('click', () => submitAdvance(ctx, cfg));
}

async function submitAdvance(ctx, cfg) {
  const amt = Math.round(N(S.advAmount));
  if (amt < 1) { toast('กรอกจำนวนเงินให้ถูกต้อง'); return; }
  const onAdvDay = calc.isAdvanceDay(TODAY, cfg.advanceDay);
  const room = calc.roomFor(ctx.advances, TODAY, onAdvDay, cfg);
  const cap = onAdvDay ? cfg.advanceCap : cfg.loanCap;
  if (room <= 0) { toast(`มี${onAdvDay ? 'เงินเบิก' : 'เงินกู้'}ค้างหักคืนครบวงเงิน ${baht(cap)} บาทแล้ว`); return; }
  if (amt > room) { toast(`ขอได้อีกไม่เกิน ${baht(room)} บาท`); return; }
  const { error } = await insertAdvance(amt, onAdvDay, cfg, 'request');
  if (error) { toast('ขอเบิกไม่สำเร็จ: ' + error.message); return; }
  toast((onAdvDay ? 'ขอเบิกเงิน ' : 'ขอกู้เงิน ') + baht(amt) + ' บาท เรียบร้อย — หักคืน ' + fmtDate(calc.nextSettleDate(TODAY, cfg.settleDays)));
  S.advAmount = ''; S.advOpen = false;
  await draw($('#roleRoot'));
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

  box.querySelectorAll('input[data-f]').forEach(inp => {
    inp.addEventListener('input', () => { S.draft[inp.dataset.f] = numIn(inp.value); });
  });
  box.querySelectorAll('input[data-stock]').forEach(inp => {
    inp.addEventListener('input', () => { S.draft.stock[inp.dataset.stock] = numIn0(inp.value); });
  });
  const sendBtn = $('#sendBtn'); if (sendBtn) sendBtn.addEventListener('click', () => doSend(ctx));
}

// ลงเวลาเข้า-ออก — ต้องอยู่ในรัศมีร้านจริงถึงจะลงได้ (ตรวจ GPS ทุกครั้ง) · ใช้เวลาไทยเสมอ
// และคิดนาทีสาย/ปิดไวตามเวลาทำงานของสาขาทันทีตอนกด
async function doClock(kind) {
  const btn = $(kind === 'in' ? '#clockInBtn' : '#clockOutBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังตรวจตำแหน่ง…'; }
  const at = await verifyForClock(BRANCH, toast);
  if (!at) { await draw($('#roleRoot')); return; }

  const timeStr = nowHM();
  if (kind === 'in') {
    const late = calc.lateMinutes(timeStr, BRANCH.work_start, BRANCH.late_grace_min);
    const { error } = await supabase.from('clock_records').upsert({
      branch_id: BRANCH.id, clock_date: TODAY, staff_name: ME.name, time_in: timeStr, late_minutes: late,
      in_distance_m: at.distance ?? null,
    }, { onConflict: 'branch_id,clock_date' });
    if (error) { toast('ลงเวลาไม่สำเร็จ: ' + error.message); return; }
    toast(late ? `ลงเวลาเข้างานแล้ว ${timeStr} — สาย ${late} นาที` : 'ลงเวลาเข้างานแล้ว ' + timeStr);
  } else {
    const early = calc.earlyMinutes(timeStr, BRANCH.work_end);
    const { error } = await supabase.from('clock_records')
      .update({ time_out: timeStr, early_minutes: early, out_distance_m: at.distance ?? null })
      .eq('branch_id', BRANCH.id).eq('clock_date', TODAY);
    if (error) { toast('ลงเวลาไม่สำเร็จ: ' + error.message); return; }
    toast(early ? `ลงเวลาออกงานแล้ว ${timeStr} — ปิดก่อนเวลา ${early} นาที` : 'ลงเวลาออกงานแล้ว ' + timeStr);
  }
  await draw($('#roleRoot'));
}

async function doOpenCount(ctx) {
  const yenEl = $('#openYen'), panEl = $('#openPan');
  if (yenEl.value === '' || panEl.value === '') { toast('กรอกแก้วเย็น/ปั่นให้ครบก่อนยืนยัน'); return; }
  const newYen = N(yenEl.value), newPan = N(panEl.value);
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
    await supabase.from('day_offs').delete().eq('off_date', dateISO).eq('branch_id', BRANCH.id);
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
  const { error } = await supabase.from('deliveries').update({ received, received_at: new Date().toISOString() }).eq('id', dlvId);
  if (error) { toast('บันทึกไม่สำเร็จ: ' + error.message); return; }
  S.receivedDraft = null;
  toast('บันทึกวัตถุดิบนำเข้าเรียบร้อย');
  await draw($('#roleRoot'));
}

async function doSend(ctx) {
  const d = S.draft;
  if (!d || !ctx.clock) return;   // กันกดปุ่มรัว ๆ บนมือถือ — คลิกที่สองมาถึงตอนฟอร์มถูกล้างไปแล้ว
  const errs = validateClose(d, ctx.clock);
  if (Object.keys(errs).length) {
    S.errors = errs; await draw($('#roleRoot')); toast('กรอกข้อมูลให้ครบและถูกต้องก่อน');
    const first = document.querySelector('.field input.err'); if (first) first.scrollIntoView({ block: 'center' });
    return;
  }
  const { error } = await submitClose({
    branchId: BRANCH.id, dateISO: TODAY, staffName: ME.name, draft: d, cfg: getSettings(),
    stockItems: STOCK_ITEMS, prevSnapshot: ctx.prev ? ctx.prev.stock_snapshot : {}, createdBy: ME.id,
  });
  if (error) { toast('ส่งยอดไม่สำเร็จ: ' + error.message); return; }
  S.draft = null; S.errors = {}; S.tab = 'home';
  // ไม่บอกผลขาด/เกินให้พนักงานเห็น — ตามกติกาที่ตกลงไว้ว่าเจ้าของตรวจฝ่ายเดียว
  toast('ส่งยอดเรียบร้อย — แจ้งเจ้าของแล้ว');
  await draw($('#roleRoot'));
}
