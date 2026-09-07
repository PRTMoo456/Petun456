// หน้าเจ้าของ — ภาพรวมวันนี้ / สรุปยอดสาขา (แก้ย้อนหลัง) / สต๊อก / เงินเดือน / กำไรขาดทุน / ตั้งค่า
// พอร์ตตรงจาก ownerView()/ownToday()/ownDay()/ownStock*()/ownPay()/ownPL()/ownSet() ในต้นแบบ nomicha.html
import { supabase } from '../supabaseClient.js';
import { getSettings } from '../settings.js';
import { $, N, numIn, numSet, baht, signed, esc, toast, todayISO, isoDate, fmtDate, monthKey, monthLabel, monthDates, DAYS } from '../util.js';
import { loadRefs } from '../refs.js';
import { futureDates } from '../dayoff.js';
import { whAvailMap, issueExternalSale, editExternalSale } from '../warehouse.js';
import { loadPeople, peopleCardHTML, bindPeopleCard } from './people.js';
import { getCompanies, deliveryReportHTML, deliveryMonthHTML, externalBillHTML, externalMonthHTML, staffSlipHTML, reliefSlipHTML, printDoc } from '../print.js';
import * as calc from '../calc.js';

let ME, TODAY, STOCK_ITEMS = [], BRANCHES = [], ROUNDS = [];
let S = { tab: 'today', schedMonth: null, stockNeedOnly: false, extOpen: false, extBuyer: '', extDraft: {}, extEditing: null, extEditDraft: {}, viewBranch: null, range: 7, editing: null, editDraft: {}, stockBranch: null, stockView: 'branch', stockRange: 7 };

export async function renderOwnerApp(root, me) {
  ME = me; TODAY = todayISO();
  const refs = await loadRefs();
  BRANCHES = refs.branches; STOCK_ITEMS = refs.stockItems; ROUNDS = refs.rounds;
  if (!S.viewBranch) S.viewBranch = BRANCHES[0]?.id;
  if (!S.stockBranch) S.stockBranch = BRANCHES[0]?.id;
  await draw(root);
}

async function draw(root) {
  const tabs = [['today', 'ภาพรวมวันนี้'], ['day', 'สรุปยอดสาขา'], ['sched', 'ตารางงาน'], ['stock', 'สต๊อก'], ['pay', 'เงินเดือน'], ['pl', 'กำไร/ขาดทุน'], ['set', 'ตั้งค่า']];
  root.innerHTML = `<div class="wrap">
    <div class="app-head"><div><h1>โนมิชา · ${BRANCHES.length} สาขา</h1><div class="sub">บริษัท เพตั้น จำกัด</div></div></div>
    <div class="owner-tabs">${tabs.map(t => `<button data-otab="${t[0]}" aria-pressed="${S.tab === t[0]}">${t[1]}</button>`).join('')}</div>
    <div id="ownBody"><div class="boot">กำลังโหลด…</div></div>
  </div>`;
  root.querySelectorAll('[data-otab]').forEach(btn => btn.addEventListener('click', () => { S.tab = btn.dataset.otab; loadTab(); }));
  await loadTab();
}

async function loadTab() {
  const body = $('#ownBody'); if (!body) return;
  if (S.tab === 'today') return renderToday(body);
  if (S.tab === 'day') return renderDay(body);
  if (S.tab === 'sched') return renderSched(body);
  if (S.tab === 'stock') return renderStock(body);
  if (S.tab === 'pay') return renderPay(body);
  if (S.tab === 'pl') return renderPL(body);
  return renderSet(body);
}

/* ============================== ภาพรวมวันนี้ ============================== */
async function renderToday(body) {
  body.innerHTML = `<div class="boot">กำลังโหลด…</div>`;
  const cfg = getSettings();
  const [{ data: records }, { data: clocks }, { data: pendingRC }] = await Promise.all([
    supabase.from('daily_records').select('*').eq('record_date', TODAY),
    supabase.from('clock_records').select('*').eq('clock_date', TODAY),
    supabase.from('recount_requests').select('*').eq('status', 'pending'),
  ]);
  const recs = BRANCHES.map(b => {
    const r = (records || []).find(x => x.branch_id === b.id);
    const c = (clocks || []).find(x => x.branch_id === b.id);
    const cc = (r && r.sent) ? calc.calcDay(r, c, cfg) : null;
    return { b, r, cc };
  });
  const sent = recs.filter(x => x.cc);
  const totalSales = sent.reduce((s, x) => s + x.cc.income - x.cc.expense, 0);
  const totalCups = sent.reduce((s, x) => s + x.cc.cups, 0);
  const flags = sent.filter(x => Math.abs(x.cc.variance) >= 50);
  const totalVar = sent.reduce((s, x) => s + x.cc.variance, 0);

  const cards = recs.map(({ b, r, cc }) => {
    if (!cc) return `<div class="bcard pending" data-gob="${b.id}" style="cursor:pointer"><div class="between"><h4>${esc(b.name)}</h4><span class="pill wait">ยังไม่ส่ง</span></div><div class="sub">รอปิดยอด</div></div>`;
    const bad = Math.abs(cc.variance) >= 50;
    return `<div class="bcard ${bad ? 'alert' : ''}" data-gob="${b.id}" style="cursor:pointer">
      <div class="between"><h4>${esc(b.name)}</h4>
        ${cc.variance === 0 ? '<span class="pill ok">ตรง</span>' : `<span class="pill ${bad ? 'bad' : 'warn'}">${cc.variance < 0 ? 'ขาด' : 'เกิน'} ${baht(Math.abs(cc.variance))}</span>`}</div>
      <div class="money">${baht(cc.income - cc.expense)} <span class="sub" style="font-size:12px">บาท</span></div>
      <div class="meta"><span>${esc(r.staff_name)}</span><span>${cc.cups} แก้ว</span></div>
    </div>`;
  }).join('');

  body.innerHTML = `${(pendingRC || []).length ? `<div class="card pad" style="border-left:3px solid var(--bad);margin-bottom:16px">
      <div class="eyebrow">⚠ คำขอตรวจสอบยอดแก้ว (${pendingRC.length})</div>
      <p class="sub" style="margin:6px 0 10px">นับแก้วก่อนเริ่มขายแล้วไม่ตรงกับยอดปิดเมื่อวาน — ${pendingRC.map(r => {
        const b = BRANCHES.find(x => x.id === r.branch_id); return `${esc(b ? b.name : r.branch_id)} (${esc(r.staff_name)})`;
      }).join(' · ')}</p>
      <button class="btn primary" id="goRecountBtn" data-b="${pendingRC[0].branch_id}">ไปตรวจสอบ</button>
    </div>` : ''}
    <div class="kpis">
      <div class="card kpi"><div class="eyebrow">ยอดขายรวมวันนี้</div><div class="v">${baht(totalSales)}</div></div>
      <div class="card kpi"><div class="eyebrow">แก้วรวม</div><div class="v">${baht(totalCups)}</div></div>
      <div class="card kpi"><div class="eyebrow">ส่งยอดแล้ว</div><div class="v">${sent.length} / ${BRANCHES.length}</div></div>
      <div class="card kpi ${flags.length ? 'flag' : ''}"><div class="eyebrow">สาขาที่ต้องดู</div><div class="v">${flags.length}</div></div>
      <div class="card kpi ${totalVar < 0 ? 'flag' : ''}"><div class="eyebrow">ผลต่างเงินสดรวม</div><div class="v">${signed(totalVar)}</div></div>
    </div>
    ${flags.length ? `<div class="note" style="margin-bottom:16px"><b>ต้องตรวจ</b> — ${flags.map(f => esc(f.b.name) + ' ' + (f.cc.variance < 0 ? 'ขาด ' : 'เกิน ') + baht(Math.abs(f.cc.variance))).join(' · ')}</div>` : ''}
    <div class="bcards">${cards}</div>
    <p class="foot">พนักงานไม่เห็นตัวเลขผลต่างนี้ — เห็นเฉพาะยอดแก้วเมื่อวานกับแก้วสะสมของตัวเอง</p>`;
  const g = $('#goRecountBtn'); if (g) g.addEventListener('click', () => { S.tab = 'day'; S.viewBranch = g.dataset.b; loadTab(); });
  body.querySelectorAll('[data-gob]').forEach(card => card.addEventListener('click', () => {
    S.tab = 'day'; S.viewBranch = card.dataset.gob;
    document.querySelectorAll('[data-otab]').forEach(b2 => b2.setAttribute('aria-pressed', String(b2.dataset.otab === 'day')));
    loadTab();
  }));
}

/* ============================== สรุปยอดสาขา (แก้ย้อนหลัง) ============================== */
function dateRange(days) {
  const out = []; const d0 = new Date(TODAY + 'T00:00:00');
  const n = days === 'month' ? d0.getDate() : days;
  // isoDate() ไม่ใช่ toISOString() — ที่ไทยจะได้วันที่เลื่อนไป 1 วัน ทำให้ตารางสรุปยอดดึงข้อมูลผิดวัน
  for (let i = 0; i < n; i++) { const d = new Date(d0); d.setDate(d0.getDate() - i); out.push(isoDate(d)); }
  return out; // วันนี้ก่อน ไล่ย้อนหลัง
}

