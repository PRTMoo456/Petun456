// หน้าหัวหน้า — ตารางไปแทนสาขา + จองวันหยุด, รอบส่งของ + เช็คสต๊อกคลังกลาง, ขายนอกสาขา, ยอดส่งเงิน, ลงเวลา(ไปแทน)
// พอร์ตตรงจาก reliefView()/reliefSched()/reliefPack()/reliefWh()/reliefExt()/reliefCash()/reliefClock() ในต้นแบบ nomicha.html
import { supabase } from '../supabaseClient.js';
import { getSettings } from '../settings.js';
import { $, N, numIn, baht, esc, toast, todayISO, nowHM, fmtDate, monthKey, monthLabel, monthDates, DAYS } from '../util.js';
import { loadRefs } from '../refs.js';
import { quotaReport, dayChip, OFF_LEGEND, quotaHTML, futureDates } from '../dayoff.js';
import { getCompanies, reliefSlipHTML, externalBillHTML, printDoc } from '../print.js';
import { defaultDraft, closeFormHTML, validateClose, submitClose } from '../close.js';
import { verifyForClock } from '../geo.js';
import { whAvailMap, issueExternalSale } from '../warehouse.js';
import * as calc from '../calc.js';

let ME, TODAY, STOCK_ITEMS = [], BRANCHES = [], ROUNDS = [];
let S = {
  tab: 'sched', round: null, packOpen: {}, whDraft: {}, whDraftLoose: {},
  extOpen: false, extBuyer: '', extDraft: {}, extViewing: null,
  reliefDraft: null, reliefErrors: {},
};

export async function renderReliefApp(root, me) {
  ME = me;
  TODAY = todayISO();
  const refs = await loadRefs();
  BRANCHES = refs.branches; STOCK_ITEMS = refs.stockItems; ROUNDS = refs.rounds;
  if (!S.round) S.round = ROUNDS[0]?.id;
  await draw(root);
}

async function draw(root) {
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
  if (S.tab === 'sched') return renderSched(body);
  if (S.tab === 'pack') return renderPack(body);
  if (S.tab === 'ext') return renderExt(body);
  if (S.tab === 'cash') return renderCash(body);
  return renderClock(body);
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
  const win14 = future.slice(0, 14);
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
      <td><b>สาขา${esc(b ? b.name : off.branch_id)}</b>${staffOf(off.branch_id) ? ` <span class="sub">(${esc(staffOf(off.branch_id))} หยุด)</span>` : ''}${d === TODAY ? ' <span class="pill warn">วันนี้</span>' : ''}</td></tr>`;
  }).join('');

  const rReport = quotaReport(myOffDates, win14, ME.days_off_quota ?? 2);
  const rMonthFull = new Map(rReport.map(r => [r.label, r.used >= (ME.days_off_quota ?? 2)]));
  const offChips = win14.map(d => {
    const mine = myOffDates.includes(d);
    const round = !!isRoundOn(d);
    const covering = (dayOffs || []).some(x => x.off_date === d);
    const blocked = round || covering;
    const full = rMonthFull.get(monthLabel(d)) || false;
    const newMonth = d === win14.find(x => monthKey(x) === monthKey(d));
    const cls = round ? 'round' : mine ? 'mine' : blocked ? 'round' : full ? 'full' : 'free';
    const title = round ? 'วันส่งของ — ห้ามหยุด' : covering ? 'ต้องไปทำแทนสาขาที่จองไว้' : full && !mine ? `ครบโควตาของเดือน ${monthLabel(d)} แล้ว` : '';
    const tag = round ? '<span class="dt">ส่งของ</span>' : covering ? '<span class="dt">ไปแทน</span>' : mine ? '<span class="dt">หยุด</span>' : cls === 'free' ? '<span class="dt ok">ว่าง</span>' : '';
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
      <p class="sub" style="margin:0 0 10px">จองล่วงหน้าได้ 14 วัน · แตะวันที่ขึ้น <b style="color:var(--brand)">ว่าง</b> เพื่อจอง</p>
      <div class="daygrid">${offChips}</div>
      ${OFF_LEGEND}
      ${quotaHTML(rReport, ME.days_off_quota ?? 2)}
    </div>
  </div>`;
  body.querySelectorAll('.daychip[data-roff]').forEach(chip => chip.addEventListener('click', () => toggleReliefOff(chip.dataset.roff, dayOffs || [])));
}

