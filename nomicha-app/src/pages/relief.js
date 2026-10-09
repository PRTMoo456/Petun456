// หน้าหัวหน้า — ตารางไปแทนสาขา + จองวันหยุด, รอบส่งของ + เช็คสต๊อกคลังกลาง, ขายนอกสาขา, ยอดส่งเงิน, ลงเวลา(ไปแทน)
// พอร์ตตรงจาก reliefView()/reliefSched()/reliefPack()/reliefWh()/reliefExt()/reliefCash()/reliefClock() ในต้นแบบ nomicha.html
import { supabase } from '../supabaseClient.js';
import { getSettings } from '../settings.js';
import { $, N, numIn, baht, esc, toast, todayISO, nowHM, fmtDate, monthKey, monthLabel, monthDates, DAYS } from '../util.js';
import { loadRefs } from '../refs.js';
import { quotaReport, dayChip, OFF_LEGEND, quotaHTML, futureDates, LEAVE_MIN_DAYS, LEAVE_MAX_DAYS, LEAVE_WINDOW_TEXT, firstBookable } from '../dayoff.js';
import { getCompanies, reliefSlipHTML, externalBillHTML, printDoc } from '../print.js';
import { defaultDraft, closeFormHTML, validateClose, submitClose, CLOSE_REASON_OPTIONS, closeStore } from '../close.js';
import { verifyForClock } from '../geo.js';
import { whAvailMap, issueExternalSale, recordPurchase, purchaseQtyLabel, purchaseUnits, qtyField } from '../warehouse.js';
import * as calc from '../calc.js';
import { dayLinesHTML, dayRangeText, dayInlineText, remitStatusHTML } from '../cashview.js';

let ME, TODAY, STOCK_ITEMS = [], BRANCHES = [], ROUNDS = [];
let tabLoadTicket = 0;
let S = {
  tab: 'sched', round: 'send', packOpen: {}, sendQty: {}, packEdit: {}, packExtra: [], packDate: null, whDraft: {}, whDraftLoose: {},
  extOpen: false, extBuyer: '', extDraft: {}, extViewing: null,
  reliefDraft: null, reliefErrors: {},
};

export async function renderReliefApp(root, me) {
  ME = me;
  TODAY = todayISO();
  const refs = await loadRefs();
  BRANCHES = refs.branches; STOCK_ITEMS = refs.stockItems; ROUNDS = refs.rounds;
  await draw(root);
}