async function renderDay(body) {
  body.innerHTML = `<div class="boot">กำลังโหลด…</div>`;
  const cfg = getSettings();
  const b = BRANCHES.find(x => x.id === S.viewBranch) || BRANCHES[0];
  const days = dateRange(S.range);
  const [{ data: records }, { data: clocks }, { data: pendingRC }, { data: rcLogAll }] = await Promise.all([
    supabase.from('daily_records').select('*').eq('branch_id', b.id).gte('record_date', days[days.length - 1]).lte('record_date', days[0]),
    supabase.from('clock_records').select('*').eq('branch_id', b.id).gte('clock_date', days[days.length - 1]).lte('clock_date', days[0]),
    supabase.from('recount_requests').select('*').eq('branch_id', b.id).eq('status', 'pending'),
    supabase.from('recount_requests').select('*').eq('branch_id', b.id).neq('status', 'pending').order('requested_at', { ascending: false }).limit(5),
  ]);
  const clocksByDate = {}; (clocks || []).forEach(c => { clocksByDate[c.clock_date] = c; });
  const recByDate = {}; (records || []).forEach(r => { recByDate[r.record_date] = r; });
  // ดึงประวัติแก้ไขแยกทีหลังด้วย record_id ตรง ๆ (ไม่พึ่งการกรองผ่านตารางที่ join มา — ชัวร์กว่าตอน deploy จริง)
  const recordIds = (records || []).map(r => r.id);
  const { data: edits } = recordIds.length
    ? await supabase.from('record_edit_history').select('*').in('record_id', recordIds).order('edited_at', { ascending: false })
    : { data: [] };
  const dateOfRec = {}; (records || []).forEach(r => { dateOfRec[r.id] = r.record_date; });

  let sumSales = 0, sumCups = 0, sumVar = 0, missing = 0;
  const sum = { yenAdd: 0, panAdd: 0, extraIn: 0, expense: 0, expectedTotal: 0, cash: 0, tf: 0, grab: 0, tct: 0, days: 0 };
  days.forEach(d => {
    const r = recByDate[d]; if (!r || !r.sent) { missing++; return; }
    const c = calc.calcDay(r, clocksByDate[d], cfg);
    sumSales += c.income - c.expense; sumCups += c.cups; sumVar += c.variance; sum.days++;
    sum.yenAdd += N(r.yen_add); sum.panAdd += N(r.pan_add); sum.extraIn += N(r.cup_own) + N(r.topping) + N(r.other);
    sum.expense += c.expense; sum.expectedTotal += c.expectedTotal; sum.cash += N(r.cash); sum.tf += N(r.transfer); sum.grab += N(r.grab); sum.tct += N(r.thaichaithai);
  });

  const rows = days.map(d => {
    const r = recByDate[d];
    if (!r || !r.sent) return `<tr><td>${fmtDate(d)}</td><td colspan="14" style="text-align:left;color:var(--muted)">ยังไม่ส่งยอด</td></tr>`;
    const c = calc.calcDay(r, clocksByDate[d], cfg);
    const ed = (edits || []).filter(e => e.record_id === r.id);
    const editing = S.editing === r.id;
    const vc = c.variance < 0 ? 'neg' : c.variance > 0 ? 'pos' : 'n';
    const extraIn = N(r.cup_own) + N(r.topping) + N(r.other);
    if (editing) {
      const inp = (k, v) => `<input class="cellin" data-ek="${k}" inputmode="numeric" value="${v}">`;
      return `<tr class="editing"><td>${fmtDate(d)}</td><td>${esc(r.staff_name)}</td>
        <td>${inp('yen', r.yen)}</td><td>${inp('yen_add', r.yen_add)}</td>
        <td>${inp('pan', r.pan)}</td><td>${inp('pan_add', r.pan_add)}</td>
        <td class="n">${baht(extraIn)}</td><td class="n">${baht(c.expense)}</td>
        <td class="n">${baht(c.expectedTotal)}</td>
        <td>${inp('cash', r.cash)}</td><td>${inp('transfer', r.transfer)}</td>
        <td>${inp('grab', r.grab)}</td><td>${inp('thaichaithai', r.thaichaithai)}</td>
        <td class="n">${c.cups}</td>
        <td><span class="row" style="justify-content:flex-end;gap:6px">
          <button class="mini go" data-save="${r.id}">บันทึก</button>
          <button class="mini" data-canceledit="1">ยกเลิก</button></span></td></tr>`;
    }
    return `<tr><td>${fmtDate(d)}${ed.length ? ` <span class="editmark" title="${esc(ed.map(e => e.label).join(' · '))}">แก้ไขแล้ว</span>` : ''}</td>
      <td>${esc(r.staff_name)}</td>
      <td class="n">${r.yen}</td><td class="n">${N(r.yen_add) || '–'}</td>
      <td class="n">${r.pan}</td><td class="n">${N(r.pan_add) || '–'}</td>
      <td class="n">${extraIn ? baht(extraIn) : '–'}</td><td class="n">${c.expense ? baht(c.expense) : '–'}</td>
      <td class="n" style="font-weight:600">${baht(c.expectedTotal)}</td>
      <td class="n">${baht(r.cash)}</td><td class="n">${baht(r.transfer)}</td>
      <td class="n">${baht(r.grab)}</td><td class="n">${baht(r.thaichaithai)}</td>
      <td class="n" style="font-weight:600">${c.cups}</td>
      <td class="n ${vc}">${signed(c.variance)} <button class="mini" data-edit="${r.id}" title="แก้ไขตัวเลข">แก้</button></td></tr>`;
  }).join('');

  const rcCard = (pendingRC || []).length ? `<div class="card pad" style="border-left:3px solid var(--bad);margin-bottom:16px">
      <div class="eyebrow">⚠ คำขอตรวจสอบยอดแก้ว</div>
      ${pendingRC.map(r => `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
        <p class="sub" style="margin:0 0 6px">${esc(r.staff_name)} นับแก้วก่อนเริ่มขาย ${fmtDate(r.request_date)} ไม่ตรงกับยอดปิดก่อนหน้า —
          แก้วเย็น ${r.old_yen} → ${r.new_yen} · แก้วปั่น ${r.old_pan} → ${r.new_pan}
          <b style="color:${r.value_diff < 0 ? 'var(--bad)' : 'var(--brand)'}">(${signed(r.value_diff)} บาท)</b></p>
        <span class="row" style="gap:8px">
          <button class="btn primary" data-approverc="${r.id}">อนุมัติ — บันทึกทับ</button>
          <button class="btn" data-rejectrc="${r.id}">ไม่อนุมัติ</button>
        </span></div>`).join('')}
    </div>` : '';
  const rcLogRows = (rcLogAll || []).map(r => `<div class="logline"><span class="sub">${fmtDate(r.request_date)}</span>
    ยอดนับแก้ว: ${r.old_yen}/${r.old_pan} → ${r.new_yen}/${r.new_pan}
    ${r.status === 'approved' ? '<b>อนุมัติ — บันทึกทับแล้ว</b>' : `<b>ไม่อนุมัติ</b> (ส่วนต่าง ${signed(r.value_diff)} บาท)`}</div>`).join('');

  body.innerHTML = `${rcCard}<div class="between" style="margin-bottom:14px;flex-wrap:wrap">
      <span class="row">
        <select id="bviewSel" class="ctl">${BRANCHES.map(x => `<option value="${x.id}" ${x.id === b.id ? 'selected' : ''}>สาขา${esc(x.name)}</option>`).join('')}</select>
        <span class="seg2">
          <button data-range="7" aria-pressed="${S.range === 7}">7 วัน</button>
          <button data-range="14" aria-pressed="${S.range === 14}">14 วัน</button>
          <button data-range="month" aria-pressed="${S.range === 'month'}">เดือนนี้</button>
        </span>
      </span>
    </div>
    <div class="kpis">
      <div class="card kpi"><div class="eyebrow">ยอดขายรวม</div><div class="v">${baht(sumSales)}</div></div>
      <div class="card kpi"><div class="eyebrow">แก้วรวม</div><div class="v">${baht(sumCups)}</div></div>
      <div class="card kpi ${sumVar < 0 ? 'flag' : ''}"><div class="eyebrow">ผลต่างสะสม</div><div class="v">${signed(sumVar)}</div></div>
      <div class="card kpi ${missing ? 'flag' : ''}"><div class="eyebrow">วันที่ยังไม่ส่ง</div><div class="v">${missing}</div></div>
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th>วันที่</th><th>ชื่อคนขาย</th><th>แก้วเย็น</th><th>เพิ่มแก้วเย็น</th><th>แก้วปั่น</th><th>เพิ่มแก้วปั่น</th>
        <th>รายได้เพิ่ม</th><th>รายจ่ายเพิ่ม</th><th>ยอดคำนวณ</th><th>ยอดเงินสด</th><th>เงินโอน</th><th>แกร๊บ</th><th>ไทยช่วยไทย</th><th>ยอดแก้ว</th><th>ขาดเกิน</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="font-weight:700;border-top:2px solid var(--line-2)">
        <td>รวม ${sum.days} วัน</td><td></td><td class="n">–</td><td class="n">${sum.yenAdd || '–'}</td><td class="n">–</td><td class="n">${sum.panAdd || '–'}</td>
        <td class="n">${sum.extraIn ? baht(sum.extraIn) : '–'}</td><td class="n">${sum.expense ? baht(sum.expense) : '–'}</td>
        <td class="n">${baht(sum.expectedTotal)}</td><td class="n">${baht(sum.cash)}</td><td class="n">${baht(sum.tf)}</td><td class="n">${baht(sum.grab)}</td><td class="n">${baht(sum.tct)}</td>
        <td class="n">${baht(sumCups)}</td><td class="n ${sumVar < 0 ? 'neg' : sumVar > 0 ? 'pos' : ''}">${signed(sumVar)}</td></tr></tfoot></table></div>
    <p class="foot">กด <b>แก้</b> ท้ายแถวเพื่อแก้ตัวเลขที่พนักงานกรอกผิด — ระบบคิดขาด/เกินใหม่ให้ทันที และจดประวัติไว้</p>
    <h3 style="margin:22px 0 10px">ประวัติการแก้ไขย้อนหลัง</h3>
    <div class="tablewrap"><table><thead><tr><th>วันที่ยอด</th><th>รายการที่แก้</th><th>เมื่อไร</th></tr></thead>
      <tbody>${(edits || []).slice(0, 30).map(e => `<tr>
        <td>${dateOfRec[e.record_id] ? fmtDate(dateOfRec[e.record_id]) : '—'}</td>
        <td>${esc(e.label)}</td>
        <td class="sub">${e.edited_at ? fmtDate(String(e.edited_at).slice(0, 10)) + ' ' + String(e.edited_at).slice(11, 16) : '—'}</td></tr>`).join('')
        || '<tr><td colspan="3" class="sub">ยังไม่เคยแก้ยอดของสาขานี้ในช่วงที่เลือก</td></tr>'}</tbody></table></div>
    <p class="foot">เก็บทุกครั้งที่แก้ยอดย้อนหลัง ใครแก้ แก้อะไร จากเท่าไรเป็นเท่าไร — ใช้ตรวจย้อนหลังได้ว่าตัวเลขเปลี่ยนเพราะอะไร</p>
    ${rcLogRows ? `<div class="card pad" style="margin-top:16px"><div class="eyebrow">ประวัติคำขอตรวจสอบยอดแก้ว</div><div style="margin-top:8px">${rcLogRows}</div></div>` : ''}`;

  $('#bviewSel').addEventListener('change', e => { S.viewBranch = e.target.value; S.editing = null; loadTab(); });
  body.querySelectorAll('[data-range]').forEach(btn => btn.addEventListener('click', () => { S.range = btn.dataset.range === 'month' ? 'month' : +btn.dataset.range; loadTab(); }));
  body.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => { S.editing = btn.dataset.edit; S.editDraft = {}; loadTab(); }));
  body.querySelectorAll('[data-canceledit]').forEach(btn => btn.addEventListener('click', () => { S.editing = null; loadTab(); }));
  body.querySelectorAll('input[data-ek]').forEach(inp => inp.addEventListener('input', () => { S.editDraft[inp.dataset.ek] = numIn(inp.value); }));
  body.querySelectorAll('[data-save]').forEach(btn => btn.addEventListener('click', () => saveEdit(btn.dataset.save, cfg)));
  body.querySelectorAll('[data-approverc]').forEach(btn => btn.addEventListener('click', () => approveRecount(btn.dataset.approverc)));
  body.querySelectorAll('[data-rejectrc]').forEach(btn => btn.addEventListener('click', () => rejectRecount(btn.dataset.rejectrc)));
}

const FIELD_TH = { yen: 'แก้วเย็น', yen_add: 'เพิ่มแก้วเย็น', pan: 'แก้วปั่น', pan_add: 'เพิ่มแก้วปั่น', cash: 'ยอดเงินสด', transfer: 'เงินโอน', grab: 'แกร๊บ', thaichaithai: 'ไทยช่วยไทย' };

// พอร์ตจาก saveEdit() — ตรวจความเป็นไปได้ทางกายภาพก่อนบันทึกเสมอ แล้วจดประวัติการแก้ไข
async function saveEdit(recordId, cfg) {
  const { data: rec } = await supabase.from('daily_records').select('*').eq('id', recordId).single();
  if (!rec) { S.editing = null; loadTab(); return; }
  const d = S.editDraft || {};
  const nv = f => (d[f] != null && d[f] !== '') ? N(d[f]) : N(rec[f]);
  const { data: clock } = await supabase.from('clock_records').select('*').eq('branch_id', rec.branch_id).eq('clock_date', rec.record_date).maybeSingle();
  const baseYen = clock ? clock.open_yen : null, basePan = clock ? clock.open_pan : null;
  const neg = ['yen', 'yen_add', 'pan', 'pan_add', 'cash', 'transfer', 'grab', 'thaichaithai'].find(f => nv(f) < 0);
  if (neg) { toast(`${FIELD_TH[neg]} ติดลบไม่ได้`); return; }
  if (baseYen != null && nv('yen') > baseYen + nv('yen_add')) { toast(`แก้วเย็นเหลือมากกว่าที่มี — ตั้งต้น ${baseYen} + เติม ${nv('yen_add')} = ${baseYen + nv('yen_add')} ใบ`); return; }
  if (basePan != null && nv('pan') > basePan + nv('pan_add')) { toast(`แก้วปั่นเหลือมากกว่าที่มี — ตั้งต้น ${basePan} + เติม ${nv('pan_add')} = ${basePan + nv('pan_add')} ใบ`); return; }

  const patch = {}; const historyWrites = [];
  Object.keys(d).forEach(f => {
    if (d[f] === '' || d[f] == null) return;
    if (N(rec[f]) !== N(d[f])) {
      patch[f] = N(d[f]);
      historyWrites.push(supabase.from('record_edit_history').insert({
        record_id: rec.id, field: f, from_value: String(rec[f]), to_value: String(N(d[f])),
        label: `${FIELD_TH[f]} ${baht(N(rec[f]))} → ${baht(N(d[f]))}`, edited_by: ME.id,
      }));
    }
  });
  if (!Object.keys(patch).length) { toast('ไม่มีอะไรเปลี่ยน'); S.editing = null; loadTab(); return; }
  const newYen = patch.yen ?? rec.yen, newPan = patch.pan ?? rec.pan;
  const snap = { ...(rec.stock_snapshot || {}) };
  if (STOCK_ITEMS[0]) snap[STOCK_ITEMS[0].id] = Math.floor(N(newYen) / cfg.cupsPerRow.yen);
  if (STOCK_ITEMS[1]) snap[STOCK_ITEMS[1].id] = Math.floor(N(newPan) / cfg.cupsPerRow.pan);
  patch.stock_snapshot = snap;
  await supabase.from('daily_records').update(patch).eq('id', rec.id);
  await Promise.all(historyWrites);
  toast(`แก้ไขแล้ว ${historyWrites.length} ช่อง — คิดขาด/เกินใหม่ให้แล้ว`);
  S.editing = null; S.editDraft = {};
  loadTab();
}