async function toggleReliefOff(dateISO, dayOffs) {
  const { data: cur } = await supabase.from('relief_day_offs').select('*').eq('off_date', dateISO).maybeSingle();
  if (cur) { await supabase.from('relief_day_offs').delete().eq('off_date', dateISO); toast('ยกเลิกวันหยุด ' + fmtDate(dateISO)); await draw($('#roleRoot')); return; }
  const rd2 = isRoundOn(dateISO);
  if (rd2) { toast(`วันส่งของ (${rd2.name}) ห้ามหยุด`); return; }
  const covering = dayOffs.some(x => x.off_date === dateISO);
  if (covering) { toast('วันนี้ต้องไปทำแทนสาขาที่จองไว้แล้ว'); return; }
  const future = futureDates(TODAY, 31).slice(0, 14);
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

async function renderPack(body) {
  const selector = `<span class="seg2" style="align-self:flex-start">${ROUNDS.map(x =>
    `<button data-round="${x.id}" aria-pressed="${x.id === S.round}">${x.name}</button>`).join('')}
    <button data-round="wh" aria-pressed="${S.round === 'wh'}">เช็คสต๊อก</button></span>`;

  if (S.round === 'wh') {
    body.innerHTML = `<div class="stack">${selector}<div id="whBox"><div class="boot">กำลังโหลด…</div></div></div>`;
    wireRoundSelector(body);
    return renderWh($('#whBox'));
  }

  const r = ROUNDS.find(x => x.id === S.round) || ROUNDS[0];
  if (!r) { body.innerHTML = selector + '<p class="sub">ยังไม่ได้ตั้งรอบส่งของ</p>'; return; }
  const packDate = roundDate(r);
  const { data: existing } = await supabase.from('deliveries').select('branch_id').eq('delivery_date', packDate).in('branch_id', r.branch_ids);
  const packedAlready = (existing || []).length > 0;
  const perBranch = await Promise.all(r.branch_ids.map(async bid => ({ b: BRANCHES.find(x => x.id === bid) || { id: bid, name: bid }, items: await pickListFor(bid) })));

  const branchCards = perBranch.map(x => {
    const open = !!S.packOpen[x.b.id];
    return `<div class="card pad">
      <button class="accbtn" data-packacc="${x.b.id}" aria-expanded="${open}">
        <span class="branchname">สาขา${esc(x.b.name)}</span>
        <span style="display:flex;align-items:center;gap:8px">
          <span class="pill ${x.items.length ? 'warn' : 'ok'}">${x.items.length ? x.items.length + ' รายการ' : 'ครบแล้ว'}</span>
          <span class="chev">›</span>
        </span>
      </button>
      ${open ? `<div class="accbody">
        ${x.items.length ? x.items.map(i => `<div class="stockrow">
            <div><div class="nm">${esc(i.it.name)}</div>
              <div class="un">${esc(i.it.unit)} · เหลือ ${i.have} ต้องมี ${i.par}</div></div>
            <span class="num" style="font-weight:600">${i.need}</span></div>`).join('') : '<p class="sub" style="margin:0">ไม่ต้องเติมอะไร</p>'}
      </div>` : ''}
    </div>`;
  }).join('');

  body.innerHTML = `<div class="stack">
    ${selector}
    <div class="card pad" style="border-left:3px solid ${packedAlready ? 'var(--brand)' : 'var(--amber)'}">
      <div class="between">
        <div><div class="eyebrow">${packDate === TODAY ? 'รอบวันนี้' : 'รอบถัดไป'}</div>
          <div class="bigtime" style="font-size:26px;margin:4px 0">${fmtDate(packDate)}</div>
          <div class="sub">${r.branch_ids.map(id => (BRANCHES.find(x => x.id === id) || {}).name || id).join(' · ')}</div></div>
        ${packedAlready ? '<span class="pill ok">บันทึกจัดของแล้ว</span>' : ''}
      </div>
    </div>
    ${branchCards}
    <button class="btn primary big" id="packBtn">${packedAlready ? 'บันทึกรายการที่จัดใหม่อีกครั้ง' : 'จัดของครบแล้ว'}</button>
    <p class="foot">จำนวนคำนวณจากระดับที่ต้องมีต่อรอบที่เจ้าของตั้งไว้ ลบด้วยของที่เหลืออยู่จริงในสาขา (ยอดปิดล่าสุดที่สาขาส่งมา) · แตะชื่อสาขาเพื่อดู/ซ่อนรายการ</p>
  </div>`;
  wireRoundSelector(body);
  body.querySelectorAll('[data-packacc]').forEach(btn => btn.addEventListener('click', () => { S.packOpen[btn.dataset.packacc] = !S.packOpen[btn.dataset.packacc]; renderPack(body); }));
  $('#packBtn').addEventListener('click', () => doPackComplete(r, packDate, perBranch));
}

function wireRoundSelector(body) {
  body.querySelectorAll('[data-round]').forEach(btn => btn.addEventListener('click', () => { S.round = btn.dataset.round; loadTab(); }));
}

async function doPackComplete(r, packDate, perBranch) {
  const writes = [];
  for (const x of perBranch) {
    if (!x.items.length) { await supabase.from('deliveries').delete().eq('delivery_date', packDate).eq('branch_id', x.b.id); continue; }
    const items = {}; x.items.forEach(i => { items[i.it.id] = i.need; });
    writes.push(supabase.from('deliveries').upsert({
      delivery_date: packDate, branch_id: x.b.id, round_id: r.id, items, received: null, packed_by: ME.id,
    }, { onConflict: 'branch_id,delivery_date,round_id' }));
  }
  await Promise.all(writes);
  toast('บันทึกว่าจัดของครบแล้ว — เก็บไว้ในประวัติการส่งของ ' + fmtDate(packDate));
  await draw($('#roleRoot'));
}

async function renderWh(el) {
  if (!el) return;
  const { data: stock } = await supabase.from('warehouse_stock').select('*');
  const stockById = {}; (stock || []).forEach(s => { stockById[s.item_id] = s; });
  const low = STOCK_ITEMS.filter(it => (stockById[it.id]?.case_qty ?? 0) < 1).length;
  const lastChecked = (stock || []).reduce((m, s) => (!m || (s.last_checked && s.last_checked > m)) ? s.last_checked : m, null);
  const rows = STOCK_ITEMS.map(it => {
    const cur = stockById[it.id]?.case_qty, curL = stockById[it.id]?.loose_qty;
    const val = S.whDraft[it.id] != null ? S.whDraft[it.id] : (cur ?? '');
    const valL = S.whDraftLoose[it.id] != null ? S.whDraftLoose[it.id] : (curL ?? '');
    const isLow = cur != null && cur < 1;
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
    <p class="foot">เจ้าของจะเห็นรายการที่เหลือน้อยกว่า 1 ลังในหน้าเจ้าของ → สต๊อก → คลังกลาง</p>
  `;
  el.querySelectorAll('input[data-whcount]').forEach(inp => inp.addEventListener('input', () => { S.whDraft[inp.dataset.whcount] = inp.value; }));
  el.querySelectorAll('input[data-whloose]').forEach(inp => inp.addEventListener('input', () => { S.whDraftLoose[inp.dataset.whloose] = inp.value; }));
  $('#whSaveBtn').addEventListener('click', () => saveWhStock(stockById));
  wirePurchCard();
}

async function saveWhStock(stockById) {
  const writes = [];
  let updated = 0;
  STOCK_ITEMS.forEach(it => {
    const v = S.whDraft[it.id], vl = S.whDraftLoose[it.id];
    if ((v == null || v === '') && (vl == null || vl === '')) return;
    const patch = { item_id: it.id, last_checked: TODAY,
      avg_cost: stockById[it.id]?.avg_cost ?? 0 };
    patch.case_qty = (v != null && v !== '') ? N(v) : (stockById[it.id]?.case_qty ?? 0);
    patch.loose_qty = (vl != null && vl !== '') ? N(vl) : (stockById[it.id]?.loose_qty ?? 0);
    writes.push(supabase.from('warehouse_stock').upsert(patch, { onConflict: 'item_id' }));
    updated++;
  });
  await Promise.all(writes);
  S.whDraft = {}; S.whDraftLoose = {};
  toast(updated ? `บันทึกจำนวนที่นับได้ ${updated} รายการ` : 'บันทึกแล้ว');
  await draw($('#roleRoot'));
}

let purchState = { open: false, itemId: STOCK_ITEMS[0]?.id, qty: '', price: '' };
function renderPurchCard() {
  const it = STOCK_ITEMS.find(x => x.id === purchState.itemId) || STOCK_ITEMS[0];
  const q = N(purchState.qty), p = N(purchState.price);
  const preview = (it && q > 0 && p > 0) ? `เท่ากับ ${(p / (q * it.per_case)).toFixed(2)} บาท/${it.unit} (รวม ${q * it.per_case} ${it.unit})` : '';
  return `<div class="between" style="margin-bottom:4px">
      <div class="eyebrow">บันทึกบิลซื้อวัตถุดิบเข้าคลังกลาง</div>
      <button class="mini" id="purchToggleBtn">${purchState.open ? 'ปิด' : '+ บันทึกบิลซื้อ'}</button>
    </div>
    ${purchState.open ? `
    <div class="field"><label>รายการ</label>
      <select id="purchItemSel" class="ctl">${STOCK_ITEMS.map(x => `<option value="${x.id}" ${x.id === purchState.itemId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="field"><label>จำนวนที่ซื้อ (ลัง)</label><input id="purchQty" inputmode="numeric" value="${purchState.qty}"></div>
    <div class="field"><label>ราคารวมที่จ่าย (บาท)</label><input id="purchPrice" inputmode="numeric" value="${purchState.price}"></div>
    <p class="sub" id="purchPreview" style="color:var(--brand)">${preview}</p>
    <button class="btn primary big" id="purchSubmitBtn">บันทึกบิลซื้อ</button>` : ''}`;
}
function wirePurchCard() {
  const t = $('#purchToggleBtn'); if (t) t.addEventListener('click', () => { purchState.open = !purchState.open; $('#purchCard').innerHTML = renderPurchCard(); wirePurchCard(); });
  const sel = $('#purchItemSel'); if (sel) sel.addEventListener('change', () => { purchState.itemId = +sel.value; $('#purchPreview').textContent = ''; refreshPurchPreview(); });
  const q = $('#purchQty'); if (q) q.addEventListener('input', () => { purchState.qty = q.value; refreshPurchPreview(); });
  const p = $('#purchPrice'); if (p) p.addEventListener('input', () => { purchState.price = p.value; refreshPurchPreview(); });
  const sub = $('#purchSubmitBtn'); if (sub) sub.addEventListener('click', doSubmitPurchase);
}
function refreshPurchPreview() {
  const it = STOCK_ITEMS.find(x => x.id === purchState.itemId) || STOCK_ITEMS[0];
  const q = N(purchState.qty), p = N(purchState.price);
  const el = $('#purchPreview'); if (!el) return;
  el.textContent = (it && q > 0 && p > 0) ? `เท่ากับ ${(p / (q * it.per_case)).toFixed(2)} บาท/${it.unit} (รวม ${q * it.per_case} ${it.unit})` : '';
}
async function doSubmitPurchase() {
  const it = STOCK_ITEMS.find(x => x.id === purchState.itemId);
  const q = N(purchState.qty), p = N(purchState.price);
  if (!it || q <= 0) { toast('กรอกจำนวนที่ซื้อให้ถูกต้อง'); return; }
  if (p <= 0) { toast('กรอกราคารวมที่จ่ายให้ถูกต้อง'); return; }
  const { data: cur } = await supabase.from('warehouse_stock').select('*').eq('item_id', it.id).maybeSingle();
  const newUnits = q * it.per_case;
  const newCostPerUnit = p / newUnits;
  const existUnits = (cur?.case_qty ?? 0) * it.per_case + (cur?.loose_qty ?? 0);
  const existCost = cur?.avg_cost ?? newCostPerUnit;
  const totalUnits = existUnits + newUnits;
  const newAvg = totalUnits > 0 ? ((existUnits * existCost) + (newUnits * newCostPerUnit)) / totalUnits : newCostPerUnit;
  await supabase.from('warehouse_stock').upsert({
    item_id: it.id, case_qty: (cur?.case_qty ?? 0) + q, loose_qty: cur?.loose_qty ?? 0,
    avg_cost: +newAvg.toFixed(2), last_checked: cur?.last_checked ?? null,
  }, { onConflict: 'item_id' });
  await supabase.from('purchases').insert({
    item_id: it.id, purchase_date: TODAY, case_qty: q, total_price: p,
    cost_per_unit: +newCostPerUnit.toFixed(2), note: `บิลซื้อ${it.name} ${q} ลัง`, created_by: ME.id,
  });
  toast(`บันทึกบิล ${it.name} ${q} ลัง ${baht(p)} บาท เรียบร้อย — ต้นทุนเฉลี่ยใหม่ ${newAvg.toFixed(2)} บาท/${it.unit}`);
  purchState = { open: false, itemId: STOCK_ITEMS[0]?.id, qty: '', price: '' };
  await draw($('#roleRoot'));
}

/* ============================== ขายนอกสาขา ============================== */
let _extIssuerNames = {};
async function renderExt(body) {
  body.innerHTML = `<div class="stack" id="extBox"><div class="boot">กำลังโหลด…</div></div>`;
  const avail = await whAvailMap(STOCK_ITEMS);
  const [{ data: sales }, { data: employees }] = await Promise.all([
    supabase.from('external_sales').select('*').order('sale_date', { ascending: false }),
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
  const res = await issueExternalSale({ buyer, lines, issuerId: ME.id, stockItems: STOCK_ITEMS, avail });
  if (res.error) { toast(res.error); return; }
  S.extOpen = false; S.extBuyer = ''; S.extDraft = {};
  toast(`ออกบิลให้ ${buyer} แล้ว ${baht(res.total)} บาท`);
  await draw($('#roleRoot'));
}

/* ============================== ยอดส่งเงิน ============================== */
async function renderCash(body) {
  body.innerHTML = `<div class="stack" id="cashBox"><div class="boot">กำลังโหลด…</div></div>`;
  const round = isRoundOn(TODAY);
  const [{ data: allRemits }, { data: allOffsets }, { data: headRemits }] = await Promise.all([
    supabase.from('cash_remittances').select('*'),
    supabase.from('remit_loan_offsets').select('*'),
    supabase.from('head_remittances').select('*'),
  ]);
  const list = await Promise.all(BRANCHES.map(async b => {
    const branchRemits = (allRemits || []).filter(x => x.branch_id === b.id).sort((a, c) => a.remit_date < c.remit_date ? 1 : -1);
    const lastRemitDate = branchRemits[0]?.remit_date || null;
    const { data: records } = await supabase.from('daily_records').select('record_date,cash,float_cash,sent').eq('branch_id', b.id).eq('sent', true).gte('record_date', lastRemitDate || '2000-01-01').order('record_date', { ascending: false });
    const offset = (allOffsets || []).find(x => x.branch_id === b.id);
    const p = calc.cashPending(records || [], lastRemitDate, offset ? N(offset.amount) : 0);
    return { b, p, isToday: !!(round && round.branch_ids.includes(b.id)) };
  }));
  const todays = list.filter(x => x.isToday);
  const collected = (allRemits || []).filter(x => x.method !== 'loan').reduce((s, x) => s + N(x.amount), 0);
  const forwarded = (headRemits || []).reduce((s, x) => s + N(x.amount), 0);
  const held = collected - forwarded;

  const rowsToday = todays.map(({ b, p }) => `
    <div class="card pad">
      <div class="between" style="margin-bottom:2px"><h3>สาขา${esc(b.name)}</h3>
        <span class="bigtime" style="font-size:20px">${baht(p.amount)} <span class="sub" style="font-size:12px;font-weight:400">บาท</span></span></div>
      <p class="sub" style="margin:0 0 10px">ค้างสะสม ${p.dates.length} วัน${p.dates.length ? ' — ' + p.dates.map(fmtDate).join(' · ') : ''}</p>
      <div class="row" style="gap:8px">
        <button class="btn primary" data-remitb="${b.id}" data-remitm="cash" style="flex:1" ${p.amount <= 0 ? 'disabled' : ''}>รับเงินสดแล้ว</button>
        <button class="btn" data-remitb="${b.id}" data-remitm="transfer" style="flex:1" ${p.amount <= 0 ? 'disabled' : ''}>รับแบบโอนแทน</button>
      </div>
    </div>`).join('');

  const box = $('#cashBox');
  box.innerHTML = `
    <div class="card pad">
      <div class="between" style="margin-bottom:4px"><div class="eyebrow">เงินสดที่ถืออยู่</div><span class="sub">รวมจากทุกสาขา</span></div>
      <div class="bigtime">${baht(held)} <span class="sub" style="font-size:13px;font-weight:400">บาท</span></div>
      <p class="sub" style="margin:8px 0 10px">ส่งให้เจ้าของได้ทุกเมื่อ ไม่ต้องรอครบรอบ</p>
      <div class="row" style="gap:8px">
        <button class="btn primary" id="headRemitCash" style="flex:1" ${held <= 0 ? 'disabled' : ''}>ส่งให้เจ้าของแล้ว</button>
        <button class="btn" id="headRemitTransfer" style="flex:1" ${held <= 0 ? 'disabled' : ''}>ฝากธนาคารแล้ว</button>
      </div>
    </div>
    ${round ? `<div class="card pad" style="border-left:3px solid var(--amber)">
      <div class="eyebrow">วันนี้เป็นวันเก็บเงินสด — ${esc(round.name)}</div>
      <div class="sub" style="margin-top:2px">${round.branch_ids.map(id => (BRANCHES.find(x => x.id === id) || {}).name || id).join(' · ')}</div>
    </div>${rowsToday}` : `<div class="card pad"><p class="sub" style="margin:0">วันนี้ไม่ใช่วันรับเงินสดของสาขาไหนเลย</p></div>`}
    <p class="foot">เงินสดค้าง = เงินสดปิดร้านแต่ละวัน หักเงินทอนตั้งต้นของสาขา สะสมตั้งแต่ครั้งล่าสุดที่ส ่ง/รับไป</p>
  `;
  box.querySelectorAll('[data-remitb]').forEach(btn => btn.addEventListener('click', () => doRemitBranch(btn.dataset.remitb, btn.dataset.remitm, list)));
  const hc = $('#headRemitCash'); if (hc) hc.addEventListener('click', () => doHeadRemit('cash', held));
  const ht = $('#headRemitTransfer'); if (ht) ht.addEventListener('click', () => doHeadRemit('transfer', held));
}

async function doRemitBranch(bid, method, list) {
  const item = list.find(x => x.b.id === bid);
  if (!item || item.p.amount <= 0) { toast('ไม่มีเงินสดค้างส่ง'); return; }
  await supabase.from('cash_remittances').insert({ branch_id: bid, remit_date: TODAY, amount: item.p.amount, method });
  await supabase.from('remit_loan_offsets').upsert({ branch_id: bid, amount: 0 }, { onConflict: 'branch_id' });
  const bname = (BRANCHES.find(x => x.id === bid) || {}).name || bid;
  toast(`รับเงินจากสาขา${bname} แล้ว ${baht(item.p.amount)} บาท`);
  await draw($('#roleRoot'));
}
async function doHeadRemit(method, held) {
  if (held <= 0) { toast('ไม่มีเงินสดค้างส่ง'); return; }
  await supabase.from('head_remittances').insert({ remit_date: TODAY, amount: held, method });
  toast((method === 'cash' ? 'บันทึกว่าส่งเงินสดให้เจ้าของแล้ว ' : 'บันทึกว่าฝากธนาคารแล้ว ') + baht(held) + ' บาท');
  await draw($('#roleRoot'));
}

/* ============================== ลงเวลา (ไปแทนสาขา) ============================== */
async function renderClock(body) {
  body.innerHTML = `<div class="stack" id="clockBox"><div class="boot">กำลังโหลด…</div></div>`;
  const { data: offToday } = await supabase.from('day_offs').select('*').eq('off_date', TODAY).maybeSingle();
  const b = offToday ? BRANCHES.find(x => x.id === offToday.branch_id) : null;
  const cfg = getSettings();

  // เงินเดือนหัวหน้าประมาณการเดือนนี้ (ใช้ทุกสาขา)
  const dates = monthDates(TODAY);
  const [{ data: allRecords }, { data: allClocks }, { data: advances }, { data: whRentRows }, { data: myEmp }] = await Promise.all([
    supabase.from('daily_records').select('*').gte('record_date', dates[0]).lte('record_date', dates[dates.length - 1]),
    supabase.from('clock_records').select('*').gte('clock_date', dates[0]).lte('clock_date', dates[dates.length - 1]),
    supabase.from('advances').select('*').is('branch_id', null).eq('staff_name', ME.name),
    supabase.from('warehouse_rent_history').select('*').order('effective_from'),
    supabase.from('employees').select('*').eq('id', ME.id).maybeSingle(),
  ]);
  const allBranchClocksByDate = {};
  BRANCHES.forEach(br => { allBranchClocksByDate[br.id] = {}; });
  (allClocks || []).forEach(c => { if (!allBranchClocksByDate[c.branch_id]) allBranchClocksByDate[c.branch_id] = {}; allBranchClocksByDate[c.branch_id][c.clock_date] = c; });
  const whRentHistory = (whRentRows || []).map(r => ({ from: r.effective_from, rent: r.rent }));
  const whRent = calc.rentAt(whRentHistory, dates[0]);
  const pr = calc.payrollForRelief({
    relief: { name: ME.name, base_salary: myEmp?.base_salary ?? 9000, delivery_pay: myEmp?.delivery_pay ?? 0 },
    allBranchRecords: allRecords || [], allBranchClocksByDate, advancesForRelief: advances || [], todayISO: TODAY, cfg, whRent,
  });

  const payCard = `<div class="card pad">
      <div class="between" style="margin-bottom:2px"><div class="eyebrow">สรุปเงินเดือน (ประมาณการเดือนนี้)</div>
        <button class="mini" id="printReliefSlipBtn">ปริ้นสลิป</button></div>
      <div class="bigtime" style="margin:6px 0 2px">${baht(pr.total)} <span class="sub" style="font-size:13px;font-weight:400">บาท</span></div>
      <div class="sub" style="margin-bottom:10px">ยอดสุทธิโดยประมาณ · จ่ายจริงทุกวันที่ 5</div>
      <div class="payrows">
        <div class="payrow"><span>เงินเดือนฐาน</span><span class="n">${baht(myEmp?.base_salary ?? 0)}</span></div>
        <div class="payrow"><span>เงินส่งของ</span><span class="n">${baht(myEmp?.delivery_pay ?? 0)}</span></div>
        <div class="payrow"><span>ค่าเช่าคลังกลาง</span><span class="n">${baht(pr.whRent)}</span></div>
        <div class="payrow"><span>ค่าแก้ว (${pr.cups} ใบ)</span><span class="n">${baht(pr.cupPay)}</span></div>
        ${pr.deduct ? `<div class="payrow neg"><span>หัก ลืมลงเวลา${pr.noClock ? ` ${pr.noClock} ครั้ง × 40` : ''}</span><span class="n">−${baht(pr.deduct)}</span></div>` : ''}
        ${pr.advanceDeduct ? `<div class="payrow neg"><span>หักเบิกล่วงหน้า/เงินกู้ค้างอยู่</span><span class="n">−${baht(pr.advanceDeduct)}</span></div>` : ''}
      </div>
      <p class="sub" style="margin-top:8px">ไปทำแทนสาขาไม่หักมาสาย/ปิดไว — แต่ต้องลงเวลาให้ครบทั้งเข้าและออก ลืมหัก 40 บาท/ครั้ง</p>
    </div>`;

  const box = $('#clockBox');
  if (!b) {
    box.innerHTML = `<div class="card pad clockcard"><div class="eyebrow">ลงเวลาทำงาน</div>
        <div class="sub" style="margin:6px 0 10px">วันนี้ไม่มีสาขาที่ต้องไปแทน</div>
        <button class="btn primary big" disabled>ลงเวลาเข้า</button></div>${payCard}`;
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

  box.innerHTML = inner + payCard + `<p class="foot">วันที่ไปทำแทน หน้านี้เปิดฟอร์มปิดยอดของสาขานั้นให้กรอกได้เลย (ไม่ต้องนับสต๊อก) และแก้วที่ทำวันนั้นเข้าค่าแก้วของคุณ</p>`;
  wireClockTab(box, b, clock, rec, prev, openSet);
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
    draft: S.reliefDraft, errors: S.reliefErrors, prev, cfg: getSettings(), attr: 'rf', stockItems: null,
    intro: 'กรอกยอดขายของวันนี้แทนพนักงานประจำสาขา — ไม่ต้องนับสต๊อกวัตถุดิบ (ค่าแก้ววันนี้เข้าเงินเดือนของคุณเอง)',
  });
}

function wireClockTab(box, b, clock, rec, prev, openSet) {
  const cb = $('#reliefClockBtn'); if (cb) cb.addEventListener('click', () => doReliefClock(b, clock));
  const ocBtn = $('#rOpenCountBtn'); if (ocBtn) ocBtn.addEventListener('click', () => doReliefOpenCount(b, prev));
  box.querySelectorAll('input[data-rf]').forEach(inp => inp.addEventListener('input', () => { S.reliefDraft[inp.dataset.rf] = numIn(inp.value); }));
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
  await supabase.from('clock_records').update({ open_yen: newYen, open_pan: newPan }).eq('branch_id', b.id).eq('clock_date', TODAY);
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
  // สต๊อกวัตถุดิบใช้ของยอดปิดล่าสุด (วันไปแทนไม่ต้องนับ) แต่ "แถวแก้ว" คิดจากที่นับวันนี้ — submitClose จัดการให้แล้ว
  const { error } = await submitClose({
    branchId: b.id, dateISO: TODAY, staffName: ME.name, draft: d, cfg: getSettings(),
    stockItems: STOCK_ITEMS, prevSnapshot: prev ? prev.stock_snapshot : {}, createdBy: ME.id,
  });
  if (error) { toast('บันทึกไม่สำเร็จ: ' + error.message); return; }
  S.reliefDraft = null; S.reliefErrors = {};
  toast('บันทึกยอดแทนสาขา' + b.name + ' เรียบร้อย — ค่าแก้ววันนี้เข้าเงินเดือนของคุณ');
  await draw($('#roleRoot'));
}