async function draw(root) {
  const liveToday = todayISO();
  if (TODAY !== liveToday) { TODAY = liveToday; S.reliefDraft = null; S.reliefErrors = {}; }
  root.innerHTML = `<div class="wrap phone" id="reliefRoot"><div class="boot">กำลังโหลด…</div></div>`;
  const box = $('#reliefRoot');
  const tabs = [['sched', 'ตารางงาน'], ['pack', 'รอบส่งของ'], ['ext', 'ขายนอก'], ['cash', 'ยอดส่งเงิน'], ['clock', 'ลงเวลา']];
  box.innerHTML = `<div class="app-head">
      <div><h1>${esc(ME.name)}</h1><div class="sub">หัวหน้า · ไปทำแทน + ส่งของ</div></div>
    </div>
    <div class="owner-tabs" style="margin-bottom:16px">${tabs.map(t =>
      `<button data-rtab="${t[0]}" aria-pressed="${S.tab === t[0]}">${t[1]}</button>`).join('')}</div>
    <div id="reliefBody"><div class="boot">กำลังโหลด…</div></div>`;
  // เปลี่ยนเฉพาะเนื้อหาแท็บ: ไม่ต้องวาดหัวหน้า/ปุ่มนำทางทั้งหน้าใหม่ทุกครั้ง
  box.querySelectorAll('[data-rtab]').forEach(btn => btn.addEventListener('click', () => {
    if (S.tab === btn.dataset.rtab) return;
    S.tab = btn.dataset.rtab;
    box.querySelectorAll('[data-rtab]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === btn)));
    loadTab();
  }));
  await loadTab();
}

async function loadTab() {
  const body = $('#reliefBody'); if (!body) return;
  const ticket=++tabLoadTicket,tab=S.tab;
  if (tab === 'sched') await renderSched(body);
  else if (tab === 'pack') await renderPack(body);
  else if (tab === 'ext') await renderExt(body);
  else if (tab === 'cash') await renderCash(body);
  else await renderClock(body);
  if(ticket!==tabLoadTicket)return loadTab();
}

function isRoundOn(dateISO) {
  const dow = new Date(dateISO + 'T00:00:00').getDay();
  return ROUNDS.find(r => r.day_of_week === dow) || null;
}
function roundDate(r) {
  const t = isRoundOn(TODAY);
  const future = futureDates(TODAY, 31);
  return (t && t.id === r.id) ? TODAY : (future.find(d => new Date(d + 'T00:00:00').getDay() === r.day_of_week) || TODAY);
}

/* ============================== ตารางงาน ============================== */
async function renderSched(body) {
  const future = futureDates(TODAY, 31);
  const win28 = future.slice(0, LEAVE_MAX_DAYS);
  const [{ data: dayOffs }, { data: myOffs }, { data: staffRows }] = await Promise.all([
    supabase.from('day_offs').select('*').gte('off_date', TODAY).lte('off_date', future[future.length - 1]),
    supabase.from('relief_day_offs').select('*').gte('off_date', TODAY).lte('off_date', future[future.length - 1]),
    supabase.from('employees').select('name,branch_id,role').eq('role', 'staff'),
  ]);
  const staffOf = bid => (staffRows || []).find(e => e.branch_id === bid)?.name || '';
  const myOffDates = (myOffs || []).map(x => x.off_date);
  const coverDays = [TODAY, ...future].filter(d => (dayOffs || []).some(x => x.off_date === d));
  const coverRows = coverDays.map(d => {
    const off = dayOffs.find(x => x.off_date === d);
    const b = BRANCHES.find(x => x.id === off.branch_id);
    return `<tr><td class="n">${fmtDate(d)} <span class="sub">${DAYS[new Date(d + 'T00:00:00').getDay()]}</span></td>
      <td><b>สาขา${esc(b ? b.name : off.branch_id)}</b>${staffOf(off.branch_id) ? ` <span class="sub">(${esc(staffOf(off.branch_id))} หยุด)</span>` : ''}${d === TODAY ? ' <span class="pill warn">วันนี้</span>' : ''}
      ${d === TODAY ? `<div style="margin-top:7px"><select class="ctl" data-relief-close-reason="${off.branch_id}">${CLOSE_REASON_OPTIONS.map(r => `<option value="${r.value}" ${r.value === 'approved_leave' ? 'selected' : ''}>${esc(r.label)} — หัก ${r.quota} วัน</option>`).join('')}</select>
        <button class="mini" data-relief-close="${off.branch_id}">ปิดร้านวันนี้</button></div>` : ''}</td></tr>`;
  }).join('');

  const rReport = quotaReport(myOffDates, win28, ME.days_off_quota ?? 2);
  const rMonthFull = new Map(rReport.map(r => [r.label, r.used >= (ME.days_off_quota ?? 2)]));
  const offChips = win28.map(d => {
    const mine = myOffDates.includes(d);
    const round = !!isRoundOn(d);
    const covering = (dayOffs || []).some(x => x.off_date === d);
    const tooSoon = d < firstBookable(win28);
    const blocked = round || covering || (tooSoon && !mine);
    const full = rMonthFull.get(monthLabel(d)) || false;
    const newMonth = d === win28.find(x => monthKey(x) === monthKey(d));
    const cls = round ? 'round' : mine ? 'mine' : tooSoon ? 'too-soon' : blocked ? 'round' : full ? 'full' : 'free';
    const title = round ? 'วันส่งของ — ห้ามหยุด' : covering ? 'ต้องไปทำแทนสาขาที่จองไว้' : tooSoon && !mine ? `ต้องจองล่วงหน้าอย่างน้อย ${LEAVE_MIN_DAYS} วัน` : full && !mine ? `ครบโควตาของเดือน ${monthLabel(d)} แล้ว` : '';
    const tag = round ? '<span class="dt">ส่งของ</span>' : covering ? '<span class="dt">ไปแทน</span>' : mine ? '<span class="dt">หยุด</span>' : tooSoon ? '<span class="dt">จองไม่ทัน</span>' : cls === 'free' ? '<span class="dt ok">ว่าง</span>' : '';
    return dayChip(d, 'roff', cls, blocked || (full && !mine), title, tag, newMonth);
  }).join('');

  body.innerHTML = `<div class="stack">
    <div class="card pad">
      <div class="between" style="margin-bottom:4px"><div class="eyebrow">ตารางไปทำแทนสาขา</div><span class="sub">1 เดือนข้างหน้า</span></div>
      <p class="sub" style="margin:0 0 10px">วันที่พนักงานสาขาจองหยุดไว้ = วันที่คุณต้องไปเปิดร้านแทน</p>
      <div class="tablewrap"><table><thead><tr><th>วันที่</th><th>ไปแทนสาขา</th></tr></thead>
        <tbody>${coverRows || '<tr><td colspan="2" class="sub">ยังไม่มีสาขาไหนจองหยุดใน 1 เดือนข้างหน้า</td></tr>'}</tbody></table></div>
    </div>
    <div class="card pad">
      <div class="eyebrow" style="margin-bottom:4px">จองวันหยุดของคุณ</div>
      <p class="sub" style="margin:0 0 10px">ต้องจองล่วงหน้าอย่างน้อย ${LEAVE_MIN_DAYS} วัน และเลือกได้ถึง ${LEAVE_MAX_DAYS} วันข้างหน้า · แตะวันที่ขึ้น <b style="color:var(--brand)">ว่าง</b> เพื่อจอง</p>
      <div class="daygrid">${offChips}</div>
      ${OFF_LEGEND}
      ${quotaHTML(rReport, ME.days_off_quota ?? 2)}
    </div>
  </div>`;
  body.querySelectorAll('.daychip[data-roff]').forEach(chip => chip.addEventListener('click', () => toggleReliefOff(chip.dataset.roff, dayOffs || [])));
  body.querySelectorAll('[data-relief-close]').forEach(btn => btn.addEventListener('click', async () => {
    const branchId = btn.dataset.reliefClose;
    const reason = body.querySelector(`[data-relief-close-reason="${branchId}"]`).value;
    const result = await closeStore({ branchId, dateISO: TODAY, reason });
    if (result.error) { toast('บันทึกปิดร้านไม่สำเร็จ: ' + result.error); return; }
    toast(`บันทึกปิดร้านแล้ว — หักโควตาวันหยุด ${result.reason.quota} วัน`);
    renderSched(body);
  }));
}

async function toggleReliefOff(dateISO, dayOffs) {
  const { data: cur } = await supabase.from('relief_day_offs').select('*').eq('off_date', dateISO).maybeSingle();
  if (cur) { await supabase.from('relief_day_offs').delete().eq('off_date', dateISO); toast('ยกเลิกวันหยุด ' + fmtDate(dateISO)); await draw($('#roleRoot')); return; }
  const bookingDates = futureDates(TODAY, LEAVE_MAX_DAYS);
  if (dateISO < firstBookable(bookingDates) || dateISO > bookingDates[bookingDates.length - 1]) {
    toast(LEAVE_WINDOW_TEXT); return;
  }
  const rd2 = isRoundOn(dateISO);
  if (rd2) { toast(`วันส่งของ (${rd2.name}) ห้ามหยุด`); return; }
  const covering = dayOffs.some(x => x.off_date === dateISO);
  if (covering) { toast('วันนี้ต้องไปทำแทนสาขาที่จองไว้แล้ว'); return; }
  const future = futureDates(TODAY, LEAVE_MAX_DAYS);
  const { data: myOffs } = await supabase.from('relief_day_offs').select('*').gte('off_date', future[0]).lte('off_date', future[future.length - 1]);
  const used = (myOffs || []).filter(x => monthKey(x.off_date) === monthKey(dateISO)).length;
  if (used >= (ME.days_off_quota ?? 2)) { toast(`จองครบ ${ME.days_off_quota ?? 2} วันของเดือน ${monthLabel(dateISO)} แล้ว`); return; }
  const { error } = await supabase.from('relief_day_offs').insert({ off_date: dateISO });
  if (error) { toast('จองไม่สำเร็จ: ' + error.message); return; }
  toast('แจ้งวันหยุด ' + fmtDate(dateISO));
  await draw($('#roleRoot'));
}

/* ============================== รอบส่งของ + เช็คสต๊อกคลังกลาง ============================== */
async function pickListFor(bid) {
  const [{ data: par }, { data: lastRec }] = await Promise.all([
    supabase.from('stock_par_levels').select('*').eq('branch_id', bid),
    supabase.from('daily_records').select('stock_snapshot').eq('branch_id', bid).order('record_date', { ascending: false }).limit(1),
  ]);
  const parByItemId = {}; (par || []).forEach(p => { parByItemId[p.item_id] = p.par_qty; });
  const snapshot = (lastRec && lastRec[0]) ? lastRec[0].stock_snapshot : null;
  return calc.pickList(STOCK_ITEMS, parByItemId, snapshot);
}

/* รอบส่งของ (เจ้าของสั่ง 2 ต.ค. 69): ไม่ต้องเลือกรอบจันทร์/ศุกร์ — โชว์ "วันส่งถัดไป" กับสาขาที่ต้องส่งเลย
   ทุกรายการมีช่อง "ส่งจริง" ข้าง "ต้องจัด" ใส่ตัวเลขให้อัตโนมัติ (ไม่เกินของที่มีในคลัง) แก้ได้ตามที่หยิบจริง
   ยืนยันทีละสาขา · ลืมสาขาไหนเพิ่มทีหลังได้ · สาขานอกรอบก็เลือกส่งเพิ่มได้ */
function nextRound() {
  const cands = ROUNDS.map(r => ({ r, date: roundDate(r) })).sort((a, b) => a.date < b.date ? -1 : 1);
  return cands[0] || null;
}
async function renderPack(body) {
  const urgent = S.round === 'urgent';
  const selector = `<span class="seg2" style="align-self:flex-start">
    <button data-round="send" aria-pressed="${S.round !== 'wh' && !urgent}">ส่งของรอบ</button>
    <button data-round="urgent" aria-pressed="${urgent}">ส่งด่วนวันนี้</button>
    <button data-round="wh" aria-pressed="${S.round === 'wh'}">เช็คสต๊อก</button></span>`;
  if (S.round === 'wh') {
    body.innerHTML = `<div class="stack">${selector}<div id="whBox"><div class="boot">กำลังโหลด…</div></div></div>`;
    wireRoundSelector(body);
    return renderWh($('#whBox'));
  }
  /* ส่งด่วนวันนี้ (เจ้าของแจ้ง 9 ต.ค. 69): เอาของที่ขาดไปส่งสาขาวันที่ไม่ใช่วันรอบ ต้องบันทึกเป็น "วันนี้" แยกจากรอบ
     เดิมกด "ส่งเพิ่มสาขานอกรอบ" ในวันที่ไม่ใช่วันรอบ ระบบไปบันทึกเป็นรอบถัดไป → พอถึงวันรอบจริง สาขานั้นขึ้น "ส่งแล้ว" ส่งรอบจริงไม่ได้ */
  const nr = urgent ? null : nextRound();
  if (!urgent && !nr) { body.innerHTML = selector + '<p class="sub">ยังไม่ได้ตั้งรอบส่งของ</p>'; return; }
  const r = urgent ? null : nr.r;
  const packDate = urgent ? TODAY : nr.date;
  const roundId = r ? r.id : null;
  const packKey = packDate + '|' + (roundId || 'urgent');
  if (S.packKey !== packKey) { S.packKey = packKey; S.packDate = packDate; S.sendQty = {}; S.packEdit = {}; S.packExtra = []; }
  const inRound = id => !!r && r.branch_ids.includes(id);
  const [{ data: existingAll }, avail0] = await Promise.all([
    supabase.from('deliveries').select('*').eq('delivery_date', packDate),
    whAvailMap(STOCK_ITEMS),
  ]);
  const existing = (existingAll || []).filter(d => (d.round_id || null) === roundId);
  const baseIds = r ? r.branch_ids : existing.map(d => d.branch_id);
  const shownIds = [...new Set([...baseIds, ...(S.packExtra || [])])];
  const lists = await Promise.all(shownIds.map(async bid => ({ b: BRANCHES.find(x => x.id === bid) || { id: bid, name: bid }, items: await pickListFor(bid) })));
  const doneById = {}; existing.forEach(d => { doneById[d.branch_id] = d; });

  // แบ่งของในคลังให้สาขาที่ยังไม่ยืนยัน ตามลำดับ — ขาดเมื่อไรใส่เท่าที่มี
  const left = { ...avail0 };
  const perBranch = lists.map(x => {
    const done = doneById[x.b.id];
    const editing = !!(done && S.packEdit[x.b.id]);
    const rows = x.items.map(i => ({ ...i }));
    (S.packAdded?.[x.b.id] || []).forEach(id => { if (!rows.some(r2 => String(r2.it.id) === String(id))) { const it = STOCK_ITEMS.find(s2 => String(s2.id) === String(id)); if (it) rows.push({ it, need: 0, have: null, par: null, added: true }); } });
    if (done) Object.keys(done.items || {}).forEach(id => { if (!rows.some(r2 => String(r2.it.id) === id)) { const it = STOCK_ITEMS.find(s2 => String(s2.id) === id); if (it) rows.push({ it, need: 0, have: null, par: null }); } });
    rows.forEach(i => {
      const sentBefore = done ? N(done.items?.[i.it.id]) : 0;
      const canUse = (left[i.it.id] || 0) + (editing ? sentBefore : 0);
      i.auto = done ? sentBefore : Math.min(i.need, Math.max(0, left[i.it.id] || 0));
      if (!done) left[i.it.id] = (left[i.it.id] || 0) - i.auto;
      i.max = done ? canUse : (left[i.it.id] || 0) + i.auto;
      const typed = S.sendQty[x.b.id]?.[i.it.id];
      i.send = typed != null && typed !== '' ? typed : String(i.auto);
      i.short = Math.max(0, i.need - (Number(i.send) || 0));
    });
    return { ...x, rows, done, editing };
  });

  const card = x => {
    const open = S.packOpen[x.b.id] ?? !x.done;
    const locked = x.done && !x.editing;
    const shortN = x.rows.filter(i => i.short > 0).length;
    const pill = x.done ? '<span class="pill ok">ส่งแล้ว</span>'
      : !x.rows.length ? '<span class="pill ok">ไม่ต้องเติม</span>'
      : `<span class="pill warn">${x.rows.length} รายการ${shortN ? ` · ขาด ${shortN}` : ''}</span>`;
    const rowHTML = i => `<div class="stockrow">
        <div><div class="nm">${esc(i.it.name)}${i.short > 0 && !locked ? ` <span class="pill bad" style="margin-left:4px">ขาด ${i.short}</span>` : ''}</div>
          <div class="un">${esc(i.it.unit)}${i.have != null ? ` · สาขาเหลือ ${i.have} ต้องมี ${i.par}` : ''} · คลังมี ${i.max}</div></div>
        <div class="whinputs">
          <label class="whlbl">ต้องจัด<span class="num" style="font-size:15px;font-weight:600;color:var(--ink);padding:6px 0">${i.need || '–'}</span></label>
          <label class="whlbl">ส่งจริง${locked ? `<span class="num" style="font-size:15px;font-weight:700;color:var(--brand);padding:6px 0">${i.send}</span>`
            : `<input inputmode="numeric" data-sendq="${x.b.id}|${i.it.id}" value="${esc(i.send)}">`}</label>
        </div></div>`;
    return `<div class="card pad">
      <button class="accbtn" data-packacc="${x.b.id}" aria-expanded="${open}">
        <span class="branchname">สาขา${esc(x.b.name)}${urgent || inRound(x.b.id) ? '' : ' <span class="sub">(นอกรอบ)</span>'}</span>
        <span style="display:flex;align-items:center;gap:8px">${pill}<span class="chev">›</span></span>
      </button>
      ${open ? `<div class="accbody">
        ${x.rows.length ? x.rows.map(rowHTML).join('') : '<p class="sub" style="margin:0">ไม่ต้องเติมอะไร</p>'}
        ${locked ? '' : addItemHTML(x)}
        ${locked ? `<button class="btn" style="margin-top:10px" data-packedit="${x.b.id}">แก้จำนวนที่ส่ง</button>`
          : x.rows.length ? `<button class="btn primary" style="margin-top:10px" data-packgo="${x.b.id}">${x.done ? 'บันทึกจำนวนใหม่' : `ยืนยันส่งสาขา${esc(x.b.name)}`}</button>` : ''}
      </div>` : ''}
    </div>`;
  };
  const notShown = BRANCHES.filter(b2 => !shownIds.includes(b2.id));
  const pending = perBranch.filter(x => !x.done && x.rows.length);
  body.innerHTML = `<div class="stack">
    ${selector}
    <div class="card pad" style="border-left:3px solid ${pending.length ? 'var(--amber)' : 'var(--brand)'}">
      <div class="eyebrow">${urgent ? 'ส่งด่วนวันนี้ (ไม่นับเป็นรอบ)' : packDate === TODAY ? 'ส่งของวันนี้' : 'เตรียมรอบถัดไป'}</div>
      <div class="bigtime" style="font-size:26px;margin:4px 0">${DAYS[new Date(packDate + 'T00:00:00').getDay()]} ${fmtDate(packDate)}</div>
      <div class="sub">${shownIds.length ? shownIds.map(id => { const b2 = BRANCHES.find(z => z.id === id); return `${doneById[id] ? '✓ ' : ''}${esc(b2 ? b2.name : id)}`; }).join(' · ')
        : 'เลือกสาขาที่จะเอาของไปส่งด้านล่าง'}</div>
      ${!urgent && packDate !== TODAY ? '<p class="sub" style="margin:6px 0 0">หน้านี้คือของที่จะส่งในวันรอบ — ถ้าจะเอาของที่ขาดไปส่ง<b>วันนี้</b> ให้กด "ส่งด่วนวันนี้" ด้านบน</p>' : ''}
    </div>
    ${perBranch.map(card).join('')}
    ${pending.length > 1 ? `<button class="btn primary big" id="packAllBtn">ยืนยันส่งทุกสาขาที่ยังไม่ส่ง (${pending.length})</button>` : ''}
    ${notShown.length ? `<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><span class="sub">ส่งเพิ่มสาขานอกรอบ:</span>
      ${notShown.map(b2 => `<button class="mini" data-packextra="${b2.id}">+ ${esc(b2.name)}</button>`).join('')}</div>` : ''}
    <p class="foot">"ส่งจริง" ใส่ให้อัตโนมัติจากของที่ต้องจัด (ไม่เกินของที่มีในคลังกลาง) — แก้ได้ตามที่หยิบใส่รถจริง · ส่วนที่ขาดจะขึ้นในใบจัดของครั้งถัดไปเอง · ยืนยันแล้วตัดสต๊อกคลังกลางตามจำนวนส่งจริง</p>
  </div>`;
  wireRoundSelector(body);
  body.querySelectorAll('[data-packacc]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.packacc; const x = perBranch.find(y => y.b.id === id);
    S.packOpen[id] = !(S.packOpen[id] ?? !x?.done); renderPack(body);
  }));
  body.querySelectorAll('[data-sendq]').forEach(inp => inp.addEventListener('input', () => {
    const [bid, iid] = inp.dataset.sendq.split('|'); (S.sendQty[bid] = S.sendQty[bid] || {})[iid] = inp.value;
  }));
  body.querySelectorAll('[data-packedit]').forEach(btn => btn.addEventListener('click', () => { S.packEdit[btn.dataset.packedit] = true; S.packOpen[btn.dataset.packedit] = true; renderPack(body); }));
  body.querySelectorAll('[data-packextra]').forEach(btn => btn.addEventListener('click', () => { S.packExtra = [...(S.packExtra || []), btn.dataset.packextra]; S.packOpen[btn.dataset.packextra] = true; renderPack(body); }));
  body.querySelectorAll('[data-additem]').forEach(sel => sel.addEventListener('change', () => {
    const bid = sel.dataset.additem; if (!sel.value) return;
    (S.sendQty[bid] = S.sendQty[bid] || {})[sel.value] = S.sendQty[bid][sel.value] ?? '1';
    (S.packAdded = S.packAdded || {})[bid] = [...new Set([...(S.packAdded[bid] || []), sel.value])];
    renderPack(body);
  }));
  body.querySelectorAll('[data-packgo]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const ok = await confirmBranch(perBranch.find(y => y.b.id === btn.dataset.packgo), roundId, packDate);
    if (!ok) { btn.disabled = false; return; }
    renderPack(body);
  }));
  const all = $('#packAllBtn'); if (all) all.addEventListener('click', async () => {
    all.disabled = true; all.textContent = 'กำลังบันทึก…';
    for (const x of pending) { if (!(await confirmBranch(x, roundId, packDate))) break; }
    renderPack(body);
  });
}