async function approveRecount(id) {
  const { data: req } = await supabase.from('recount_requests').select('*').eq('id', id).single();
  if (!req || req.status !== 'pending') return;
  if (req.prev_record_id) {
    const { data: rec } = await supabase.from('daily_records').select('*').eq('id', req.prev_record_id).single();
    if (rec) {
      const writes = [];
      if (N(rec.yen) !== req.new_yen) writes.push(supabase.from('record_edit_history').insert({ record_id: rec.id, field: 'yen', from_value: String(rec.yen), to_value: String(req.new_yen), label: `แก้วเย็น (นับใหม่) ${baht(rec.yen)} → ${baht(req.new_yen)}`, edited_by: ME.id }));
      if (N(rec.pan) !== req.new_pan) writes.push(supabase.from('record_edit_history').insert({ record_id: rec.id, field: 'pan', from_value: String(rec.pan), to_value: String(req.new_pan), label: `แก้วปั่น (นับใหม่) ${baht(rec.pan)} → ${baht(req.new_pan)}`, edited_by: ME.id }));
      const cfg = getSettings();
      const snap = { ...(rec.stock_snapshot || {}) };
      if (STOCK_ITEMS[0]) snap[STOCK_ITEMS[0].id] = Math.floor(N(req.new_yen) / cfg.cupsPerRow.yen);
      if (STOCK_ITEMS[1]) snap[STOCK_ITEMS[1].id] = Math.floor(N(req.new_pan) / cfg.cupsPerRow.pan);
      await supabase.from('daily_records').update({ yen: req.new_yen, pan: req.new_pan, stock_snapshot: snap }).eq('id', rec.id);
      await Promise.all(writes);
    }
  }
  await supabase.from('recount_requests').update({ status: 'approved', resolved_at: new Date().toISOString() }).eq('id', id);
  toast('อนุมัติแล้ว — บันทึกยอดนับใหม่ทับยอดเดิมเรียบร้อย');
  loadTab();
}
async function rejectRecount(id) {
  const { data: req } = await supabase.from('recount_requests').select('*').eq('id', id).single();
  if (!req || req.status !== 'pending') return;
  const { data: clock } = await supabase.from('clock_records').select('*').eq('branch_id', req.branch_id).eq('clock_date', req.request_date).maybeSingle();
  if (clock && clock.open_yen === req.new_yen && clock.open_pan === req.new_pan) {
    await supabase.from('clock_records').update({ open_yen: req.old_yen, open_pan: req.old_pan }).eq('branch_id', req.branch_id).eq('clock_date', req.request_date);
  }
  await supabase.from('recount_requests').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', id);
  toast(`ไม่อนุมัติ — กลับไปใช้ยอดเดิม (ส่วนต่าง ${signed(req.value_diff)} บาท บันทึกไว้อ้างอิง)`);
  loadTab();
}


/* ============================== ตารางงาน (พอร์ตจาก ownSched ในต้นแบบ) ==============================
   ดูว่าเดือนนี้ใครจองหยุดวันไหน หัวหน้าต้องไปแทนที่ไหน และวันไหนเป็นวันส่งของ (ห้ามหยุด) */
async function renderSched(body) {
  body.innerHTML = `<div class="boot">กำลังโหลด…</div>`;
  const future = futureDates(TODAY, 31);
  const [{ data: dayOffs }, { data: reliefOffs }, { data: employees }] = await Promise.all([
    supabase.from('day_offs').select('*').gte('off_date', TODAY).lte('off_date', future[future.length - 1]),
    supabase.from('relief_day_offs').select('*').gte('off_date', TODAY).lte('off_date', future[future.length - 1]),
    supabase.from('employees').select('*'),
  ]);
  const offBy = {}; (dayOffs || []).forEach(o => { offBy[o.off_date] = o.branch_id; });
  const headOff = new Set((reliefOffs || []).map(o => o.off_date));
  const relief = (employees || []).find(e => e.role === 'relief');
  const staffOf = bid => (employees || []).find(e => e.branch_id === bid && e.role === 'staff')?.name || '(ยังไม่ผูกบัญชี)';
  const roundOn = d => ROUNDS.find(r => r.day_of_week === new Date(d + 'T00:00:00').getDay());

  const months = []; future.forEach(d => { const mk = monthKey(d); if (!months.some(m => m.mk === mk)) months.push({ mk, label: monthLabel(d) }); });
  const curMk = (S.schedMonth && months.some(m => m.mk === S.schedMonth)) ? S.schedMonth : months[0].mk;
  const inMonth = future.filter(d => monthKey(d) === curMk);

  const rows = inMonth.map(d => {
    const bid = offBy[d], r = roundOn(d);
    const b = bid ? BRANCHES.find(x => x.id === bid) : null;
    return `<tr><td>${fmtDate(d)} <span class="sub">${DAYS[new Date(d + 'T00:00:00').getDay()]}</span></td>
      <td>${r ? '<span class="sub">ส่งของ — ห้ามหยุด</span>'
        : b ? `สาขา${esc(b.name)} — ${esc(staffOf(bid))}` : '<span class="sub">ไม่มีใครหยุด</span>'}</td>
      <td>${headOff.has(d) ? '<span class="pill warn">หยุด</span>' : b ? esc(relief?.name || 'หัวหน้า') : '<span class="sub">—</span>'}</td>
      <td>${r ? `<span class="pill warn">${esc(r.name)}</span>` : ''}</td></tr>`;
  }).join('');

  const quota = BRANCHES.map(b => {
    const used = inMonth.filter(d => offBy[d] === b.id).length;
    return `<div class="setrow"><span>${esc(staffOf(b.id))} <span class="sub">${esc(b.name)}</span></span>
      <span class="n">${used} / ${b.days_off_quota} วัน</span></div>`;
  }).join('');
  const headUsed = inMonth.filter(d => headOff.has(d)).length;

  body.innerHTML = `<div class="between" style="margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">ตารางงาน — ${esc(months.find(m => m.mk === curMk).label)}</h3>
      <span class="seg2">${months.map(m => `<button data-schedmonth="${m.mk}" aria-pressed="${m.mk === curMk}">${esc(m.label)}</button>`).join('')}</span>
    </div>
    <div class="card pad" style="margin-bottom:16px">
      <h3 style="margin-bottom:8px">โควตาวันหยุดที่จองแล้ว</h3>
      ${quota}
      <div class="setrow" style="border-top:1px solid var(--line-2);margin-top:2px;padding-top:10px">
        <span>${esc(relief?.name || 'หัวหน้า')} <span class="sub">หัวหน้า</span></span>
        <span class="n">${headUsed} / ${relief?.days_off_quota ?? 4} วัน</span></div>
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th>วันที่</th><th>สาขาที่หยุด</th><th>หัวหน้า</th><th>รอบส่งของ</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="sub">ไม่มีวันที่ในเดือนนี้ในช่วงจองล่วงหน้า</td></tr>'}</tbody></table></div>
    <p class="foot">วันหนึ่งให้หยุดได้สาขาเดียว เพราะมีหัวหน้าคนเดียว — พนักงานและหัวหน้าจองเองในแอป ระบบกันวันซ้ำให้ ·
      <b>วันส่งของห้ามใครหยุด</b> ระบบกันไว้ให้ตั้งแต่ตอนจอง · แสดงเฉพาะวันที่อยู่ในช่วง 31 วันข้างหน้าของเดือนนั้น</p>`;
  body.querySelectorAll('[data-schedmonth]').forEach(btn => btn.addEventListener('click', () => { S.schedMonth = btn.dataset.schedmonth; renderSched(body); }));
}

/* ============================== สต๊อก ============================== */
async function renderStock(body) {
  const seg = `<span class="seg2">
      <button data-stockview="branch" aria-pressed="${S.stockView === 'branch'}">รายสาขา</button>
      <button data-stockview="wh" aria-pressed="${S.stockView === 'wh'}">คลังกลาง</button>
      <button data-stockview="deliveries" aria-pressed="${S.stockView === 'deliveries'}">รายงานส่งของ</button>
    </span>`;
  body.innerHTML = `<div id="stockInner"><div class="boot">กำลังโหลด…</div></div>`;
  await renderStockView(seg);
  body.querySelectorAll('[data-stockview]').forEach(btn => btn.addEventListener('click', () => { S.stockView = btn.dataset.stockview; renderStockView(seg); }));
}

async function renderStockView(seg) {
  const el = $('#stockInner'); if (!el) return;
  if (S.stockView === 'wh') return renderStockWh(el, seg);
  if (S.stockView === 'deliveries') return renderStockDeliveries(el, seg);
  return renderStockBranch(el, seg);
}

function stockHeadBar(seg, b, extra) {
  return `<div class="between" style="margin-bottom:14px;flex-wrap:wrap">${seg}
      <span class="row" style="flex-wrap:wrap;row-gap:8px">
        <select id="sviewSel" class="ctl">${BRANCHES.map(x => `<option value="${x.id}" ${x.id === b.id ? 'selected' : ''}>สาขา${esc(x.name)}</option>`).join('')}</select>
        ${extra || ''}
      </span>
    </div>`;
}

async function renderStockBranch(el, seg) {
  const b = BRANCHES.find(x => x.id === S.stockBranch) || BRANCHES[0];
  const cols = dateRange(S.stockRange); // วันนี้ก่อน ไล่ย้อนหลัง
  const [{ data: records }, { data: par }, { data: before }] = await Promise.all([
    supabase.from('daily_records').select('record_date,stock_snapshot,sent').eq('branch_id', b.id).gte('record_date', cols[cols.length - 1]).lte('record_date', cols[0]),
    supabase.from('stock_par_levels').select('*').eq('branch_id', b.id),
    supabase.from('daily_records').select('record_date,stock_snapshot,sent').eq('branch_id', b.id).eq('sent', true)
      .lt('record_date', cols[cols.length - 1]).order('record_date', { ascending: false }).limit(1),
  ]);
  const parByItemId = {}; (par || []).forEach(p => { parByItemId[p.item_id] = p.par_qty; });
  const snapByDate = {}; (records || []).forEach(r => { if (r.sent) snapByDate[r.record_date] = r.stock_snapshot; });
  // ยกยอดวันก่อนหน้ามาให้วันที่ยังไม่ปิดยอด (พอร์ตจาก stockAt() ในต้นแบบ)
  // เดิมวันที่ยังไม่ปิดยอดเป็น null ทั้งแถว ทำให้ช่อง "เหลือ" ว่าง และ "ต้องเติม" กลายเป็นเท่ากับ par เต็มจำนวนทุกรายการ
  // (เจ้าของอ่านแล้วสั่งของเกิน) และยอด "ใช้ไป" ที่คร่อมวันว่างก็หายไปทั้งก้อน
  let carry = (before && before[0]) ? before[0].stock_snapshot : null;
  const stockOfDate = {};
  [...cols].reverse().forEach(d => { if (snapByDate[d]) carry = snapByDate[d]; stockOfDate[d] = carry; });
  const colStocks = cols.map(d => stockOfDate[d] || null);

  const rows = STOCK_ITEMS.map(it => {
    const vals = colStocks.map(st => st ? (st[it.id] ?? null) : null);
    let used = 0;
    for (let i = cols.length - 1; i > 0; i--) {
      const older = vals[i], newer = vals[i - 1];
      if (older == null || newer == null) continue;
      if (newer < older) used += older - newer;
    }
    const now = vals[0];
    const low = now != null && now <= it.min_qty;
    const need = Math.max(0, (parByItemId[it.id] ?? 0) - (now || 0));
    return { it, now, used, need, low, vals };
  });
  const st0 = colStocks[0];
  const lows = st0 ? STOCK_ITEMS.filter(it => (st0[it.id] ?? 0) <= it.min_qty).length : 0;
  const needs = st0 ? STOCK_ITEMS.filter(it => (parByItemId[it.id] ?? 0) - (st0[it.id] ?? 0) > 0).length : 0;
  const shown = S.stockNeedOnly ? rows.filter(r => r.need > 0) : rows;
  const rowsHTML = shown.map(({ it, now, used, need, low, vals }) => `<tr>
      <td>${esc(it.name)} <span class="sub">(${esc(it.unit)})</span></td>
      <td class="n ${low ? 'low' : ''}">${now == null ? '–' : now}</td>
      <td class="n" style="font-weight:600">${used || '–'}</td>
      <td class="n ${need ? 'pos' : ''}">${need || '–'}</td>
      ${vals.map(v => `<td class="n">${v == null ? '–' : v}</td>`).join('')}
    </tr>`).join('');

  el.innerHTML = `${stockHeadBar(seg, b, `<span class="seg2">
        <button data-srange="7" aria-pressed="${S.stockRange === 7}">7 วัน</button>
        <button data-srange="14" aria-pressed="${S.stockRange === 14}">14 วัน</button>
        <button data-srange="month" aria-pressed="${S.stockRange === 'month'}">เดือนนี้</button>
      </span>
      <button class="mini ${S.stockNeedOnly ? 'go' : ''}" id="needOnlyBtn">${S.stockNeedOnly ? 'แสดงทุกรายการ' : 'เฉพาะที่ต้องเติม'}</button>
      <span style="display:none">
      </span>`)}
    <div class="kpis">
      <div class="card kpi"><div class="eyebrow">รายการที่ติดตาม</div><div class="v">${STOCK_ITEMS.length}</div></div>
      <div class="card kpi ${lows ? 'flag' : ''}"><div class="eyebrow">ถึงจุดสั่ง</div><div class="v">${lows}</div></div>
      <div class="card kpi"><div class="eyebrow">ต้องเติมรอบหน้า</div><div class="v">${needs}</div></div>
    </div>
    <div class="tablewrap" style="max-height:72vh;overflow-y:auto"><table class="stockhist">
      <thead><tr><th>วัตถุดิบ</th><th>เหลือ</th><th>ใช้ไป</th><th>ต้องเติม</th>
        ${cols.map(d => `<th>${DAYS[new Date(d + 'T00:00:00').getDay()]} ${new Date(d + 'T00:00:00').getDate()}</th>`).join('')}</tr></thead>
      <tbody>${rowsHTML}</tbody></table></div>
    <p class="foot">${S.stockNeedOnly ? `กรองอยู่: เฉพาะที่ต้องเติม (${rows.filter(r => r.need > 0).length} จาก ${rows.length} รายการ) · ` : ''}"ใช้ไป" นับเฉพาะขาลงของยอดคงเหลือ · "ต้องเติม" = ระดับที่ตั้งไว้ต่อรอบ − ที่เหลืออยู่ (ใบจัดของของหัวหน้า) · แก้ราคาส่งสาขา/ระดับที่ต้องมีได้ที่แท็บตั้งค่า</p>`;
  $('#sviewSel').addEventListener('change', e => { S.stockBranch = e.target.value; renderStockView(seg); });
  const nb = $('#needOnlyBtn'); if (nb) nb.addEventListener('click', () => { S.stockNeedOnly = !S.stockNeedOnly; renderStockView(seg); });
  el.querySelectorAll('[data-srange]').forEach(btn => btn.addEventListener('click', () => { S.stockRange = btn.dataset.srange === 'month' ? 'month' : +btn.dataset.srange; renderStockView(seg); }));
}

