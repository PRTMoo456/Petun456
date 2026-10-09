// Vercel Cron: สรุปเก็บเงินสดสาขาทุกวันจันทร์และศุกร์ 17:00 เวลาไทย (10:00 UTC) — เจ้าของสั่ง 9 ต.ค. 69
// แต่ละรอบสรุปเฉพาะเงินที่เก็บหลังรายงานครั้งก่อน (จันทร์ 17:00 → ศุกร์ 17:00 → จันทร์ 17:00) ไม่ซ้ำกัน
// บอกว่าเก็บเงินสาขาไหนแล้ว เก็บเท่าไร เป็นยอดวันไหน วันละเท่าไร · วันไหนยังไม่ได้เก็บ · หัวหน้าถือเงินอยู่เท่าไร
import { createClient } from '@supabase/supabase-js';
import { remitLedger, pendingDays, headCashHeld } from '../src/calc.js';

const n = v => Number(v) || 0;
const money = v => Math.round(v).toLocaleString('th-TH');
const thaiISO = (d = new Date()) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}`;
};
const addDays = (iso, k) => new Date(Date.parse(iso + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
const dm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dmy = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const sum = days => days.reduce((t, d) => t + d.amount, 0);
const REPORT_DAYS = [1, 5];   // จันทร์ ศุกร์
const REPORT_HOUR_UTC = 10;   // 17:00 เวลาไทย
const slotTs = iso => `${iso}T${String(REPORT_HOUR_UTC).padStart(2, '0')}:00:00Z`;
// รายงานรอบก่อนหน้า = จันทร์/ศุกร์ 17:00 ล่าสุดก่อนวันนี้
export function previousSlot(today) {
  for (let k = 1; k <= 7; k++) { const d = addDays(today, -k); if (REPORT_DAYS.includes(new Date(d + 'T00:00:00Z').getUTCDay())) return d; }
  return addDays(today, -7);
}
const bkkHM = ts => new Date(Date.parse(ts) + 7 * 36e5).toISOString().slice(11, 16);

/* สร้างข้อความ — แยกออกมาเพื่อทดสอบได้โดยไม่ต้องต่อฐานข้อมูล/LINE
   branches = [{id,name,cash_tracking_from}] · remits = cash_remittances · headRemits = head_remittances · records = daily_records ที่ส่งแล้ว */
export function buildCashSummaryText({ today, branches, remits, headRemits, records, startTs, endTs }) {
  // ช่วงที่สรุป: ตั้งแต่รายงานครั้งก่อน (จันทร์/ศุกร์ 17:00) ถึงตอนนี้
  const prev = previousSlot(today);
  startTs = startTs || slotTs(prev);
  endTs = endTs || slotTs(today);
  const start = new Date(Date.parse(startTs) + 7 * 36e5).toISOString().slice(0, 10);
  const recs = records.filter(r => { const b = branches.find(x => x.id === r.branch_id); return r.sent && (!b?.cash_tracking_from || r.record_date >= b.cash_tracking_from); });
  const ledger = remitLedger(remits, recs);
  const name = id => (branches.find(b => b.id === id) || {}).name || id;
  const dayRows = ds => ds.map(d => `   ${dm(d.date)}  ${money(d.amount)}`);
  const out = ['💵 สรุปเก็บเงินสดสาขา', `ประจำวันที่ ${dmy(today)}`, `เก็บตั้งแต่ ${dm(start)} ${bkkHM(startTs)} ถึง ${dm(today)} ${bkkHM(endTs)}`, '━━━━━━━━━━━━━━'];

  // 1) เก็บแล้วในช่วงนี้
  const got = ledger.filter(r => { const t = Date.parse(r.created_at || (r.remit_date + 'T00:00:00Z')); return t > Date.parse(startTs) && t <= Date.parse(endTs); })
    .sort((a, c) => String(a.created_at || a.remit_date).localeCompare(String(c.created_at || c.remit_date)));
  out.push('✅ เก็บแล้ว');
  if (!got.length) out.push('   — ยังไม่มีการเก็บเงินตั้งแต่รายงานครั้งก่อน —');
  let total = 0;
  got.forEach(r => {
    const recv = r.method === 'transfer' ? n(r.expected) : r.received_at ? n(r.received_amount ?? r.amount) : null;
    if (recv != null) total += recv;
    const diff = recv != null ? recv - n(r.expected) : 0;
    const status = r.method === 'transfer' ? `โอนเข้าบัญชี ${money(r.expected)}`
      : recv == null ? `ส่งแล้ว ${money(r.expected)} · ⏳ หัวหน้ายังไม่กดรับ`
      : `รับ ${money(recv)}${diff ? ` (ควรได้ ${money(r.expected)} · ${diff < 0 ? 'ขาด' : 'เกิน'} ${money(Math.abs(diff))})` : ''}`;
    out.push(`【${name(r.branch_id)}】 ส่ง ${dm(String(r.remit_date))} · ${status}`, ...dayRows(r.days), '');
  });
  if (got.length) out.push(`รวมรับแล้ว ${money(total)} บาท`);

  // 2) ยังไม่ได้เก็บ — วันก่อนวันนี้ที่ยังค้างอยู่ที่สาขา (ยอดวันนี้เก็บรอบหน้าตามปกติ)
  out.push('━━━━━━━━━━━━━━');
  const late = [], normal = [];
  branches.forEach(b => {
    const mine = ledger.filter(x => x.branch_id === b.id).sort((a, c) => String(c.created_at || c.remit_date).localeCompare(String(a.created_at || a.remit_date)));
    const cutoff = mine[0] ? (mine[0].through_record_date || mine[0].remit_date) : null;
    const ds = pendingDays(recs.filter(r => r.branch_id === b.id), cutoff);
    const old = ds.filter(d => d.date < today), todays = ds.filter(d => d.date >= today);
    if (old.length) late.push({ b, ds: old });
    if (todays.length) normal.push({ b, amount: sum(todays) });
  });
  if (late.length) {
    out.push('⚠️ ยังไม่ได้เก็บ (ค้างที่สาขา)');
    late.forEach(({ b, ds }) => out.push(`【${b.name}】 ${money(sum(ds))} บาท · ${ds.length} วัน`, ...dayRows(ds), ''));
  } else out.push('✓ ไม่มีวันค้าง — เก็บครบทุกสาขาถึงเมื่อวานแล้ว');
  if (normal.length) out.push(`ยอดของวันนี้ เก็บรอบหน้า: ${normal.map(x => `${x.b.name} ${money(x.amount)}`).join(' · ')}`);

  // 3) เงินที่หัวหน้าถืออยู่ ยังไม่ได้ส่งเจ้าของ
  out.push('━━━━━━━━━━━━━━');
  const cashStart = branches.reduce((m, b) => !m || b.cash_tracking_from > m ? b.cash_tracking_from : m, null);
  const held = headCashHeld(remits, headRemits, cashStart);
  const lastHead = headRemits.slice().sort((a, c) => String(c.created_at || c.remit_date).localeCompare(String(a.created_at || a.remit_date)))[0];
  const lastHeadAt = lastHead ? String(lastHead.created_at || lastHead.remit_date) : null;
  const holding = ledger.filter(r => r.method === 'cash' && r.received_at && (!lastHeadAt || String(r.received_at) > lastHeadAt));
  out.push(`👤 หัวหน้าถืออยู่ ${money(held)} บาท${held > 0 ? ' (ยังไม่ได้ส่งเจ้าของ)' : ''}`);
  holding.forEach(r => out.push(`   ${name(r.branch_id)} ${money(n(r.received_amount ?? r.amount))} · ยอด ${r.days.length ? `${dm(r.days[0].date)}–${dm(r.days[r.days.length - 1].date)}` : '—'}`));
  if (lastHead) out.push(`ส่งให้เจ้าของล่าสุด ${dm(String(lastHead.remit_date))} · ${money(lastHead.amount)} บาท`);
  out.push('━━━━━━━━━━━━━━', 'ยอดต่อวัน = เงินสดตอนปิดร้าน − เงินทอน');

  let text = out.join('\n').replace(/\n{3,}/g, '\n\n');
  if (text.length > 4900) text = text.slice(0, 4850) + '\n… (ดูต่อในแอป แท็บเงินเดือน)';
  return text;
}

async function pushLineMessage(token, groupId, text) {
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text }] }),
  });
  if (!response.ok) throw new Error(`LINE returned ${response.status}`);
}

export async function sendCashSummary({ today = thaiISO(), groupId, onDemand = false } = {}) {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const [t, b, r, h, d] = await Promise.all([
    groupId ? Promise.resolve({ data: { group_id: groupId }, error: null })
      : db.from('line_report_targets').select('group_id').eq('id', 'daily_summary').eq('active', true).maybeSingle(),
    db.from('branches').select('id,name,cash_tracking_from').eq('active', true).order('id'),
    db.from('cash_remittances').select('*'),
    db.from('head_remittances').select('*'),
    db.from('daily_records').select('branch_id,record_date,cash,float_cash,sent').eq('sent', true).lte('record_date', today),
  ]);
  if ([t, b, r, h, d].some(x => x.error)) throw new Error('Could not load cash report data');
  if (!t.data?.group_id) throw new Error('LINE group has not been linked yet');
  // พิมพ์ขอเองในกลุ่ม: สรุปตั้งแต่รายงานรอบล่าสุดที่ส่งไปแล้ว จนถึงตอนนี้
  const nowTs = new Date().toISOString();
  const lastSlot = Date.parse(slotTs(today)) <= Date.parse(nowTs) && REPORT_DAYS.includes(new Date(today + 'T00:00:00Z').getUTCDay()) ? today : previousSlot(today);
  const range = onDemand ? { startTs: slotTs(lastSlot), endTs: nowTs } : {};
  const text = buildCashSummaryText({ today, branches: b.data || [], remits: r.data || [], headRemits: h.data || [], records: d.data || [], ...range });
  await pushLineMessage(process.env.LINE_CHANNEL_ACCESS_TOKEN, t.data.group_id, text);
  return { today };
}

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.authorization !== `Bearer ${expected}`) return res.status(401).json({ error: 'Unauthorized' });
  const today = typeof req.query?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : thaiISO();
  try { return res.status(200).json({ ok: true, ...(await sendCashSummary({ today })) }); }
  catch (error) { return res.status(502).json({ error: error.message }); }
}