// เพิ่มรายการที่ไม่อยู่ในใบจัดของ (เช่น ของที่สาขาขาดกะทันหัน) — เลือกจากรายการวัตถุดิบทั้งหมด
function addItemHTML(x) {
  const have = new Set(x.rows.map(i => String(i.it.id)));
  const opts = STOCK_ITEMS.filter(it => !have.has(String(it.id)));
  if (!opts.length) return '';
  return `<label class="whlbl" style="margin-top:10px;display:block">เพิ่มรายการอื่น
    <select data-additem="${x.b.id}" style="width:100%;margin-top:4px"><option value="">— เลือกวัตถุดิบ —</option>
    ${opts.map(it => `<option value="${it.id}">${esc(it.name)} (${esc(it.unit)})</option>`).join('')}</select></label>`;
}

// อ่านช่อง "ส่งจริง" ของสาขาหนึ่ง → ตรวจ → บันทึก (ตัดสต๊อกคลังตามจำนวนส่งจริง)
async function confirmBranch(x, roundId, packDate) {
  const items = {};
  for (const i of x.rows) {
    const raw = S.sendQty[x.b.id]?.[i.it.id];
    const v = raw == null || raw === '' ? Number(i.send) : numIn(raw);
    if (v === '' || !Number.isInteger(v) || v < 0) { toast(`${i.it.name}: ส่งจริงต้องเป็นจำนวนเต็มตั้งแต่ 0`); return false; }
    if (v > i.max) { toast(`${i.it.name}: คลังกลางมีแค่ ${i.max} ${i.it.unit}`); return false; }
    if (v > 0) items[i.it.id] = v;
  }
  const { error } = await supabase.rpc('confirm_delivery', { p_delivery_date: packDate, p_branch_id: x.b.id, p_round_id: roundId, p_items: items });
  if (error) { toast('ส่งของไม่สำเร็จ: ' + error.message); return false; }
  delete S.sendQty[x.b.id]; delete S.packEdit[x.b.id]; if (S.packAdded) delete S.packAdded[x.b.id]; S.packOpen[x.b.id] = false;
  toast(`บันทึกส่งของสาขา${x.b.name}แล้ว — ตัดสต๊อกคลังตามจำนวนส่งจริง`);
  return true;
}

function wireRoundSelector(body) {
  body.querySelectorAll('[data-round]').forEach(btn => btn.addEventListener('click', () => { S.round = btn.dataset.round; S.packAdded = {}; loadTab(); }));
}

