// Vercel Cron: ส่งสรุปยอดปิดร้านทุกวัน 21:00 เวลาไทย (14:00 UTC)
import { createClient } from '@supabase/supabase-js';

const n = value => Number(value) || 0;
const thaiDate = (now = new Date()) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).reduce((out, x) => ({ ...out, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}`;
};
const money = value => Math.round(value).toLocaleString('th-TH');

function daySummary(record) {
  if (record.store_closed) return { closed: true, cups: 0, sales: 0 };
  const yen = n(record.open_yen) + n(record.yen_add) - n(record.yen);
  const pan = n(record.open_pan) + n(record.pan_add) - n(record.pan);
  const income = yen * n(record.cup_price_yen || 25) + pan * n(record.cup_price_pan || 35)
    + n(record.cup_own) + n(record.topping) + n(record.other);
  const expense = n(record.ice) + n(record.water) + n(record.etc);
  return { closed: false, cups: yen + pan, sales: income - expense };
}

async function pushLineMessage(token, groupId, text) {
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text }] }),
  });
  if (!response.ok) throw new Error(`LINE returned ${response.status}`);
}

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.authorization !== `Bearer ${expected}`) return res.status(401).json({ error: 'Unauthorized' });
  const date = typeof req.query.date === 'string' ? req.query.date : thaiDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: target, error: targetError }, { data: branches, error: branchError }, { data: records, error: recordError }] = await Promise.all([
    db.from('line_report_targets').select('group_id').eq('id', 'daily_summary').eq('active', true).maybeSingle(),
    db.from('branches').select('id,name').eq('active', true).order('id'),
    db.from('daily_records').select('*').eq('record_date', date).eq('sent', true),
  ]);
  if (targetError || branchError || recordError) return res.status(500).json({ error: 'Could not load report data' });
  if (!target?.group_id) return res.status(409).json({ error: 'LINE group has not been linked yet' });

  const byBranch = new Map((records || []).map(record => [record.branch_id, record]));
  let sales = 0, cups = 0;
  const lines = (branches || []).map(branch => {
    const record = byBranch.get(branch.id);
    if (!record) return `• ${branch.name}: ยังไม่ส่งยอด`;
    const sum = daySummary(record); sales += sum.sales; cups += sum.cups;
    return sum.closed ? `• ${branch.name}: ปิดร้าน` : `• ${branch.name}: ยอดสุทธิ ${money(sum.sales)} · ${sum.cups} แก้ว`;
  });
  const text = [`สรุปยอดร้านน้ำคาเซน ${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`, ...lines,
    '', `รวมยอดสุทธิ ${money(sales)}`, `รวม ${cups} แก้ว`].join('\n');
  try { await pushLineMessage(process.env.LINE_CHANNEL_ACCESS_TOKEN, target.group_id, text); }
  catch (error) { return res.status(502).json({ error: error.message }); }
  return res.status(200).json({ ok: true, date, sales, cups });
}