async function renderStockWh(el, seg) {
  const { data: stock } = await supabase.from('warehouse_stock').select('*');
  const byId = {}; (stock || []).forEach(s => { byId[s.item_id] = s; });
  const rows = STOCK_ITEMS.map(it => {
    const row = byId[it.id];
    const cur = row?.case_qty, curL = row?.loose_qty;
    const low = cur != null && cur < 1;
    const status = cur == null ? '<span class="pill warn">ยังไม่เคยนับ</span>' : low ? '<span class="pill bad">ต้องสั่งเพิ่ม</span>' : '<span class="pill ok">พอใช้</span>';
    const qty = cur == null ? '–' : `${cur} ลัง${curL ? ` <span class="sub" style="font-size:11px">+${curL} ชิ้นเศษ</span>` : ''}`;
    return `<tr><td>${esc(it.name)}</td><td class="n ${low ? 'low' : ''}">${qty}</td><td>${status}</td></tr>`;
  }).join('');
  const lows = STOCK_ITEMS.filter(it => (byId[it.id]?.case_qty ?? 1) < 1).length;
  const unchecked = STOCK_ITEMS.filter(it => byId[it.id]?.case_qty == null).length;
  const lastChecked = (stock || []).reduce((m, s) => (!m || (s.last_checked && s.last_checked > m)) ? s.last_checked : m, null);

  el.innerHTML = `<div class="between" style="margin-bottom:14px;flex-wrap:wrap">${seg}
      <span class="sub">${lastChecked ? `หัวหน้าเช็คล่าสุด ${fmtDate(lastChecked)}` : 'ยังไม่เคยเช็ค'}</span></div>
    <div class="kpis">
      <div class="card kpi"><div class="eyebrow">รายการที่ติดตาม</div><div class="v">${STOCK_ITEMS.length}</div></div>
      <div class="card kpi ${lows ? 'flag' : ''}"><div class="eyebrow">ต้องสั่งเพิ่ม</div><div class="v">${lows}</div></div>
      <div class="card kpi"><div class="eyebrow">ยังไม่เคยนับ</div><div class="v">${unchecked}</div></div>
    </div>
    <div class="tablewrap" style="max-height:72vh;overflow-y:auto"><table>
      <thead><tr><th>วัตถุดิบ</th><th>มีอยู่ในคลังกลาง</th><th>สถานะ</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="foot">หัวหน้าเป็นคนนับของจริงที่คลังกลาง (หน้าหัวหน้า → รอบส่งของ → เช็คสต๊อก) — เหลือน้อยกว่า 1 ลังเต็มขึ้นธง "ต้องสั่งเพิ่ม" ทันที</p>`;
}