async function renderWh(el) {
  if (!el) return;
  const { data: stock } = await supabase.from('warehouse_stock').select('*');
  const stockById = {}; (stock || []).forEach(s => { stockById[s.item_id] = s; });
  const low = STOCK_ITEMS.filter(it => calc.whLow(it, stockById[it.id])).length;
  const lastChecked = (stock || []).reduce((m, s) => (!m || (s.last_checked && s.last_checked > m)) ? s.last_checked : m, null);
  const rows = STOCK_ITEMS.map(it => {
    const cur = stockById[it.id]?.case_qty, curL = stockById[it.id]?.loose_qty;
    const val = S.whDraft[it.id] != null ? S.whDraft[it.id] : (cur ?? '');
    const valL = S.whDraftLoose[it.id] != null ? S.whDraftLoose[it.id] : (curL ?? '');
    const isLow = calc.whLow(it, stockById[it.id]);
    const curTxt = cur != null ? `มีอยู่ ${cur} ลัง${curL ? ` + ${curL} ชิ้นเศษ` : ''}` : 'ยังไม่เคยนับ';
    return `<div class="stockrow whrow"><div><div class="nm">${esc(it.name)} ${isLow ? '<span class="pill bad" style="margin-left:4px">ใกล้หมด</span>' : ''}</div>
        <div class="un">${curTxt}</div></div>
      <div class="whinputs">
        <label class="whlbl">ลังเต็ม<input inputmode="numeric" data-whcount="${it.id}" value="${val}" placeholder="0"></label>
        <label class="whlbl">ชิ้นเศษ<input inputmode="numeric" data-whloose="${it.id}" value="${valL}" placeholder="0"></label>
      </div></div>`;
  }).join('');

  el.innerHTML = `
    <div class="card pad" style="border-left:3px solid ${low ? 'var(--bad)' : 'var(--amber)'}">
      <div class="eyebrow">เช็คสต๊อกคลังกลาง</div>
      <div class="bigtime" style="font-size:22px;margin:4px 0">${lastChecked ? `เช็คล่าสุด ${fmtDate(lastChecked)}` : 'ยังไม่เคยเช็ค'}</div>
      <p class="sub" style="margin-top:4px">${low ? `${low} รายการเหลือน้อย — บอกเจ้าของให้สั่งเพิ่ม` : 'ยังไม่มีรายการที่ต้องสั่งด่วน'}</p>
    </div>
    <div class="card pad">
      <p class="sub" style="margin:0 0 10px">นับของที่เหลืออยู่จริงในคลังกลางตอนนี้ แยกเป็น <b>ลังเต็ม</b> กับ <b>ชิ้นเศษนอกลัง</b> — ตัวไหนไม่กรอกจะคงจำนวนที่เช็คไว้ล่าสุด</p>
      ${rows}
    </div>
    <button class="btn primary big" id="whSaveBtn">บันทึกจำนวนที่นับได้</button>
    <div class="card pad" id="purchCard">${renderPurchCard()}</div>
    <p class="foot">"ใกล้หมด" = ต่ำกว่าขั้นต่ำที่เจ้าของตั้งไว้ (ไม่ได้ตั้ง = ลังเต็มเหลือ 0) — เจ้าของเห็นรายการเดียวกันในหน้าเจ้าของ → สต๊อก → คลังกลาง</p>
  `;
  el.querySelectorAll('input[data-whcount]').forEach(inp => inp.addEventListener('input', () => { S.whDraft[inp.dataset.whcount] = inp.value; }));
  el.querySelectorAll('input[data-whloose]').forEach(inp => inp.addEventListener('input', () => { S.whDraftLoose[inp.dataset.whloose] = inp.value; }));
  $('#whSaveBtn').addEventListener('click', () => saveWhStock(stockById));
  wirePurchCard();
}

async function saveWhStock(stockById) {
  for (const it of STOCK_ITEMS) {
    const values = [S.whDraft[it.id], S.whDraftLoose[it.id]];
    // numIn ตัดคอมม่าออก และคืน '' ถ้าพิมพ์ไม่ใช่ตัวเลข (เช่น "1o") — เดิมใช้ N() ซึ่งแปลงเป็น 0 เงียบ ๆ แล้วบันทึกทับสต๊อกจริงเป็น 0
    if (values.some(raw => raw != null && raw !== '' && (numIn(raw) === '' || numIn(raw) < 0 || !Number.isInteger(numIn(raw))))) {
      toast(`${it.name}: จำนวนลังและชิ้นเศษต้องเป็นจำนวนเต็มตั้งแต่ 0`); return;
    }
  }
  const counts = [];
  let updated = 0;
  STOCK_ITEMS.forEach(it => {
    const v = S.whDraft[it.id], vl = S.whDraftLoose[it.id];
    if ((v == null || v === '') && (vl == null || vl === '')) return;
    const row = {
      item_id: it.id,
      case_qty: (v != null && v !== '') ? numIn(v) : (stockById[it.id]?.case_qty ?? 0),
      loose_qty: (vl != null && vl !== '') ? numIn(vl) : (stockById[it.id]?.loose_qty ?? 0),
    };
    if (row.case_qty < 0 || row.loose_qty < 0 || !Number.isInteger(row.case_qty) || !Number.isInteger(row.loose_qty)) return;
    counts.push(row);
    updated++;
  });
  const btn=$('#whSaveBtn');if(btn){btn.disabled=true;btn.textContent='กำลังบันทึก…';}
  if (counts.length) {
    const { error } = await supabase.rpc('record_warehouse_count', { p_counts: counts });
    if (error) { if(btn)btn.disabled=false;toast('บันทึกสต๊อกไม่สำเร็จ: ' + error.message); return; }
  }
  S.whDraft = {}; S.whDraftLoose = {};
  toast(updated ? `บันทึกจำนวนที่นับได้ ${updated} รายการ` : 'บันทึกแล้ว');
  await draw($('#roleRoot'));
}

// itemId เริ่มเป็น null — ตอนไฟล์นี้โหลด STOCK_ITEMS ยังว่างอยู่ (โหลดจากฐานข้อมูลทีหลัง)
// จึงใช้ purchItem() หาของจริงทุกครั้ง: ถ้ายังไม่ได้เลือก = รายการแรกที่ขึ้นอยู่บนจอ
let purchState = { open: false, itemId: null, qty: '', loose: '', price: '' };
const purchItem = () => STOCK_ITEMS.find(x => x.id === purchState.itemId) || STOCK_ITEMS[0];
// ข้อความสรุปใต้ช่องกรอก: ต้นทุนต่อหน่วย + จำนวนชิ้นรวม
function purchPreviewText() {
  const it = purchItem(); if (!it) return '';
  const c = qtyField(purchState.qty), l = qtyField(purchState.loose), p = N(numIn(purchState.price));
  const u = purchaseUnits(it, c, l);
  if (!(u > 0) || !(p > 0)) return '';
  return `รวม ${u} ${it.unit} (${purchaseQtyLabel(c, l, it.unit)}) · ต้นทุน ${(p / u).toFixed(2)} บาท/${it.unit}`;
}
function renderPurchCard() {
  const it = purchItem();
  return `<div class="between" style="margin-bottom:4px">
      <div class="eyebrow">บันทึกบิลซื้อวัตถุดิบเข้าคลังกลาง</div>
      <button class="mini" id="purchToggleBtn">${purchState.open ? 'ปิด' : '+ บันทึกบิลซื้อ'}</button>
    </div>
    ${purchState.open ? `
    <div class="field"><label>รายการ</label>
      <select id="purchItemSel" class="ctl">${STOCK_ITEMS.map(x => `<option value="${x.id}" ${x.id === it?.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="row" style="gap:10px">
      <div class="field" style="flex:1"><label>จำนวน (ลัง)</label><input id="purchQty" inputmode="numeric" value="${esc(purchState.qty)}" placeholder="0"></div>
      <div class="field" style="flex:1"><label id="purchLooseLbl">ชิ้นนอกลัง (${esc(it?.unit || 'ชิ้น')})</label><input id="purchLoose" inputmode="numeric" value="${esc(purchState.loose)}" placeholder="0"></div>
    </div>
    <p class="sub" id="purchPerCase" style="margin:-4px 0 8px">1 ลัง = ${it?.per_case ?? '-'} ${esc(it?.unit || '')} · กรอกลังอย่างเดียว ชิ้นอย่างเดียว หรือทั้งสองช่องก็ได้</p>
    <div class="field"><label>ราคารวมที่จ่าย (บาท)</label><input id="purchPrice" inputmode="numeric" value="${esc(purchState.price)}"></div>
    <p class="sub" id="purchPreview" style="color:var(--brand)">${purchPreviewText()}</p>
    <button class="btn primary big" id="purchSubmitBtn">บันทึกบิลซื้อ</button>` : ''}`;
}
function wirePurchCard() {
  const t = $('#purchToggleBtn'); if (t) t.addEventListener('click', () => { purchState.open = !purchState.open; $('#purchCard').innerHTML = renderPurchCard(); wirePurchCard(); });
  const sel = $('#purchItemSel'); if (sel) sel.addEventListener('change', () => {
    purchState.itemId = +sel.value; const it = purchItem();
    $('#purchLooseLbl').textContent = `ชิ้นนอกลัง (${it.unit})`;
    $('#purchPerCase').textContent = `1 ลัง = ${it.per_case} ${it.unit} · กรอกลังอย่างเดียว ชิ้นอย่างเดียว หรือทั้งสองช่องก็ได้`;
    refreshPurchPreview();
  });
  const q = $('#purchQty'); if (q) q.addEventListener('input', () => { purchState.qty = q.value; refreshPurchPreview(); });
  const l = $('#purchLoose'); if (l) l.addEventListener('input', () => { purchState.loose = l.value; refreshPurchPreview(); });
  const p = $('#purchPrice'); if (p) p.addEventListener('input', () => { purchState.price = p.value; refreshPurchPreview(); });
  const sub = $('#purchSubmitBtn'); if (sub) sub.addEventListener('click', doSubmitPurchase);
}
function refreshPurchPreview() { const el = $('#purchPreview'); if (el) el.textContent = purchPreviewText(); }
async function doSubmitPurchase() {
  const it = purchItem();
  const caseQty = qtyField(purchState.qty), looseQty = qtyField(purchState.loose), totalPrice = N(numIn(purchState.price));
  const sub = $('#purchSubmitBtn'); if (sub) { sub.disabled = true; sub.textContent = 'กำลังบันทึก…'; }
  const res = await recordPurchase({ item: it, caseQty, looseQty, totalPrice });
  if (res.error) { toast(res.error); if (sub) { sub.disabled = false; sub.textContent = 'บันทึกบิลซื้อ'; } return; }
  toast(`บันทึกบิล ${it.name} ${purchaseQtyLabel(caseQty, looseQty, it.unit)} ${baht(totalPrice)} บาทแล้ว — ต้นทุนเฉลี่ยใหม่ ${Number(res.avg_cost ?? 0).toFixed(2)} บาท/${it.unit}`);
  purchState = { open: false, itemId: null, qty: '', loose: '', price: '' };
  await draw($('#roleRoot'));
}

/* ============================== ขายนอกสาขา ============================== */
let _extIssuerNames = {};
async function renderExt(body) {
  body.innerHTML = `<div class="stack" id="extBox"><div class="boot">กำลังโหลด…</div></div>`;
  const avail = await whAvailMap(STOCK_ITEMS);
  const [{ data: sales }, { data: employees }] = await Promise.all([
    supabase.from('external_sales').select('*').order('sale_date', { ascending: false }).limit(100),
    supabase.from('employees').select('id,name'),
  ]);
  _extIssuerNames = {}; (employees || []).forEach(e => { _extIssuerNames[e.id] = e.name; });
  const box = $('#extBox');
  box.innerHTML = `${extSaleCard(avail)}${extHistoryTable(sales || [])}
    <p class="foot">ตัดสต๊อกคลังกลางทันทีตอนออกบิล ใช้ราคาส่งสาขาเดิมทุกรายการ — เงินที่ได้ให้ลูกค้าโอนเข้าบัญชีร้านตรงเลย ไม่ผ่านเงินสดของคุณ</p>`;
  wireExt(box, avail, sales || []);
}

function extSaleCard(avail) {
  const total = STOCK_ITEMS.reduce((s, it) => { const q = N(S.extDraft[it.id]); return q > 0 ? s + q * it.branch_price : s; }, 0);
  return `<div class="card pad">
    <div class="between" style="margin-bottom:4px">
      <div class="eyebrow">ขายวัตถุดิบให้ร้านนอกสาขา</div>
      <button class="mini" id="extToggleBtn">${S.extOpen ? 'ปิด' : '+ เปิดบิลขาย'}</button>
    </div>
    <p class="sub" style="margin:0 0 10px">ใช้ราคาส่งสาขาเดิมทุกรายการ ตัดสต๊อกคลังกลางทันทีที่ออกบิล — ให้ลูกค้าโอนเงินเข้าบัญชีร้านตรง</p>
    ${S.extOpen ? `
      <div class="field"><label for="extBuyer">ชื่อร้าน/ผู้ซื้อ</label>
        <input id="extBuyer" value="${esc(S.extBuyer)}" placeholder="เช่น ร้านชาไข่มุกบ้านไผ่"></div>
      <div class="stocklist" style="margin:10px 0">${STOCK_ITEMS.map(it => {
        const av = avail[it.id] ?? 0;
        const q = S.extDraft[it.id] != null ? S.extDraft[it.id] : '';
        const line = N(q) > 0 ? N(q) * it.branch_price : 0;
        return `<div class="stockrow"><div><div class="nm">${esc(it.name)}</div>
            <div class="un">${esc(it.unit)} · ${baht(it.branch_price)} บาท/${esc(it.unit)} · มีอยู่ ${av} ${esc(it.unit)}</div></div>
          <div class="row" style="gap:8px;align-items:center">
            <input inputmode="decimal" data-ext="${it.id}" value="${q}" placeholder="0" style="width:64px">
            <span class="sub" style="min-width:60px;text-align:right">${line ? baht(line) : ''}</span>
          </div></div>`;
      }).join('')}</div>
      <div class="between" style="margin:10px 0;font-weight:700"><span>ยอดรวมบิล</span><span>${baht(total)}</span></div>
      <button class="btn primary big" id="extSubmitBtn">ออกบิล</button>
    ` : ''}
  </div>`;
}

function extHistoryTable(sales) {
  const rows = sales.map(s => {
    const viewing = S.extViewing === s.id;
    const summary = `<tr><td>${fmtDate(s.sale_date)}</td><td>${esc(s.buyer)}</td>
      <td class="sub">${esc(_extIssuerNames[s.issuer] || '—')}</td>
      <td class="n"><button class="mini" data-extview="${s.id}">${s.items.length} รายการ ${viewing ? '▲' : '▼'}</button></td>
      <td class="n">${baht(s.total)}</td>
      <td class="n"><button class="mini" data-extprint="${s.id}">ปริ้นบิล</button></td></tr>`;
    if (!viewing) return summary;
    const detail = `<tr class="detailrow"><td colspan="6" style="text-align:left;background:var(--surface-2)">
      <div style="padding:10px 4px">${s.items.map(li => {
        const it = STOCK_ITEMS.find(x => x.id === li.item_id);
        return `<div class="between" style="padding:4px 0"><span>${esc(it ? it.name : li.item_id)}</span>
          <span class="sub">${li.qty} ${it ? it.unit : ''} × ${baht(li.price)} = ${baht(li.qty * li.price)}</span></div>`;
      }).join('')}
      <button class="mini" data-extview="${s.id}" style="margin-top:8px">ปิด</button></div></td></tr>`;
    return summary + detail;
  }).join('');
  return `<div class="sub" style="margin-bottom:6px">ประวัติบิลขายนอกสาขา</div>
    <div class="tablewrap"><table><thead><tr><th>วันที่</th><th>ผู้ซื้อ</th><th>ผู้ออกบิล</th><th>รายการ</th><th>ยอดรวม</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="sub">ยังไม่มีบิลขายนอก</td></tr>'}</tbody></table></div>`;
}

function wireExt(box, avail, sales) {
  const t = $('#extToggleBtn'); if (t) t.addEventListener('click', () => { S.extOpen = !S.extOpen; renderExtRefresh(box, avail, sales); });
  const buyer = $('#extBuyer'); if (buyer) buyer.addEventListener('input', () => { S.extBuyer = buyer.value; });
  box.querySelectorAll('input[data-ext]').forEach(inp => inp.addEventListener('input', () => { S.extDraft[inp.dataset.ext] = inp.value; renderExtRefresh(box, avail, sales); }));
  const sub = $('#extSubmitBtn'); if (sub) sub.addEventListener('click', () => doSubmitExternalSale(avail));
  box.querySelectorAll('[data-extview]').forEach(btn => btn.addEventListener('click', () => { S.extViewing = S.extViewing === btn.dataset.extview ? null : btn.dataset.extview; renderExtRefresh(box, avail, sales); }));
  box.querySelectorAll('[data-extprint]').forEach(btn => btn.addEventListener('click', async () => {
    const sale = sales.find(x => x.id === btn.dataset.extprint); if (!sale) return;
    const companies = await getCompanies();
    const html = externalBillHTML({ sale, issuerName: _extIssuerNames[sale.issuer], stockItems: STOCK_ITEMS, companies, viewerRole: 'relief' });
    printDoc(html, 'ไม่พบบิลนี้');
  }));
}
function renderExtRefresh(box, avail, sales) {
  box.innerHTML = `${extSaleCard(avail)}${extHistoryTable(sales)}
    <p class="foot">ตัดสต๊อกคลังกลางทันทีตอนออกบิล ใช้ราคาส่งสาขาเดิมทุกรายการ — เงินที่ได้ให้ลูกค้าโอนเข้าบัญชีร้านตรงเลย ไม่ผ่านเงินสดของคุณ</p>`;
  wireExt(box, avail, sales);
}

async function doSubmitExternalSale(avail) {
  const buyer = (S.extBuyer || '').trim();
  const lines = STOCK_ITEMS.map(it => ({ it, qty: N(S.extDraft[it.id]) })).filter(l => l.qty > 0);
  const btn = $('#extSubmitBtn'); if (btn) { btn.disabled = true; btn.textContent = 'กำลังออกบิล…'; }
  const res = await issueExternalSale({ buyer, lines, issuerId: ME.id, stockItems: STOCK_ITEMS, avail });
  if (res.error) { if (btn) btn.disabled = false; toast(res.error); return; }
  S.extOpen = false; S.extBuyer = ''; S.extDraft = {};
  toast(`ออกบิลให้ ${buyer} แล้ว ${baht(res.total)} บาท`);
  await draw($('#roleRoot'));
}

/* ============================== ยอดส่งเงิน ============================== */
async function renderCash(body) {
  body.innerHTML = `<div class="stack" id="cashBox"><div class="boot">กำลังโหลด…</div></div>`;
  const round = isRoundOn(TODAY);
  const cashStart = BRANCHES.reduce((m, b) => !m || (b.cash_tracking_from && b.cash_tracking_from < m) ? b.cash_tracking_from : m, null);
  const [{ data: allRemits }, { data: headRemits }, { data: records }] = await Promise.all([
    supabase.from('cash_remittances').select('*'),
    supabase.from('head_remittances').select('*'),
    supabase.from('daily_records').select('branch_id,record_date,cash,float_cash,sent').eq('sent', true).gte('record_date', cashStart || '2000-01-01'),
  ]);
  const recs = (records || []).filter(r => { const b = BRANCHES.find(x => x.id === r.branch_id); return !b?.cash_tracking_from || r.record_date >= b.cash_tracking_from; });
  const ledger = calc.remitLedger(allRemits || [], recs);
  const bname = id => (BRANCHES.find(x => x.id === id) || {}).name || id;

  // ยอดค้างที่สาขา แยกรายวัน
  const list = BRANCHES.map(b => {
    const mine = ledger.filter(x => x.branch_id === b.id).sort((a, c) => String(c.created_at).localeCompare(String(a.created_at)));
    const cutoff = mine[0] ? (mine[0].through_record_date || mine[0].remit_date) : null;
    const days = calc.pendingDays(recs.filter(r => r.branch_id === b.id), cutoff);
    return { b, days, amount: days.reduce((t, d) => t + d.amount, 0), isToday: !!(round && round.branch_ids.includes(b.id)) };
  });

  // เงินที่หัวหน้าถืออยู่ = รับจากสาขาแล้ว ยังไม่ได้ส่งต่อให้เจ้าของ (นับหลังครั้งล่าสุดที่ส่งให้เจ้าของ)
  const cashStartMax = BRANCHES.reduce((m, b) => !m || b.cash_tracking_from > m ? b.cash_tracking_from : m, null);
  const held = calc.headCashHeld(allRemits || [], headRemits || [], cashStartMax);
  const lastHead = (headRemits || []).slice().sort((a, c) => String(c.created_at || c.remit_date).localeCompare(String(a.created_at || a.remit_date)))[0];
  const lastHeadAt = lastHead ? String(lastHead.created_at || lastHead.remit_date) : null;
  const holding = ledger.filter(r => r.method === 'cash' && r.received_at && (!lastHeadAt || String(r.received_at) > lastHeadAt))
    .sort((a, c) => String(a.received_at).localeCompare(String(c.received_at)));
  const holdingRows = holding.map(r => `<tr><td>${esc(bname(r.branch_id))}<div class="sub">รับ ${fmtDate(String(r.received_at).slice(0, 10))}</div></td>
      <td>${dayLinesHTML(r.days)}</td><td class="n"><b>${baht(N(r.received_amount ?? r.amount))}</b></td></tr>`).join('');

  // สาขากดส่งเงินแล้ว รอหัวหน้านับและกดรับ
  const waiting = ledger.filter(x => x.method === 'cash' && !x.received_at).sort((a, c) => String(a.created_at).localeCompare(String(c.created_at)));
  const waitingRows = waiting.map(r => `
    <div class="card pad" style="border-left:3px solid var(--amber)">
      <div class="between" style="margin-bottom:2px"><h3>สาขา${esc(bname(r.branch_id))}</h3>
        <span class="bigtime" style="font-size:20px">${baht(r.expected)} <span class="sub" style="font-size:12px;font-weight:400">บาท</span></span></div>
      <p class="sub" style="margin:0 0 6px">สาขากดส่งเงินแล้ว ${fmtDate(r.remit_date)} · ยอดวันที่ ${dayRangeText(r.days)}</p>
      <div style="max-width:260px;margin-bottom:10px">${dayLinesHTML(r.days)}</div>
      <label class="whlbl" style="display:block">นับเงินได้จริง (บาท)
        <input inputmode="decimal" data-recvamt="${r.id}" value="${esc(String(r.expected))}" style="width:100%;margin-top:4px"></label>
      <button class="btn primary" data-recv="${r.id}" style="width:100%;margin-top:10px">รับเงินแล้ว</button>
    </div>`).join('');
  const waitingIds = new Set(waiting.map(r => r.branch_id));
  const branchRows = list.map(({ b, days, amount, isToday }) => `<tr>
      <td>${esc(b.name)}${isToday ? ' <span class="pill warn" style="font-size:11px">รอบวันนี้</span>' : ''}${waitingIds.has(b.id) ? '<div class="sub">ส่งแล้ว รอรับ ↑</div>' : ''}</td>
      <td>${dayLinesHTML(days)}</td><td class="n"><b>${amount ? baht(amount) : '–'}</b></td></tr>`).join('');

  // ประวัติรับเงิน 14 วันล่าสุด
  const since = new Date(Date.parse(TODAY + 'T00:00:00Z') - 14 * 864e5).toISOString().slice(0, 10);
  const hist = ledger.filter(r => r.remit_date >= since).sort((a, c) => String(c.created_at).localeCompare(String(a.created_at)));
  const histRows = hist.map(r => `<tr><td class="n">${fmtDate(r.remit_date)}</td><td>${esc(bname(r.branch_id))}</td>
      <td class="sub" style="font-size:12px">${dayInlineText(r.days) || '—'}</td><td class="n">${baht(r.expected)}</td><td>${remitStatusHTML(r)}</td></tr>`).join('');
  const headLog = (headRemits || []).slice().sort((a, c) => String(c.created_at || c.remit_date).localeCompare(String(a.created_at || a.remit_date))).slice(0, 5)
    .map(e => `<tr><td class="n">${fmtDate(e.remit_date)}</td><td class="n">${baht(e.amount)}</td><td>${e.method === 'cash' ? 'ให้เจ้าของ' : 'ฝากธนาคาร'}</td></tr>`).join('');

  const box = $('#cashBox');
  box.innerHTML = `
    <div class="card pad">
      <div class="between" style="margin-bottom:4px"><div class="eyebrow">เงินสดที่ถืออยู่</div><span class="sub">รับแล้ว ยังไม่ได้ส่งเจ้าของ</span></div>
      <div class="bigtime">${baht(held)} <span class="sub" style="font-size:13px;font-weight:400">บาท</span></div>
      ${holdingRows ? `<div class="tablewrap" style="margin-top:10px"><table>
        <thead><tr><th>สาขา</th><th>ยอดวันที่</th><th>รับจริง</th></tr></thead><tbody>${holdingRows}</tbody>
        <tfoot><tr style="font-weight:700;border-top:2px solid var(--line-2)"><td colspan="2">รวม</td><td class="n">${baht(held)}</td></tr></tfoot></table></div>` : ''}
      <div class="row" style="gap:8px;margin-top:10px">
        <button class="btn primary" id="headRemitCash" style="flex:1" ${held <= 0 ? 'disabled' : ''}>ส่งให้เจ้าของแล้ว</button>
        <button class="btn" id="headRemitTransfer" style="flex:1" ${held <= 0 ? 'disabled' : ''}>ฝากธนาคารแล้ว</button>
      </div>
    </div>
    ${waiting.length ? `<div class="eyebrow" style="margin-top:4px">รอรับเงิน (${waiting.length})</div>${waitingRows}` : ''}
    <div class="card pad">
      <div class="eyebrow" style="margin-bottom:6px">เงินสดค้างที่สาขา (ยังไม่ได้ส่ง)</div>
      <div class="tablewrap"><table><thead><tr><th>สาขา</th><th>ยอดวันที่</th><th>รวม</th></tr></thead><tbody>${branchRows}</tbody></table></div>
      <p class="sub" style="margin:8px 0 0;font-size:12px">${round ? `วันนี้ ${esc(round.name)} — ไปรับเงินที่สาขา ให้พนักงานกด "ส่งเงินสดแล้ว" ที่เครื่องสาขา แล้วรายการจะขึ้นด้านบนให้กดรับ` : 'พนักงานกด "ส่งเงินสดแล้ว" ที่เครื่องสาขา แล้วรายการจะขึ้นด้านบนให้กดรับ'}</p>
    </div>
    <div class="card pad">
      <div class="eyebrow" style="margin-bottom:6px">ประวัติรับเงินจากสาขา (14 วัน)</div>
      <div class="tablewrap"><table><thead><tr><th>วันที่ส่ง</th><th>สาขา</th><th>ยอดวันที่</th><th>ควรได้</th><th>สถานะ</th></tr></thead>
        <tbody>${histRows || '<tr><td colspan="5" class="sub">ยังไม่มี</td></tr>'}</tbody></table></div>
      ${headLog ? `<div class="eyebrow" style="margin:12px 0 6px">ส่งต่อให้เจ้าของล่าสุด</div>
        <div class="tablewrap"><table><thead><tr><th>วันที่</th><th>จำนวน</th><th>วิธี</th></tr></thead><tbody>${headLog}</tbody></table></div>` : ''}
    </div>
    <p class="foot">ยอดต่อวัน = เงินสดตอนปิดร้าน − เงินทอน · ถ้าเงินที่นับได้ไม่ตรงกับยอดในแอป ให้ใส่ตามที่นับได้จริง เจ้าของจะเห็นส่วนต่าง</p>
  `;
  box.querySelectorAll('[data-recv]').forEach(btn => btn.addEventListener('click', () => doReceive(btn.dataset.recv, btn)));
  const hc = $('#headRemitCash'); if (hc) hc.addEventListener('click', () => doHeadRemit('cash', held));
  const ht = $('#headRemitTransfer'); if (ht) ht.addEventListener('click', () => doHeadRemit('transfer', held));
}

async function doReceive(id, btn) {
  const inp = [...document.querySelectorAll('[data-recvamt]')].find(x => x.dataset.recvamt === id);
  const v = numIn(inp ? inp.value : '');
  if (v === '' || !(v >= 0)) { toast('ใส่จำนวนเงินที่นับได้จริง'); return; }
  btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
  const { data, error } = await supabase.rpc('receive_branch_cash', { p_remit_id: id, p_amount: v });
  if (error) { toast('บันทึกรับเงินไม่สำเร็จ: ' + error.message); await draw($('#roleRoot')); return; }
  const diff = N(data?.received) - N(data?.sent);
  toast(`รับเงินแล้ว ${baht(v)} บาท` + (diff ? ` (${diff < 0 ? 'ขาด' : 'เกิน'}จากยอดในแอป ${baht(Math.abs(diff))})` : ''));
  await draw($('#roleRoot'));
}
async function doHeadRemit(method, held) {
  if (held <= 0) { toast('ไม่มีเงินสดค้างส่ง'); return; }
  const btn = $(method === 'cash' ? '#headRemitCash' : '#headRemitTransfer'); if (btn) btn.disabled = true;
  const { error } = await supabase.from('head_remittances').insert({ remit_date: TODAY, amount: held, method });
  if (error) { if (btn) btn.disabled = false; toast('บันทึกส่งเงินไม่สำเร็จ: ' + error.message); return; }
  toast((method === 'cash' ? 'บันทึกว่าส่งเงินสดให้เจ้าของแล้ว ' : 'บันทึกว่าฝากธนาคารแล้ว ') + baht(held) + ' บาท');
  await draw($('#roleRoot'));
}

/* ============================== ลงเวลา (ไปแทนสาขา) ============================== */
let reliefPayMonth = 'this';   // 'this' | 'prev' — การ์ดเงินเดือนหัวหน้า
async function renderClock(body) {
  body.innerHTML = `<div class="stack" id="clockBox"><div class="boot">กำลังโหลด…</div></div>`;
  const { data: offToday } = await supabase.from('day_offs').select('*').eq('off_date', TODAY).maybeSingle();
  const b = offToday ? BRANCHES.find(x => x.id === offToday.branch_id) : null;
  const cfg = getSettings();

  // เงินเดือนหัวหน้า — เดือนนี้ (ประมาณการ) หรือเดือนก่อน (ปุ่มสลับ เจ้าของสั่ง 1 ต.ค. 69)
  const isPrev = reliefPayMonth === 'prev';
  const dates = monthDates(isPrev
    ? (() => { const d = new Date(+TODAY.slice(0, 4), +TODAY.slice(5, 7) - 2, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'; })()
    : TODAY);
  const [{ data: allRecords }, { data: allClocks }, { data: whRentRows }, { data: myEmp }] = await Promise.all([
    supabase.from('daily_records').select('*').gte('record_date', dates[0]).lte('record_date', dates[dates.length - 1]),
    supabase.from('clock_records').select('*').gte('clock_date', dates[0]).lte('clock_date', dates[dates.length - 1]),
    supabase.from('warehouse_rent_history').select('*').order('effective_from'),
    supabase.from('employees').select('*').eq('id', ME.id).maybeSingle(),
  ]);
  const allBranchClocksByDate = {};
  BRANCHES.forEach(br => { allBranchClocksByDate[br.id] = {}; });
  (allClocks || []).forEach(c => { if (!allBranchClocksByDate[c.branch_id]) allBranchClocksByDate[c.branch_id] = {}; allBranchClocksByDate[c.branch_id][c.clock_date] = c; });
  const whRentHistory = (whRentRows || []).map(r => ({ from: r.effective_from, rent: r.rent }));
  const whRent = calc.rentAt(whRentHistory, dates[0]);
  const pr = calc.payrollForRelief({
    relief: { name: ME.name, base_salary: myEmp?.base_salary ?? 9000, delivery_pay: myEmp?.delivery_pay ?? 0, start_date: myEmp?.start_date },
    allBranchRecords: allRecords || [], allBranchClocksByDate, todayISO: TODAY, cfg, whRent, monthEnd: dates[dates.length - 1],
  });

  const payToggle = `<span class="seg2" style="align-self:flex-start">
      <button data-rpaymonth="prev" aria-pressed="${isPrev}">เดือนก่อน</button>
      <button data-rpaymonth="this" aria-pressed="${!isPrev}">เดือนนี้</button></span>`;
  const payCard = pr.notStarted ? `${payToggle}<div class="card pad">
      <div class="eyebrow">สรุปเงินเดือน ${monthLabel(dates[0])}</div>
      <p class="sub" style="margin:8px 0 0">ยังไม่มีเงินเดือนเดือนนี้ — เริ่มงานวันที่ ${fmtDate(pr.startDate)}</p></div>` : `${payToggle}<div class="card pad">
      <div class="between" style="margin-bottom:2px"><div class="eyebrow">${isPrev ? `สรุปเงินเดือน ${monthLabel(dates[0])}` : 'สรุปเงินเดือน (ประมาณการเดือนนี้)'}</div>
        <button class="mini" id="printReliefSlipBtn">ปริ้นสลิป</button></div>
      <div class="bigtime" style="margin:6px 0 2px">${baht(pr.total)} <span class="sub" style="font-size:13px;font-weight:400">บาท</span></div>
      <div class="sub" style="margin-bottom:10px">${isPrev ? 'ยอดสุทธิของเดือนนี้ · จ่ายวันที่ 5 (ถ้าเจ้าของแก้ยอดย้อนหลัง ตัวเลขอาจเปลี่ยน)' : 'ยอดสุทธิโดยประมาณ · จ่ายจริงทุกวันที่ 5'}</div>
      <div class="payrows">
        <div class="payrow"><span>เงินเดือนฐาน</span><span class="n">${baht(myEmp?.base_salary ?? 0)}</span></div>
        <div class="payrow"><span>เงินส่งของ</span><span class="n">${baht(myEmp?.delivery_pay ?? 0)}</span></div>
        <div class="payrow"><span>ค่าเช่าคลังกลาง</span><span class="n">${baht(pr.whRent)}</span></div>
        <div class="payrow"><span>ค่าแก้ว (${pr.cups} ใบ)</span><span class="n">${baht(pr.cupPay)}</span></div>
      </div>
      <p class="sub" style="margin-top:8px">ไปทำแทนสาขาไม่หักมาสาย/ปิดไว — แต่ต้องลงเวลาเข้าก่อนถึงจะเริ่มงานได้</p>
    </div>`;

  const wirePay = () => {
    document.querySelectorAll('[data-rpaymonth]').forEach(btn => btn.addEventListener('click', () => {
      if (reliefPayMonth === btn.dataset.rpaymonth) return;
      reliefPayMonth = btn.dataset.rpaymonth; renderClock(body);
    }));
    const pb = $('#printReliefSlipBtn'); if (pb) pb.addEventListener('click', async () => {
    const [companies, { data: mine }] = await Promise.all([
      getCompanies(),
      supabase.from('employee_private').select('*').eq('employee_id', ME.id).maybeSingle(),   // อ่านได้เฉพาะของตัวเอง
    ]);
    const html = reliefSlipHTML({ name: ME.name, role: 'หัวหน้า', first_name: ME.first_name, last_name: ME.last_name,
      national_id: mine?.national_id || '', base_salary: myEmp?.base_salary ?? 0, delivery_pay: myEmp?.delivery_pay ?? 0 },
      pr, monthLabel(dates[dates.length - 1]), companies);
    printDoc(html, 'ยังไม่มีสลิปให้ออก');
  });
  };
  const box = $('#clockBox');
  if (!b) {
    box.innerHTML = `<div class="card pad clockcard"><div class="eyebrow">ลงเวลาทำงาน</div>
        <div class="sub" style="margin:6px 0 10px">วันนี้ไม่มีสาขาที่ต้องไปแทน</div>
        <button class="btn primary big" disabled>ลงเวลาเข้า</button></div>${payCard}`;
    wirePay();
    return;
  }
  const [{ data: clockRow }, { data: recRow }, { data: prevRows }] = await Promise.all([
    supabase.from('clock_records').select('*').eq('branch_id', b.id).eq('clock_date', TODAY).maybeSingle(),
    supabase.from('daily_records').select('*').eq('branch_id', b.id).eq('record_date', TODAY).maybeSingle(),
    supabase.from('daily_records').select('*').eq('branch_id', b.id).lt('record_date', TODAY).order('record_date', { ascending: false }).limit(1),
  ]);
  const clock = clockRow || {};
  const rec = recRow || null;
  const prev = (prevRows && prevRows[0]) || null;
  const openSet = clock.open_yen != null && clock.open_pan != null;

  const done = !!(rec && rec.sent);
  if (!done && (!S.reliefDraft || S.reliefDraft._b !== b.id)) S.reliefDraft = { ...defaultDraft(prev, b, STOCK_ITEMS), _b: b.id };
  const clockCard = `<div class="card pad clockcard"><div class="eyebrow">ลงเวลาทำงาน</div>
        <div class="sub" style="margin:6px 0 10px">วันนี้ไปแทนสาขา${esc(b.name)}</div>
        <div class="between" style="margin:8px 0 4px"><div><div class="bigtime">${clock.time_in || '--:--'}</div><div class="sub">เวลาเข้า</div></div>
        <div style="text-align:right"><div class="bigtime">${clock.time_out || '--:--'}</div><div class="sub">เวลาออก</div></div></div>
        ${done ? '' : `<button class="btn primary big" id="reliefClockBtn" ${clock.time_out ? 'disabled' : ''}>
          ${clock.time_out ? 'ลงเวลาครบแล้ววันนี้' : clock.time_in ? 'ลงเวลาออก' : 'ลงเวลาเข้า'}</button>`}
      </div>`;
  const inner = done
    ? `${clockCard}<div class="locked">ปิดยอดแทนสาขา${esc(b.name)}วันนี้แล้ว<br><span class="sub">ถ้าตัวเลขผิด แจ้งเจ้าของให้แก้ให้</span></div>`
    : `${clockCard}
      ${clock.time_in && !openSet ? reliefOpenCountCard(b, prev) : ''}
      ${clock.time_in && openSet ? reliefCloseFormHTML(prev) : ''}
      ${clock.time_in && openSet ? `<button class="btn primary big" id="reliefSendBtn">ส่งยอดแทนสาขา</button>
        <p class="sub" style="text-align:center;margin:0">ส่งแล้วแก้เองไม่ได้ ตรวจให้ครบก่อนกด</p>` : ''}`;

  box.innerHTML = inner + payCard + `<p class="foot">วันที่ไปทำแทน หน้านี้เปิดฟอร์มปิดยอดและเช็กวัตถุดิบคงเหลือของสาขานั้นให้กรอกได้เลย และแก้วที่ทำวันนั้นเข้าค่าแก้วของคุณ</p>`;
  wireClockTab(box, b, clock, rec, prev, openSet);
  wirePay();
}

function reliefOpenCountCard(b, prev) {
  if (!S.reliefOpenDraft) S.reliefOpenDraft = { yen: prev ? prev.yen : '', pan: prev ? prev.pan : '' };
  return `<div class="card pad" style="border-left:3px solid var(--amber)">
    <div class="eyebrow">นับแก้วก่อนเริ่มขาย</div>
    <p class="sub" style="margin:6px 0 10px">นับแก้วเย็น/ปั่นที่เหลืออยู่จริงก่อนเริ่มขายแทนสาขา${esc(b.name)}</p>
    <div class="field"><label>แก้วเย็นคงเหลือตอนนี้ (ใบ)</label><input inputmode="numeric" id="rOpenYen" value="${S.reliefOpenDraft.yen}"></div>
    <div class="field"><label>แก้วปั่นคงเหลือตอนนี้ (ใบ)</label><input inputmode="numeric" id="rOpenPan" value="${S.reliefOpenDraft.pan}"></div>
    <button class="btn primary big" id="rOpenCountBtn" style="margin-top:10px">ยืนยันนับแก้ว</button>
  </div>`;
}

function reliefCloseFormHTML(prev) {
  return closeFormHTML({
    draft: S.reliefDraft, errors: S.reliefErrors, prev, cfg: getSettings(), attr: 'rf', stockItems: STOCK_ITEMS,
    intro: 'กรอกยอดขายและนับวัตถุดิบคงเหลือจริงของวันนี้แทนพนักงานประจำสาขา — ระบบขึ้นยอดเมื่อวานไว้ให้แล้ว แก้เฉพาะรายการที่เปลี่ยน (ค่าแก้ววันนี้เข้าเงินเดือนของคุณเอง)',
  });
}

function wireClockTab(box, b, clock, rec, prev, openSet) {
  const cb = $('#reliefClockBtn'); if (cb) cb.addEventListener('click', () => doReliefClock(b, clock));
  const ocBtn = $('#rOpenCountBtn'); if (ocBtn) ocBtn.addEventListener('click', () => doReliefOpenCount(b, prev));
  box.querySelectorAll('input[data-rf]').forEach(inp => inp.addEventListener('input', () => { S.reliefDraft[inp.dataset.rf] = numIn(inp.value); }));
  // คนไปแทนต้องนับวัตถุดิบเหมือนพนักงานประจำ เพื่อให้ยอดคงเหลือของสาขาและใบจัดของรอบถัดไปถูกต้อง
  box.querySelectorAll('input[data-stock]').forEach(inp => inp.addEventListener('input', () => {
    S.reliefDraft.stock[inp.dataset.stock] = numIn0(inp.value);
  }));
  const sendBtn = $('#reliefSendBtn'); if (sendBtn) sendBtn.addEventListener('click', () => doReliefSend(b, clock, prev));
}

/* ลงเวลาตอนไปแทนสาขา — ต้องอยู่ในรัศมีของสาขาที่ไปแทนจริงถึงจะลงได้ · ใช้เวลาไทย
   หัวหน้า "ไม่หัก" มาสาย/ปิดไว (เจ้าของสั่งแก้ 5 ก.ย. 69 — ไปทำแทนหลายสาขาคนละเวลา บางวันต้องส่งของก่อน)
   จึงบันทึกนาทีสาย/ปิดไวเป็น 0 ไว้ตรง ๆ ไม่ให้ไหลไปเป็นยอดหักในเงินเดือน แต่ยังต้องลงเวลาให้ครบเข้า-ออก */
async function doReliefClock(b, clock) {
  const btn = $('#reliefClockBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังตรวจตำแหน่ง…'; }
  const at = await verifyForClock(b, toast);
  if (!at) { await draw($('#roleRoot')); return; }

  const timeStr = nowHM();
  if (!clock.time_in) {
    await supabase.from('clock_records').upsert({ branch_id: b.id, clock_date: TODAY, staff_name: ME.name,
      time_in: timeStr, late_minutes: 0, in_distance_m: at.distance ?? null }, { onConflict: 'branch_id,clock_date' });
    toast('ลงเวลาเข้างานแล้ว ' + timeStr);
  } else {
    await supabase.from('clock_records').update({ time_out: timeStr, early_minutes: 0,
      out_distance_m: at.distance ?? null, staff_name: ME.name }).eq('branch_id', b.id).eq('clock_date', TODAY);
    toast('ลงเวลาออกงานแล้ว ' + timeStr);
  }
  await draw($('#roleRoot'));
}

async function doReliefOpenCount(b, prev) {
  const yenEl = $('#rOpenYen'), panEl = $('#rOpenPan');
  if (yenEl.value === '' || panEl.value === '') { toast('กรอกแก้วเย็น/ปั่นให้ครบก่อนยืนยัน'); return; }
  const newYen = N(yenEl.value), newPan = N(panEl.value);
  if(newYen<0||newPan<0||!Number.isInteger(newYen)||!Number.isInteger(newPan)){toast('จำนวนแก้วต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');return;}
  const {error}=await supabase.from('clock_records').update({ open_yen: newYen, open_pan: newPan }).eq('branch_id', b.id).eq('clock_date', TODAY);
  if(error){toast('บันทึกไม่สำเร็จ: '+error.message);return;}
  if (prev && (newYen !== prev.yen || newPan !== prev.pan)) {
    const cfg = getSettings();
    const valueDiff = (newYen - prev.yen) * cfg.cupPrice.yen + (newPan - prev.pan) * cfg.cupPrice.pan;
    await supabase.from('recount_requests').insert({ branch_id: b.id, request_date: TODAY, prev_record_id: prev.id, staff_name: ME.name, old_yen: prev.yen, old_pan: prev.pan, new_yen: newYen, new_pan: newPan, value_diff: valueDiff });
    toast('บันทึกยอดนับแก้วแล้ว — ยอดไม่ตรงกับเมื่อวาน ส่งคำขอให้เจ้าของตรวจสอบแล้ว');
  } else toast('บันทึกยอดนับแก้วก่อนเริ่มขายแล้ว');
  S.reliefOpenDraft = null;
  await draw($('#roleRoot'));
}

async function doReliefSend(b, clock, prev) {
  const d = S.reliefDraft;
  if (!d || !clock) return;   // กันกดปุ่มรัว ๆ บนมือถือ
  const errs = validateClose(d, clock);
  if (Object.keys(errs).length) {
    S.reliefErrors = errs; await draw($('#roleRoot')); toast('กรอกข้อมูลให้ครบและถูกต้องก่อน');
    const first = document.querySelector('.field input.err'); if (first) first.scrollIntoView({ block: 'center' });
    return;
  }
  // บันทึกสต๊อกที่นับจริงจากฟอร์ม โดย "แถวแก้ว" คิดจากที่นับวันนี้เสมอ
  if(todayISO()!==TODAY){await draw($('#roleRoot'));toast('ข้ามวันแล้ว โหลดข้อมูลวันใหม่ให้แล้ว');return;}
  const btn=$('#reliefSendBtn');if(btn){btn.disabled=true;btn.textContent='กำลังบันทึก…';}
  const { error } = await submitClose({
    branchId: b.id, dateISO: TODAY, staffName: ME.name, draft: d, cfg: getSettings(),
    stockItems: STOCK_ITEMS, prevSnapshot: prev ? prev.stock_snapshot : {}, createdBy: ME.id,
    openYen:clock.open_yen,openPan:clock.open_pan,
  });
  if (error) { if(btn)btn.disabled=false;toast('บันทึกไม่สำเร็จ: ' + error.message); return; }
  S.reliefDraft = null; S.reliefErrors = {};
  toast('บันทึกยอดแทนสาขา' + b.name + ' เรียบร้อย — ค่าแก้ววันนี้เข้าเงินเดือนของคุณ');
  await draw($('#roleRoot'));
}