async function renderStockDeliveries(el, seg) {
  const b = BRANCHES.find(x => x.id === S.stockBranch) || BRANCHES[0];
  const overuse = getSettings().overuseThresholdUnits;   // เกณฑ์ "ผิดปกติ" จากตาราง settings (เดิมฝังเลข 0.5 ไว้ในโค้ด)
  const [{ data: list }, { data: employees }] = await Promise.all([
    supabase.from('deliveries').select('*').eq('branch_id', b.id).order('delivery_date', { ascending: false }),
    supabase.from('employees').select('*'),
  ]);
  const staffEmp = (employees || []).find(e => e.branch_id === b.id && e.role === 'staff');
  const relief = (employees || []).find(e => e.role === 'relief');
  const cards = (list || []).map(dlv => {
    const items = Object.entries(dlv.items);
    const totalQty = items.reduce((s, [, qty]) => s + qty, 0);
    const totalCost = items.reduce((s, [id, qty]) => { const it = STOCK_ITEMS.find(x => String(x.id) === id); return s + (it ? qty * it.branch_price : 0); }, 0);
    const flagCount = dlv.received ? items.filter(([id, qty]) => { const rq = dlv.received[id]; return rq != null && Math.abs(qty - rq) > overuse; }).length : 0;
    const open = S.deliveryOpen && S.deliveryOpen[dlv.id];
    const roundName = (ROUNDS.find(r => r.id === dlv.round_id) || {}).name || dlv.round_id;
    const detailRows = items.map(([id, qty]) => {
      const it = STOCK_ITEMS.find(x => String(x.id) === id); if (!it) return '';
      const rq = dlv.received ? dlv.received[id] : null;
      const diff = rq != null ? qty - rq : null;
      const flag = diff != null && Math.abs(diff) > overuse;
      return `<tr><td>${esc(it.name)} <span class="sub">(${esc(it.unit)})</span></td><td class="n">${qty}</td><td class="n">${rq != null ? rq : '–'}</td>
        <td class="n ${flag ? 'neg' : ''}">${diff != null ? signed(-diff) : '–'}${flag ? ' ⚠' : ''}</td></tr>`;
    }).join('');
    return `<div class="card pad" style="margin-bottom:10px">
      <button class="between" data-deliveryacc="${dlv.id}" style="width:100%;background:none;border:none;padding:0;cursor:pointer;text-align:left;flex-wrap:wrap;gap:8px">
        <span>${fmtDate(dlv.delivery_date)} <span class="sub">${esc(roundName)}</span></span>
        <span class="row" style="gap:8px;flex-wrap:wrap">
          ${flagCount ? `<span class="pill bad">⚠ ${flagCount} รายการผิดปกติ</span>` : dlv.received ? '<span class="pill ok">เช็คแล้ว</span>' : '<span class="pill warn">ยังไม่เช็ค</span>'}
          <span class="sub">${totalQty} ชิ้น · ${baht(totalCost)} บาท</span>
        </span>
      </button>
      ${open ? `<div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>วัตถุดิบ</th><th>ส่งไป</th><th>ได้รับจริง</th><th>ผลต่าง</th></tr></thead><tbody>${detailRows}</tbody></table></div>
      <button class="mini" data-deliveryprint="${dlv.id}" style="margin-top:8px">ปริ้นใบส่งของ</button>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = `${stockHeadBar(seg, b)}
    <div class="between" style="margin-bottom:10px"><span class="sub">ประวัติการส่งของ สาขา${esc(b.name)}</span>
      <button class="mini" id="deliveryMonthPrintBtn">ปริ้นสรุปส่งของทั้งเดือน (ทุกสาขา)</button></div>
    ${cards || '<p class="sub">สาขานี้ยังไม่มีประวัติการส่งของ</p>'}
    <p class="foot">แตะแถวเพื่อดูรายการวัตถุดิบทีละตัว · "ได้รับจริง" มาจากที่พนักงานสาขากรอกเช็ค "วัตถุดิบนำเข้า" ตอนปิดยอด · ⚠ = ผลต่างเกิน ${overuse} หน่วยของรายการนั้น</p>`;
  $('#sviewSel').addEventListener('change', e => { S.stockBranch = e.target.value; renderStockView(seg); });
  el.querySelectorAll('[data-deliveryacc]').forEach(btn => btn.addEventListener('click', () => { S.deliveryOpen = S.deliveryOpen || {}; S.deliveryOpen[btn.dataset.deliveryacc] = !S.deliveryOpen[btn.dataset.deliveryacc]; renderStockView(seg); }));
  el.querySelectorAll('[data-deliveryprint]').forEach(btn => btn.addEventListener('click', async () => {
    const dlv = (list || []).find(x => x.id === btn.dataset.deliveryprint); if (!dlv) return;
    const roundName = (ROUNDS.find(r => r.id === dlv.round_id) || {}).name || dlv.round_id;
    const companies = await getCompanies();
    const html = deliveryReportHTML({ dlv, branch: b, roundName, staffName: staffEmp?.name, reliefName: relief?.name, reliefRole: 'หัวหน้า', stockItems: STOCK_ITEMS, companies, overuse });
    printDoc(html, 'ไม่พบรอบส่งของนี้');
  }));
  const mp = $('#deliveryMonthPrintBtn'); if (mp) mp.addEventListener('click', async () => {
    const dates = monthDates(TODAY);
    const { data: monthDlv } = await supabase.from('deliveries').select('*').gte('delivery_date', dates[0]).lte('delivery_date', dates[dates.length - 1]).order('delivery_date');
    const withRound = (monthDlv || []).map(x => ({ ...x, round_name: (ROUNDS.find(r => r.id === x.round_id) || {}).name || x.round_id }));
    const companies = await getCompanies();
    const html = deliveryMonthHTML({ list: withRound, branches: BRANCHES, stockItems: STOCK_ITEMS, monthLabelStr: monthLabel(dates[dates.length - 1]), companies });
    printDoc(html, 'เดือนนี้ยังไม่มีการส่งของ');
  });
}

/* ============================== เงินเดือน ==============================
   ชุดข้อมูล+สูตรเงินเดือนของเดือนนี้ ใช้ร่วมกันทั้งแท็บ "เงินเดือน" และแท็บ "กำไร/ขาดทุน"
   (เดิมสองแท็บดึงข้อมูลและคำนวณแยกกันคนละชุด ถ้าแก้สูตรที่เดียวลืมอีกที่ ตัวเลขค่าแรงสองหน้าจะไม่ตรงกันทันที) */
async function loadMonthPayroll() {
  const cfg = getSettings();
  const dates = monthDates(TODAY);
  const [{ data: allRecords }, { data: allClocks }, { data: allAdvances }, { data: whRentRows }, { data: employees }] = await Promise.all([
    supabase.from('daily_records').select('*').gte('record_date', dates[0]).lte('record_date', dates[dates.length - 1]),
    supabase.from('clock_records').select('*').gte('clock_date', dates[0]).lte('clock_date', dates[dates.length - 1]),
    supabase.from('advances').select('*'),
    supabase.from('warehouse_rent_history').select('*').order('effective_from'),
    supabase.from('employees').select('*'),
  ]);
  const clocksByDateAll = {}; BRANCHES.forEach(b => { clocksByDateAll[b.id] = {}; });
  (allClocks || []).forEach(c => { if (!clocksByDateAll[c.branch_id]) clocksByDateAll[c.branch_id] = {}; clocksByDateAll[c.branch_id][c.clock_date] = c; });
  const relief = (employees || []).find(e => e.role === 'relief');
  const whRent = calc.rentAt((whRentRows || []).map(r => ({ from: r.effective_from, rent: r.rent })), dates[0]);

  const payPeople = BRANCHES.map(b => {
    const emp = (employees || []).find(e => e.branch_id === b.id && e.role === 'staff');
    const records = (allRecords || []).filter(r => r.branch_id === b.id);
    // เบิก/กู้ของสาขา คิดรวมเป็นก้อนของสาขาเหมือนกัน (ของหัวหน้า branch_id เป็น null อยู่แล้ว จึงไม่ปนเข้ามา)
    const advancesForStaff = (allAdvances || []).filter(a => a.branch_id === b.id);
    const pr = calc.payrollFor({
      branch: { relief_name: relief?.name, base_salary: emp?.base_salary ?? 0, days_off_quota: b.days_off_quota, holiday_work_days: b.holiday_work_days || 0 },
      records, clocksByDate: clocksByDateAll[b.id] || {}, allDatesInMonth: dates, advancesForStaff, todayISO: TODAY, cfg,
    });
    return { key: b.id, b, records, emp, name: emp?.name || '(ยังไม่ผูกบัญชี)', place: b.name, base: emp?.base_salary ?? 0, pr };
  });
  const advancesForRelief = (allAdvances || []).filter(a => a.branch_id == null && a.staff_name === relief?.name);
  const prR = calc.payrollForRelief({
    relief: { name: relief?.name, base_salary: relief?.base_salary ?? 0, delivery_pay: relief?.delivery_pay ?? 0 },
    allBranchRecords: allRecords || [], allBranchClocksByDate: clocksByDateAll, advancesForRelief, todayISO: TODAY, cfg, whRent,
  });
  return { cfg, dates, allRecords: allRecords || [], clocksByDateAll, employees: employees || [], relief, whRent, payPeople, prR };
}

async function renderPay(body) {
  body.innerHTML = `<div class="boot">กำลังคำนวณ…</div>`;
  const { cfg, allRecords, relief, payPeople, prR } = await loadMonthPayroll();
  const [{ data: allRemits }, { data: headRemits }, { data: allOffsets }, { data: cashRecords }] = await Promise.all([
    supabase.from('cash_remittances').select('*'),
    supabase.from('head_remittances').select('*'),
    supabase.from('remit_loan_offsets').select('*'),
    supabase.from('daily_records').select('branch_id,record_date,cash,float_cash,sent').eq('sent', true),
  ]);
  const all = [...payPeople.map(p => ({ ...p, ab: p.pr.advBreak, gross: p.pr.total + p.pr.advanceDeduct })),
    { key: 'relief', name: relief?.name || 'หัวหน้า', place: 'คลังกลาง', pr: prR, ab: prR.advBreak, gross: prR.total + prR.advanceDeduct }];

  const dash = v => v ? baht(v) : '–';
  const staffRows = payPeople.map(p => `<tr><td>${esc(p.name)} <span class="sub">${esc(p.place)}</span></td>
      <td class="n">${baht(p.base)}</td>
      <td class="n ${p.pr.reset ? 'neg' : ''}">${baht(p.pr.diligence)}${p.pr.reset ? ' ⚠' : ''}</td>
      <td class="n">${baht(p.pr.holidayPay)}</td>
      <td class="n" title="${p.pr.cups} แก้ว">${baht(p.pr.cupPay)}</td>
      <td class="n ${p.pr.deduct ? 'neg' : ''}" title="${[p.pr.late ? `สาย ${p.pr.late} นาที` : '', p.pr.early ? `ปิดไว ${p.pr.early} นาที` : '', p.pr.noClock ? `ลืมลงเวลา ${p.pr.noClock} ครั้ง` : '', p.pr.excess ? `หยุดเกินโควตา ${p.pr.excess} วัน` : ''].filter(Boolean).join(' · ') || 'ไม่มีรายการหัก'}">${p.pr.deduct ? '−' + baht(p.pr.deduct) : '0'}${p.pr.noClock ? ` <span class="sub">(ลืมลงเวลา ${p.pr.noClock})</span>` : ''}</td>
      <td class="n" style="font-weight:600">${baht(p.pr.total + p.pr.advanceDeduct)}</td></tr>`).join('');
  const reliefBaseAll = (relief?.base_salary ?? 0) + (relief?.delivery_pay ?? 0) + prR.whRent;
  const reliefRow = `<tr><td>${esc(relief?.name || 'หัวหน้า')} <span class="sub">คลังกลาง</span></td>
      <td class="n" title="ฐาน + เงินส่งของ + ค่าเช่าคลังกลาง">${baht(reliefBaseAll)}</td><td class="n">–</td><td class="n">–</td>
      <td class="n" title="${prR.cups} แก้ว">${baht(prR.cupPay)}</td>
      <td class="n ${prR.deduct ? 'neg' : ''}" title="หัวหน้าไม่หักมาสาย/ปิดไว${prR.noClock ? ` · ลืมลงเวลา ${prR.noClock} ครั้ง` : ''}">${prR.deduct ? '−' + baht(prR.deduct) : '0'}${prR.noClock ? ` <span class="sub">(ลืมลงเวลา ${prR.noClock})</span>` : ''}</td>
      <td class="n" style="font-weight:600">${baht(prR.total + prR.advanceDeduct)}</td></tr>`;

  const r20People = all.filter(p => p.ab.r20.advance || p.ab.r20.loan || p.ab.r20.remit);
  const r20Total = r20People.reduce((s, p) => s + p.ab.r20.payout, 0);
  const r20Rows = r20People.map(p => `<tr><td>${esc(p.name)}</td><td class="sub">${esc(p.place)}</td>
      <td class="n">${dash(p.ab.r20.advance)}</td><td class="n">${dash(p.ab.r20.loan)}</td><td class="n">${dash(p.ab.r20.remit)}</td>
      <td class="n" style="font-weight:700">${baht(p.ab.r20.payout)}</td></tr>`).join('');
  const r5Total = all.reduce((s, p) => s + p.pr.total, 0);
  const r5Rows = all.map(p => `<tr><td>${esc(p.name)}</td><td class="sub">${esc(p.place)}</td>
      <td class="n">${baht(p.gross)}</td><td class="n">${dash(p.ab.advance)}</td><td class="n">${dash(p.ab.loan)}</td><td class="n">${dash(p.ab.remit)}</td>
      <td class="n" style="font-weight:700">${baht(p.pr.total)}</td></tr>`).join('');

  const cashRows = BRANCHES.map(b => {
    const branchRemits = (allRemits || []).filter(x => x.branch_id === b.id).sort((a, c) => a.remit_date < c.remit_date ? 1 : -1);
    const lastRemitDate = branchRemits[0]?.remit_date || null;
    const records = (cashRecords || []).filter(r => r.branch_id === b.id);
    const offset = (allOffsets || []).find(x => x.branch_id === b.id);
    const p = calc.cashPending(records, lastRemitDate, offset ? N(offset.amount) : 0);
    return `<tr><td>${esc(b.name)}</td><td class="n">${baht(p.amount)}</td><td class="n">${p.dates.length}</td><td class="n">${lastRemitDate ? fmtDate(lastRemitDate) : '—'}</td></tr>`;
  }).join('');

  const collected = (allRemits || []).filter(x => x.method !== 'loan').reduce((s, x) => s + N(x.amount), 0);
  const forwarded = (headRemits || []).reduce((s, x) => s + N(x.amount), 0);
  const headHeld = collected - forwarded;
  const headLogRows = (headRemits || []).slice().reverse().map(e => `<tr><td class="n">${fmtDate(e.remit_date)}</td><td class="n">${baht(e.amount)}</td><td>${e.method === 'cash' ? 'เงินสด' : 'โอนเงิน'}</td></tr>`).join('');

  body.innerHTML = `<div class="between" style="margin-bottom:14px"><h3 style="margin:0">เงินเดือน — เดือนนี้</h3>
      <button class="mini" id="printAllSlipsBtn">ส่งออกสลิปทุกคน</button></div>
    <div class="tablewrap"><table>
      <thead><tr><th>พนักงาน</th><th>ฐานเงินเดือน</th><th>เบี้ยขยัน</th><th>ทำงานวันหยุด</th><th>ค่าแก้ว</th><th>หัก (ขาด/ลา/มาสาย)</th><th>เงินเดือนสุทธิ</th></tr></thead>
      <tbody>${staffRows}${reliefRow}</tbody></table></div>
    <p class="foot">แตะที่ช่อง "หัก" เพื่อดูว่ามาจากอะไร · <b>ลืมลงเวลา</b> (ลงไม่ครบทั้งเข้า-ออก) หัก 40 บาท/ครั้ง · มาสาย/ปิดไว หักนาทีละ 1 บาท —
      <b>หัวหน้าไม่หักมาสาย/ปิดไว</b> เพราะไปทำแทนหลายสาขาคนละเวลา แต่ยังต้องลงเวลาให้ครบ ·
      "เงินเดือนสุทธิ" คือยอดก่อนหักเบิก/เงินกู้ — ยอดจ่ายจริงอยู่ในตาราง "จ่ายเงินเดือน" ด้านล่าง</p>

    <h3 style="margin:22px 0 10px">จ่ายเงินเดือน</h3>
    <div class="eyebrow" style="margin-bottom:6px">รอบวันที่ ${cfg.advanceDay} — จ่ายเงินเบิก</div>
    <div class="tablewrap"><table><thead><tr><th>ชื่อ</th><th>สาขา</th><th>เงินเบิก</th><th>เงินกู้</th><th>เงินสดร้านตัดมา</th><th>จ่ายเพิ่ม</th></tr></thead>
      <tbody>${r20Rows || '<tr><td colspan="6" class="sub">รอบนี้ยังไม่มีใครขอเบิก</td></tr>'}</tbody>
      ${r20People.length ? `<tfoot><tr style="font-weight:700;border-top:2px solid var(--line-2)"><td colspan="5">รวมเงินสดที่ต้องเตรียมจ่าย</td><td class="n">${baht(r20Total)}</td></tr></tfoot>` : ''}</table></div>

    <div class="eyebrow" style="margin:18px 0 6px">รอบวันที่ ${cfg.settleDays[0]} — จ่ายเงินเดือน</div>
    <div class="tablewrap"><table><thead><tr><th>ชื่อ</th><th>สาขา</th><th>เงินเดือน</th><th>เงินเบิก</th><th>เงินกู้</th><th>เงินสดร้านตัดมา</th><th>จ่ายเพิ่ม</th></tr></thead>
      <tbody>${r5Rows}</tbody>
      <tfoot><tr style="font-weight:700;border-top:2px solid var(--line-2)"><td colspan="6">รวมเงินสดที่ต้องเตรียมจ่าย</td><td class="n">${baht(r5Total)}</td></tr></tfoot></table></div>

    <h3 style="margin:22px 0 10px">เงินสดค้างที่สาขา</h3>
    <div class="tablewrap"><table><thead><tr><th>สาขา</th><th>ค้างส่ง</th><th>ค้างกี่วัน</th><th>ส่ง/รับล่าสุด</th></tr></thead><tbody>${cashRows}</tbody></table></div>

    <h3 style="margin:22px 0 10px">เงินสดจากหัวหน้า</h3>
    <div class="card pad" style="margin-bottom:14px">
      <div class="between" style="margin-bottom:4px"><div class="eyebrow">หัวหน้าถืออยู่ตอนนี้</div>
        <button class="mini" id="ownerConfirmHeadBtn" ${headHeld <= 0 ? 'disabled' : ''}>รับเงินแล้ว</button></div>
      <div class="bigtime">${baht(headHeld)} <span class="sub" style="font-size:13px;font-weight:400">บาท</span></div>
    </div>
    <div class="tablewrap"><table><thead><tr><th>วันที่รับ</th><th>จำนวน</th><th>วิธี</th></tr></thead>
      <tbody>${headLogRows || '<tr><td colspan="3" class="sub">ยังไม่มีประวัติ</td></tr>'}</tbody></table></div>`;

  const ps = $('#printAllSlipsBtn'); if (ps) ps.addEventListener('click', async () => {
    const [companies, { data: priv }] = await Promise.all([
      getCompanies(),
      supabase.from('employee_private').select('*'),   // เลขบัตรประชาชนขึ้นสลิป — เจ้าของเท่านั้นที่อ่านได้ทั้งหมด
    ]);
    const nidOf = id => ((priv || []).find(x => x.employee_id === id) || {}).national_id || '';
    const mLabel = monthLabel(monthDates(TODAY).slice(-1)[0]);
    const html = payPeople.map(p => staffSlipHTML(
      { name: p.b.name, staff_name: p.name, first_name: p.emp?.first_name, last_name: p.emp?.last_name, national_id: nidOf(p.emp?.id),
        base_salary: p.base, holiday_work_days: p.b.holiday_work_days || 0 }, p.pr, mLabel, companies)).join('')
      + reliefSlipHTML({ name: relief?.name || 'หัวหน้า', role: 'หัวหน้า', first_name: relief?.first_name, last_name: relief?.last_name,
        national_id: nidOf(relief?.id), base_salary: relief?.base_salary ?? 0, delivery_pay: relief?.delivery_pay ?? 0 }, prR, mLabel, companies);
    printDoc(html, 'ยังไม่มีสลิปให้ออก');
  });
  const hc = $('#ownerConfirmHeadBtn'); if (hc) hc.addEventListener('click', async () => {
    if (headHeld <= 0) { toast('ไม่มีเงินสดค้างรับ'); return; }
    await supabase.from('head_remittances').insert({ remit_date: TODAY, amount: headHeld, method: 'cash' });
    toast('บันทึกว่ารับเงินจากหัวหน้าแล้ว ' + baht(headHeld) + ' บาท');
    loadTab();
  });
}

/* ============================== กำไร/ขาดทุน ============================== */
async function renderPL(body) {
  body.innerHTML = `<div class="boot">กำลังคำนวณ…</div>`;
  const { cfg, dates, clocksByDateAll, employees, payPeople, prR } = await loadMonthPayroll();
  const [{ data: branchRentRows }, { data: deliveries }, { data: repairs }, { data: purchases }, { data: whStock }, { data: externalSales }] = await Promise.all([
    supabase.from('branch_rent_history').select('*').order('effective_from'),
    supabase.from('deliveries').select('*').gte('delivery_date', dates[0]).lte('delivery_date', dates[dates.length - 1]),
    supabase.from('repairs').select('*').gte('repair_date', dates[0]).lte('repair_date', dates[dates.length - 1]),
    supabase.from('purchases').select('*').order('purchase_date', { ascending: false }).limit(12),
    supabase.from('warehouse_stock').select('*'),
    supabase.from('external_sales').select('*').order('sale_date', { ascending: false }),
  ]);
  const stockItemsById = {}; STOCK_ITEMS.forEach(it => { stockItemsById[it.id] = { branch_price: it.branch_price, unit: it.unit, per_case: it.per_case, name: it.name }; });
  const extAvail = await whAvailMap(STOCK_ITEMS);

  // ค่าแรงในตารางนี้ = ตัวเดียวกับที่โชว์ในแท็บเงินเดือน (payPeople มาจาก loadMonthPayroll ชุดเดียวกัน)
  const rows = payPeople.map(({ b, records, pr }) => {
    const { sales, grab } = calc.aggregateBranchSales(records, clocksByDateAll[b.id] || {}, cfg);
    const dlv = (deliveries || []).filter(x => x.branch_id === b.id).map(x => ({ items: x.items, received: x.received }));
    const materialCost = calc.monthMaterialCost(dlv, stockItemsById);
    const rentHistory = (branchRentRows || []).filter(r => r.branch_id === b.id).map(r => ({ from: r.effective_from, rent: r.rent }));
    const rent = calc.rentAt(rentHistory, dates[0]);
    const branchRepairs = (repairs || []).filter(r => r.branch_id === b.id);
    return { b, x: calc.branchPL({ sales, grab, materialCost, rent, repairs: branchRepairs, grabCommissionPct: cfg.grabCommissionPct, payroll: pr }) };
  });
  const totSales = rows.reduce((s, x) => s + x.x.sales, 0);
  const totMat = rows.reduce((s, x) => s + x.x.materialCost, 0);
  const totRate = totSales > 0 ? totMat / totSales : 0;
  const totLabor = rows.reduce((s, x) => s + x.x.labor, 0);
  const totRent = rows.reduce((s, x) => s + x.x.rent, 0);
  const totRepair = rows.reduce((s, x) => s + x.x.repairs, 0);
  const totGrabComm = rows.reduce((s, x) => s + x.x.grabCommission, 0);
  const totNet = rows.reduce((s, x) => s + x.x.net, 0);

  const avgCostById = {}; STOCK_ITEMS.forEach(it => { const row = (whStock || []).find(s => s.item_id === it.id); avgCostById[it.id] = row?.avg_cost ?? (it.branch_price * (1 - cfg.costDiscountPct)); });
  const allDeliveries = (deliveries || []).map(x => ({ items: x.items, received: x.received }));
  // ยอดขายนอกสาขาที่เข้ากำไรคลังกลาง ต้องนับเฉพาะบิลของเดือนนี้ ให้ตรงกับช่วงเดียวกับการส่งของ/ค่าแรง
  const allExternal = (externalSales || []).filter(s => s.sale_date >= dates[0] && s.sale_date <= dates[dates.length - 1]).map(s => ({ items: s.items }));
  const wh = calc.warehousePL({ deliveries: allDeliveries, externalSales: allExternal, stockItemsById, avgCostById, reliefPayroll: prR });
  const companyNet = totNet + wh.net;

  const tbRows = rows.map(({ b, x }) => `<tr><td>${esc(b.name)}</td>
      <td class="n">${baht(x.sales)}</td><td class="n">${baht(x.materialCost)}</td><td class="n">${(x.materialRate * 100).toFixed(1)}%</td>
      <td class="n">${baht(x.labor)}</td><td class="n">${baht(x.rent)}</td><td class="n">${x.repairs ? baht(x.repairs) : '–'}</td>
      <td class="n">${x.grabCommission ? baht(x.grabCommission) : '–'}</td>
      <td class="n ${x.net < 0 ? 'neg' : ''}" style="font-weight:700">${signed(x.net)}</td></tr>`).join('')
    + `<tr><td>คลังกลาง</td><td class="n">${baht(wh.sales)}</td><td class="n">${baht(wh.cost)}</td><td class="n">0.0%</td>
      <td class="n">${baht(wh.headLabor)}</td><td class="n">–</td><td class="n">–</td><td class="n">–</td>
      <td class="n ${wh.net < 0 ? 'neg' : ''}" style="font-weight:700">${signed(wh.net)}</td></tr>`;

  const purchRows = (purchases || []).map(p => {
    const it = STOCK_ITEMS.find(x => x.id === p.item_id);
    return `<tr><td>${fmtDate(p.purchase_date)}</td><td>${esc(it ? it.name : '—')}</td><td class="n">${p.case_qty} ลัง</td>
      <td class="n">${baht(p.total_price)}</td><td class="n">${Number(p.cost_per_unit).toFixed(2)}</td><td class="sub">${esc(p.note || '')}</td></tr>`;
  }).join('');
  const repairRows = (repairs || []).map(r => {
    const b = BRANCHES.find(x => x.id === r.branch_id);
    return `<tr><td>${fmtDate(r.repair_date)}</td><td>${esc(b ? b.name : '—')}</td><td>${esc(r.description)}</td><td class="n">${baht(r.cost)}</td></tr>`;
  }).join('');
  const issuerNames = {}; (employees || []).forEach(e => { issuerNames[e.id] = e.name; });
  const extThisMonth = (externalSales || []).filter(s => s.sale_date >= dates[0] && s.sale_date <= dates[dates.length - 1]);
  const extRows = (externalSales || []).slice(0, 12).map(x => {
    const editing = S.extEditing === x.id;
    const head = `<tr><td>${fmtDate(x.sale_date)}${(x.edit_log || []).length ? ' <span class="editmark" title="' + esc((x.edit_log || []).map(e => e.label).join(' · ')) + '">แก้ไขแล้ว</span>' : ''}</td>
      <td>${esc(x.buyer)}</td>
      <td class="n">${x.items.length ? x.items.length + ' รายการ' : '<span class="sub">ยกเลิกแล้ว</span>'}</td><td class="n">${baht(x.total)}</td>
      <td class="n"><button class="mini ${x.paid ? '' : 'go'}" data-extpaid="${x.id}">${x.paid ? 'โอนแล้ว' : 'รอโอน'}</button></td>
      <td class="n"><span class="row" style="gap:6px;justify-content:flex-end">
        <button class="mini" data-extedit="${x.id}">${editing ? 'ปิด' : 'แก้ไข'}</button>
        <button class="mini" data-extbillprint="${x.id}">ปริ้นบิล</button></span></td></tr>`;
    if (!editing) return head;
    const rows2 = x.items.map(li => {
      const it = STOCK_ITEMS.find(i => i.id === li.item_id);
      return `<div class="setrow"><span>${esc(it ? it.name : li.item_id)} <span class="sub">${li.qty} ${esc(it ? it.unit : '')} × ${baht(li.price)}</span></span>
        <input value="${S.extEditDraft[li.item_id] ?? li.qty}" data-extek="${li.item_id}" style="width:70px" inputmode="decimal"></div>`;
    }).join('');
    return head + `<tr class="detailrow"><td colspan="6" style="text-align:left;background:var(--surface-2)"><div style="padding:10px 4px">
      <p class="sub" style="margin:0 0 8px">แก้จำนวนแล้วกดบันทึก — ระบบคืน/ตัดสต๊อกคลังกลางตามส่วนต่างให้อัตโนมัติ · ตั้งเป็น 0 ทุกรายการ = ยกเลิกบิล</p>
      ${rows2 || '<p class="sub">บิลนี้ถูกยกเลิกไปแล้ว</p>'}
      ${x.items.length ? `<button class="btn primary" data-extsave="${x.id}" style="margin-top:10px">บันทึกการแก้ไข</button>` : ''}
      </div></td></tr>`;
  }).join('');

  body.innerHTML = `
    <h3 style="margin:0 0 14px">กำไร/ขาดทุน — เดือนนี้</h3>
    <div class="kpis">
      <div class="card kpi"><div class="eyebrow">ยอดขายรวม ${BRANCHES.length} สาขา</div><div class="v">${baht(totSales)}</div></div>
      <div class="card kpi"><div class="eyebrow">ต้นทุนวัตถุดิบรวม</div><div class="v">${baht(totMat)}</div></div>
      <div class="card kpi"><div class="eyebrow">ค่าแรงรวมทั้งบริษัท</div><div class="v">${baht(totLabor + wh.headLabor)}</div></div>
      <div class="card kpi"><div class="eyebrow">ค่าคอมแกร๊บรวม</div><div class="v">${baht(totGrabComm)}</div></div>
      <div class="card kpi ${companyNet < 0 ? 'flag' : ''}"><div class="eyebrow">กำไร/ขาดทุนรวมบริษัท</div><div class="v">${signed(companyNet)}</div></div>
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th>สาขา</th><th>ยอดขาย</th><th>ต้นทุนวัตถุดิบ</th><th>อัตราการใช้วัตถุดิบ</th><th>ค่าแรง</th><th>ค่าเช่า</th><th>ค่าซ่อม</th><th>ค่าคอมแกร๊บ</th><th>กำไร/ขาดทุน</th></tr></thead>
      <tbody>${tbRows}</tbody>
      <tfoot><tr style="font-weight:700;border-top:2px solid var(--line-2)"><td>รวม</td><td class="n">${baht(totSales + wh.sales)}</td><td class="n">${baht(totMat + wh.cost)}</td>
        <td class="n">${(totRate * 100).toFixed(1)}%</td><td class="n">${baht(totLabor + wh.headLabor)}</td><td class="n">${baht(totRent)}</td>
        <td class="n">${baht(totRepair)}</td><td class="n">${baht(totGrabComm)}</td><td class="n ${companyNet < 0 ? 'neg' : ''}">${signed(companyNet)}</td></tr></tfoot></table></div>
    <p class="foot">"อัตราการใช้วัตถุดิบ" = ต้นทุนวัตถุดิบ ÷ ยอดขาย · ค่าคอมแกร๊บ = ยอดขายผ่านแกร๊บ × ${(cfg.grabCommissionPct * 100).toFixed(1)}% ·
      แถวคลังกลาง: ยอดขาย = ของที่ส่งออกทั้งหมด×ราคาส่งสาขา, ต้นทุน = ของเดียวกัน×ต้นทุนเฉลี่ยจริง, ค่าแรง = เงินเดือนหัวหน้าเต็มจำนวน (รวมค่าเช่าคลังกลางแล้ว)</p>

    <div class="between" style="margin:22px 0 10px"><h3 style="margin:0">ขายนอกสาขา</h3>
      <span class="row" style="gap:8px"><button class="mini" id="ownExtToggle">${S.extOpen ? 'ปิด' : '+ เปิดบิลขาย'}</button>
      <button class="mini" id="extMonthPrintBtn">ปริ้นสรุปทั้งเดือน</button></span></div>
    ${S.extOpen ? `<div class="card pad" style="margin-bottom:10px">
      <div class="field"><label>ชื่อร้าน/ผู้ซื้อ</label><input id="ownExtBuyer" value="${esc(S.extBuyer)}" placeholder="เช่น ร้านชาไข่มุกบ้านไผ่"></div>
      <div class="parlist" style="margin:8px 0">${STOCK_ITEMS.map(it => {
        const q = S.extDraft[it.id] ?? '';
        return `<div class="setrow"><span>${esc(it.name)} <span class="sub">${esc(it.unit)} · ${baht(it.branch_price)} บ. · มี ${extAvail[it.id] ?? 0}</span></span>
          <input value="${q}" data-ownext="${it.id}" style="width:70px" inputmode="decimal" placeholder="0"></div>`;
      }).join('')}</div>
      <div class="between" style="font-weight:700;margin:8px 0"><span>ยอดรวมบิล</span><span>${baht(STOCK_ITEMS.reduce((t, it) => t + N(S.extDraft[it.id]) * it.branch_price, 0))}</span></div>
      <button class="btn primary big" id="ownExtSubmit">ออกบิล</button>
    </div>` : ''}
    <div class="tablewrap" style="margin-bottom:8px"><table><thead><tr><th>วันที่</th><th>ผู้ซื้อ</th><th>รายการ</th><th>ยอดรวม</th><th>สถานะเงิน</th><th></th></tr></thead>
      <tbody>${extRows || '<tr><td colspan="6" class="sub">ยังไม่มีบิลขายนอก</td></tr>'}</tbody></table></div>
    <p class="foot" style="margin-bottom:16px">ออกบิลได้ทั้งที่นี่และหน้าหัวหน้า → แท็บ "ขายนอก" · กด <b>แก้ไข</b> เพื่อแก้จำนวนย้อนหลังหรือยกเลิกบิล — ระบบคืน/ตัดสต๊อกคลังกลางตามส่วนต่างให้เอง และจดไว้ในประวัติการแก้ไข</p>

    <h3 style="margin:22px 0 10px">บิลนำเข้าสินค้าล่าสุด</h3>
    <div class="tablewrap" style="margin-bottom:16px"><table><thead><tr><th>วันที่</th><th>วัตถุดิบ</th><th>จำนวน</th><th>ราคารวม</th><th>ทุน/หน่วย</th><th>หมายเหตุ</th></tr></thead>
      <tbody>${purchRows || '<tr><td colspan="6" class="sub">ยังไม่มีบิล</td></tr>'}</tbody></table></div>
    <p class="foot" style="margin-bottom:16px">บันทึกบิลซื้อได้ที่หน้าหัวหน้า → แท็บ "รอบส่งของ" → "เช็คสต๊อก"</p>

    <h3 style="margin:22px 0 10px">ค่าซ่อม/บำรุงรักษา</h3>
    <div class="card pad" style="margin-bottom:16px">
      <div class="between" style="margin-bottom:4px"><div class="eyebrow">บันทึกรายการซ่อม</div>
        <button class="mini" id="repairToggleBtn">${S.repairOpen ? 'ปิด' : '+ บันทึกรายการซ่อม'}</button></div>
      ${S.repairOpen ? `
        <div class="field"><label>สาขา</label><select id="repairBidSel" class="ctl">${BRANCHES.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
        <div class="field"><label>ซ่อมอะไร</label><input id="repairDesc" value="${esc(S.repairDesc || '')}"></div>
        <div class="field"><label>ค่าใช้จ่าย (บาท)</label><input id="repairCost" inputmode="numeric" value="${S.repairCost || ''}"></div>
        <button class="btn primary big" id="repairSubmitBtn">บันทึกรายการซ่อม</button>` : ''}
    </div>
    <div class="tablewrap" style="margin-bottom:16px"><table><thead><tr><th>วันที่</th><th>สาขา</th><th>รายการ</th><th>ค่าใช้จ่าย</th></tr></thead>
      <tbody>${repairRows || '<tr><td colspan="4" class="sub">ยังไม่มีรายการซ่อม</td></tr>'}</tbody></table></div>`;

  body.querySelectorAll('[data-extbillprint]').forEach(btn => btn.addEventListener('click', async () => {
    const sale = (externalSales || []).find(x => x.id === btn.dataset.extbillprint); if (!sale) return;
    const companies = await getCompanies();
    const html = externalBillHTML({ sale, issuerName: issuerNames[sale.issuer], stockItems: STOCK_ITEMS, companies, viewerRole: 'owner' });
    printDoc(html, 'ไม่พบบิลนี้');
  }));
  body.querySelectorAll('[data-extpaid]').forEach(btn => btn.addEventListener('click', async () => {
    const sale = (externalSales || []).find(x => x.id === btn.dataset.extpaid); if (!sale) return;
    await supabase.from('external_sales').update({ paid: !sale.paid }).eq('id', sale.id);
    toast(!sale.paid ? 'บันทึกว่าลูกค้าโอนเงินแล้ว' : 'เปลี่ยนกลับเป็นรอลูกค้าโอน');
    renderPL(body);
  }));
  const oet = $('#ownExtToggle'); if (oet) oet.addEventListener('click', () => { S.extOpen = !S.extOpen; renderPL(body); });
  const oeb = $('#ownExtBuyer'); if (oeb) oeb.addEventListener('input', () => { S.extBuyer = oeb.value; });
  body.querySelectorAll('input[data-ownext]').forEach(inp => inp.addEventListener('input', () => {
    S.extDraft[inp.dataset.ownext] = numIn(inp.value);
  }));
  const oes = $('#ownExtSubmit'); if (oes) oes.addEventListener('click', async () => {
    const buyer = (S.extBuyer || '').trim();
    const lines = STOCK_ITEMS.map(it => ({ it, qty: N(S.extDraft[it.id]) })).filter(l => l.qty > 0);
    const res = await issueExternalSale({ buyer, lines, issuerId: ME.id, stockItems: STOCK_ITEMS, avail: extAvail });
    if (res.error) { toast(res.error); return; }
    S.extOpen = false; S.extBuyer = ''; S.extDraft = {};
    toast(`ออกบิลให้ ${buyer} แล้ว ${baht(res.total)} บาท`);
    renderPL(body);
  });
  body.querySelectorAll('[data-extedit]').forEach(btn => btn.addEventListener('click', () => {
    S.extEditing = S.extEditing === btn.dataset.extedit ? null : btn.dataset.extedit;
    S.extEditDraft = {}; renderPL(body);
  }));
  body.querySelectorAll('input[data-extek]').forEach(inp => inp.addEventListener('input', () => {
    S.extEditDraft[inp.dataset.extek] = numIn(inp.value);
  }));
  body.querySelectorAll('[data-extsave]').forEach(btn => btn.addEventListener('click', async () => {
    const sale = (externalSales || []).find(x => x.id === btn.dataset.extsave); if (!sale) return;
    const res = await editExternalSale({ sale: JSON.parse(JSON.stringify(sale)), draftQty: S.extEditDraft,
      stockItems: STOCK_ITEMS, avail: extAvail, byName: ME.name });
    if (res.error) { toast(res.error); return; }
    toast(res.cancelled ? 'ยกเลิกบิลแล้ว — คืนของเข้าคลังกลางครบ' : `แก้ไขบิลแล้ว ${res.changes} รายการ — ปรับสต๊อกคลังกลางให้แล้ว`);
    S.extEditing = null; S.extEditDraft = {}; renderPL(body);
  }));
  const emb = $('#extMonthPrintBtn'); if (emb) emb.addEventListener('click', async () => {
    const companies = await getCompanies();
    const html = externalMonthHTML({ list: extThisMonth, monthLabelStr: monthLabel(dates[dates.length - 1]), companies, viewerRole: 'owner' });
    printDoc(html, 'เดือนนี้ยังไม่มีบิลขายนอก');
  });
  const rt = $('#repairToggleBtn'); if (rt) rt.addEventListener('click', () => { S.repairOpen = !S.repairOpen; renderPL(body); });
  const rs = $('#repairSubmitBtn'); if (rs) rs.addEventListener('click', async () => {
    const bid = $('#repairBidSel').value, desc = ($('#repairDesc').value || '').trim(), cost = N($('#repairCost').value);
    if (!desc) { toast('กรอกรายการที่ซ่อมด้วย'); return; }
    if (cost <= 0) { toast('กรอกค่าใช้จ่ายให้ถูกต้อง'); return; }
    await supabase.from('repairs').insert({ branch_id: bid, repair_date: TODAY, description: desc, cost });
    toast('บันทึกรายการซ่อมเรียบร้อย');
    S.repairOpen = false; S.repairDesc = ''; S.repairCost = '';
    renderPL(body);
  });
}

/* ============================== ตั้งค่า ============================== */
/* อ่านค่าจากช่องตั้งค่า — พิมพ์ผิด (มีคอมมา/ตัวอักษร) ให้คืนค่าเดิมไว้ ไม่ใช่บันทึกเป็น 0 เงียบ ๆ
   พอร์ตจาก numSet() ในต้นแบบ ที่มีคอมเมนต์กำกับว่า "เผลอพิมพ์ตัวอักษรลงช่องราคาแก้วทีเดียว ยอดขายทั้งระบบกลายเป็น 0 ทันที" */
function readSetting(inp) {
  const v = numSet(inp.value, null);
  if (v === null) { inp.value = inp.dataset.prev ?? inp.defaultValue; toast('กรอกเป็นตัวเลขเท่านั้น — คืนค่าเดิมให้แล้ว'); return null; }
  inp.dataset.prev = String(v);
  return v;
}

async function renderSet(body) {
  body.innerHTML = `<div class="boot">กำลังโหลด…</div>`;
  const [people, { data: branchRentRows }, { data: whRentRows }, { data: par }, { data: settingsRows }, { data: recent7 }, { data: companies }] = await Promise.all([
    loadPeople(),
    supabase.from('branch_rent_history').select('*').order('effective_from'),
    supabase.from('warehouse_rent_history').select('*').order('effective_from'),
    supabase.from('stock_par_levels').select('*'),
    supabase.from('settings').select('*'),
    supabase.from('daily_records').select('branch_id,record_date,stock_snapshot,sent')
      .gte('record_date', dateRange(8)[7]).lte('record_date', TODAY),
    supabase.from('companies').select('*').order('id'),
  ]);
  const { employees, nid } = people;
  const relief = employees.find(e => e.role === 'relief');
  const rentAtBranch = bid => calc.rentAt((branchRentRows || []).filter(r => r.branch_id === bid).map(r => ({ from: r.effective_from, rent: r.rent })), TODAY);
  const whRentNow = calc.rentAt((whRentRows || []).map(r => ({ from: r.effective_from, rent: r.rent })), TODAY);

  const cfg0 = getSettings();
  const peopleCard = peopleCardHTML({
    branches: BRANCHES, employees, nid, rentAtBranch, whRentNow,
    graceNote: `นาทีสาย+ปิดไวรวมทั้งเดือนเกิน ${cfg0.diligenceRules.lateAllowance} นาที เบี้ยขยันเดือนนั้นเป็น 0`,
  });

  const pb = BRANCHES.find(x => x.id === (S.parBranch || BRANCHES[0].id)) || BRANCHES[0];
  // ใช้จริง 7 วันล่าสุดของสาขานั้น — เอาไว้ดูประกอบตอนตั้งระดับที่ต้องมีต่อรอบ (พอร์ตจากต้นแบบ)
  const usedByItem = {};
  {
    const snaps = (recent7 || []).filter(r => r.branch_id === pb.id && r.sent)
      .sort((a, b2) => a.record_date < b2.record_date ? -1 : 1).map(r => r.stock_snapshot || {});
    STOCK_ITEMS.forEach(it => {
      let u = 0;
      for (let i = 1; i < snaps.length; i++) {
        const before = N(snaps[i - 1][it.id]), after = N(snaps[i][it.id]);
        if (after < before) u += before - after;
      }
      usedByItem[it.id] = u;
    });
  }
  const parRows = STOCK_ITEMS.map(it => {
    const p = (par || []).find(x => x.item_id === it.id && x.branch_id === pb.id);
    return `<div class="setrow"><span>${esc(it.name)} <span class="sub">(${esc(it.unit)})${usedByItem[it.id] ? ` · ใช้จริง 7 วันล่าสุด ${usedByItem[it.id]}` : ''}</span></span>
      <span class="row" style="flex-wrap:wrap;row-gap:6px;justify-content:flex-end">
      <span class="sub">ระดับต่อรอบ</span><input value="${p?.par_qty ?? 0}" data-par="${it.id}" data-parb="${pb.id}" style="width:64px">
      <span class="sub">ราคาส่งสาขา</span><input value="${it.branch_price}" data-branchprice="${it.id}" style="width:64px"></span></div>`;
  }).join('');

  const settingsByKey = {}; (settingsRows || []).forEach(s => { settingsByKey[s.key] = s.value; });
  const genericKeys = [['grab_commission_pct', 'ค่าคอมแกร๊บ (สัดส่วน เช่น 0.321)'], ['cost_discount_pct', 'ส่วนลดต้นทุนจากราคาส่งสาขา (สัดส่วน)'],
    ['advance_cap', 'วงเงินเบิกรอบวันที่ 20 (บาท)'], ['loan_cap', 'วงเงินเงินกู้ (บาท)'], ['loan_interest_pct', 'ดอกเบี้ยเงินกู้ (สัดส่วน)'],
    ['pay_rules', 'กติกาจ่าย/หัก — ค่าแก้ว/บาทต่อนาทีสาย/ปิดไว/ลืมลงเวลา/หยุดเกินโควตา'],
    ['diligence_rules', 'เบี้ยขยัน — step/cap/นาทีที่ผ่อนผันรวมต่อเดือน'],
    ['holiday_pay_scale', 'ค่าทำงานวันหยุด (ครั้งที่ 1-4)'],
    ['cup_price', 'ราคาแก้ว (เย็น/ปั่น)'], ['cups_per_row', 'จำนวนแก้วต่อแถว (เย็น/ปั่น)'],
    ['overuse_threshold_units', 'เกณฑ์ผลต่างรับของที่ถือว่าผิดปกติ (หน่วย)']];
  const genericRows = genericKeys.map(([k, label]) => `<div class="setrow"><span>${label}</span>
      <input value="${JSON.stringify(settingsByKey[k] ?? '')}" data-settingkey="${k}" style="width:110px"></div>`).join('');

  body.innerHTML = `<div class="setgrid">
    <div class="card pad" style="grid-column:1/-1"><h3 style="margin-bottom:4px">ข้อมูลบริษัท (สำหรับเอกสาร)</h3>
      <p class="sub" style="margin:0 0 10px">ชื่อ/ที่อยู่/เลขผู้เสียภาษีตรงนี้ คือสิ่งที่ขึ้นหัว<b>ใบส่งของและบิลขายนอกสาขา</b>ทุกใบ —
        ตรวจให้ตรงกับหนังสือรับรองบริษัทจริงก่อนใช้พิมพ์ยื่นสรรพากร</p>
      ${(companies || []).map(c => `<div style="border-top:1px solid var(--line-2);padding-top:10px;margin-top:10px">
        <div class="eyebrow" style="margin-bottom:6px">${c.id === 'warehouse' ? 'คลังกลาง (ผู้ขาย/ผู้ส่งของ)' : 'สาขา (ผู้ซื้อ/ผู้รับของ)'}</div>
        <div class="row" style="gap:10px;padding:9px 0;border-bottom:1px solid var(--line)">
          <span class="sub" style="width:112px;flex:0 0 112px">ชื่อบริษัท</span>
          <input value="${esc(c.name || '')}" data-coname="${c.id}" style="flex:1;min-width:0;padding:8px 10px;border:1px solid var(--line-2);border-radius:7px;font-size:14px">
        </div>
        <div class="field"><label>ที่อยู่จดทะเบียน</label><input value="${esc(c.address || '')}" data-coaddr="${c.id}" placeholder="เลขที่ / หมู่ / ตำบล / อำเภอ / จังหวัด / รหัสไปรษณีย์"></div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">
          <span class="sub">เลขผู้เสียภาษี 13 หลัก</span><input value="${esc(c.tax_id || '')}" data-cotax="${c.id}" style="width:160px" inputmode="numeric">
          <label class="sub" style="display:flex;align-items:center;gap:4px">
            <input type="checkbox" data-covat="${c.id}" ${c.vat_registered ? 'checked' : ''}>จดทะเบียน VAT แล้ว</label>
        </div></div>`).join('')}
      <p class="foot">ยังไม่ได้จดทะเบียน VAT ทั้ง 2 บริษัท เอกสารจึงเป็นใบส่งของ/ใบกำกับสินค้า ไม่มีการคำนวณ VAT —
        ถ้าจดเมื่อไรให้ติ๊กช่องนี้แล้วบอกผม จะได้ปรับรูปแบบเอกสารให้เป็นใบกำกับภาษีเต็มรูปตามที่กฎหมายกำหนด</p></div>
    ${peopleCard}
    <div class="card pad" style="grid-column:1/-1"><h3 style="margin-bottom:4px">สต๊อกของแต่ละร้าน — ระดับที่ต้องมีต่อรอบ</h3>
      <span class="seg2" style="margin-bottom:10px">${BRANCHES.map(x => `<button data-parbranch="${x.id}" aria-pressed="${x.id === pb.id}">${esc(x.name)}</button>`).join('')}</span>
      <div class="parlist">${parRows}</div>
      <p class="foot">"ราคาส่งสาขา" เป็นราคาเดียวกันทุกสาขา แก้ตัวเดียวมีผลกับทุกสาขาพร้อมกัน · ตัวเลข "ใช้จริง 7 วันล่าสุด" เอาไว้ดูประกอบตอนตั้งระดับที่ต้องมีต่อรอบ ไม่ให้ตั้งมั่วจนสั่งของเกิน/ขาด</p></div>
    <div class="card pad" style="grid-column:1/-1"><h3 style="margin-bottom:8px">รอบส่งของ</h3>
      ${ROUNDS.map(r => `<div class="setrow" style="align-items:flex-start;flex-wrap:wrap;gap:8px">
        <span class="row" style="gap:6px"><input value="${esc(r.name)}" data-roundname="${r.id}" style="width:120px">
          <select class="ctl" data-rounddow="${r.id}" style="width:110px">${DAYS.map((dn, i) =>
            `<option value="${i}" ${i === r.day_of_week ? 'selected' : ''}>วัน${dn}</option>`).join('')}</select></span>
        <span class="row" style="flex-wrap:wrap;gap:10px;justify-content:flex-end">${BRANCHES.map(b =>
          `<label class="sub" style="display:flex;align-items:center;gap:4px"><input type="checkbox" data-roundbr="${r.id}" value="${b.id}"
            ${r.branch_ids.includes(b.id) ? 'checked' : ''}>${esc(b.name)}</label>`).join('')}</span></div>`).join('')}
      <p class="foot">ติ๊กสาขาที่ต้องส่งของในรอบนั้น · <b>วันส่งของห้ามใครหยุด</b> ระบบกันไว้ให้ตั้งแต่ตอนจองวันหยุด — เปลี่ยนวันแล้วมีผลกับการจองครั้งถัดไป
        (วันหยุดที่จองไว้แล้วก่อนหน้าไม่ถูกยกเลิกให้อัตโนมัติ ต้องดูในแท็บตารางงานเองว่าชนกันไหม)</p></div>
    <div class="card pad"><h3 style="margin-bottom:8px">ค่าคงที่ทางธุรกิจ</h3>${genericRows}
      <p class="foot">แก้แล้วมีผลตอนโหลดหน้าใหม่ (รีเฟรช/ล็อกอินใหม่) · ช่องที่เป็นวงเล็บปีกกา/วงเล็บเหลี่ยมต้องคงรูปแบบเดิมไว้ เช่น
        <code>{"cupPay":1,"latePerMin":1,"earlyPerMin":1,"noClock":40,"excessDayOff":330}</code> — พิมพ์ผิดรูปแบบระบบจะไม่บันทึกให้และเตือนทันที</p></div>
  </div>`;

  const saveBranch = async (bid, patch, msg) => {
    await supabase.from('branches').update(patch).eq('id', bid);
    const b = BRANCHES.find(x => x.id === bid); if (b) Object.assign(b, patch);
    toast(msg);
  };
  bindPeopleCard(body, {
    reload: () => renderSet(body),
    saveBranch,
    saveRent: async (bid, rent) => {
      await supabase.from('branch_rent_history').insert({ branch_id: bid, effective_from: TODAY, rent });
      toast('บันทึกค่าเช่าใหม่แล้ว — มีผลตั้งแต่วันนี้เป็นต้นไป ไม่กระทบเดือนที่ผ่านไปแล้ว');
    },
    saveWhRent: async rent => {
      await supabase.from('warehouse_rent_history').insert({ effective_from: TODAY, rent });
      toast('บันทึกค่าเช่าคลังกลางใหม่แล้ว');
    },
  });
  const saveCo = async (cid, patch, msg) => {
    await supabase.from('companies').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', cid);
    toast(msg);
  };
  body.querySelectorAll('input[data-coname]').forEach(inp => inp.addEventListener('change', () => {
    if (!inp.value.trim()) { toast('ชื่อบริษัทว่างไม่ได้'); return; }
    saveCo(inp.dataset.coname, { name: inp.value.trim() }, 'บันทึกชื่อบริษัทแล้ว');
  }));
  body.querySelectorAll('input[data-coaddr]').forEach(inp => inp.addEventListener('change', () =>
    saveCo(inp.dataset.coaddr, { address: inp.value.trim() }, 'บันทึกที่อยู่แล้ว — เอกสารที่ปริ้นหลังจากนี้จะใช้ที่อยู่ใหม่')));
  body.querySelectorAll('input[data-cotax]').forEach(inp => inp.addEventListener('change', () => {
    const digits = inp.value.replace(/\D/g, '');
    if (digits && digits.length !== 13) { toast('เลขผู้เสียภาษีต้องมี 13 หลัก — ตอนนี้กรอกมา ' + digits.length + ' หลัก'); inp.value = digits; return; }
    inp.value = digits;
    saveCo(inp.dataset.cotax, { tax_id: digits }, 'บันทึกเลขผู้เสียภาษีแล้ว');
  }));
  body.querySelectorAll('input[data-covat]').forEach(chk => chk.addEventListener('change', () =>
    saveCo(chk.dataset.covat, { vat_registered: chk.checked },
      chk.checked ? 'บันทึกว่าจดทะเบียน VAT แล้ว — บอกผมด้วยเพื่อปรับรูปแบบเอกสารเป็นใบกำกับภาษี' : 'บันทึกว่ายังไม่ได้จด VAT')));
  const saveRound = async (rid, patch, msg) => {
    await supabase.from('delivery_rounds').update(patch).eq('id', rid);
    const r = ROUNDS.find(x => x.id === rid); if (r) Object.assign(r, patch);
    toast(msg);
  };
  body.querySelectorAll('input[data-roundname]').forEach(inp => inp.addEventListener('change', () =>
    saveRound(inp.dataset.roundname, { name: inp.value.trim() || 'รอบส่งของ' }, 'บันทึกชื่อรอบแล้ว')));
  body.querySelectorAll('select[data-rounddow]').forEach(sel => sel.addEventListener('change', () =>
    saveRound(sel.dataset.rounddow, { day_of_week: +sel.value }, 'บันทึกวันส่งของแล้ว — มีผลกับการจองวันหยุดครั้งถัดไป')));
  body.querySelectorAll('input[data-roundbr]').forEach(chk => chk.addEventListener('change', () => {
    const rid = chk.dataset.roundbr;
    const ids = [...body.querySelectorAll(`input[data-roundbr="${rid}"]`)].filter(x => x.checked).map(x => x.value);
    saveRound(rid, { branch_ids: ids }, 'บันทึกสาขาในรอบแล้ว');
  }));
  body.querySelectorAll('[data-parbranch]').forEach(btn => btn.addEventListener('click', () => { S.parBranch = btn.dataset.parbranch; renderSet(body); }));
  body.querySelectorAll('input[data-par]').forEach(inp => inp.addEventListener('change', async () => {
    const v = readSetting(inp); if (v === null) return;
    await supabase.from('stock_par_levels').upsert({ item_id: +inp.dataset.par, branch_id: inp.dataset.parb, par_qty: v }, { onConflict: 'item_id,branch_id' });
    toast('บันทึกแล้ว');
  }));
  body.querySelectorAll('input[data-branchprice]').forEach(inp => inp.addEventListener('change', async () => {
    const v = readSetting(inp); if (v === null) return;
    await supabase.from('stock_items').update({ branch_price: v }).eq('id', +inp.dataset.branchprice);
    toast('บันทึกราคาส่งสาขาใหม่แล้ว — มีผลทันทีทั้งระบบ');
  }));
  body.querySelectorAll('input[data-settingkey]').forEach(inp => inp.addEventListener('change', async () => {
    let v; try { v = JSON.parse(inp.value); } catch { toast('กรอกค่าไม่ถูกต้อง (ใส่ตัวเลขหรือ true/false เท่านั้น)'); return; }
    await supabase.from('settings').upsert({ key: inp.dataset.settingkey, value: v, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    toast('บันทึกแล้ว — มีผลตอนโหลดหน้าใหม่ (ล็อกอินใหม่/รีเฟรช)');
  }));
}
