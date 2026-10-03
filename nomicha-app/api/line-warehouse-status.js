// Vercel Cron: เช็กของในคลังทุกวันอาทิตย์และพฤหัส 08:00 เวลาไทย (01:00 UTC)
import { createClient } from '@supabase/supabase-js';

const n = value => Number(value) || 0;
const money = value => Math.round(value).toLocaleString('th-TH');
const thaiDate = (now = new Date()) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).reduce((out, x) => ({ ...out, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}`;
};
const shipNeed = (par, have, pack) => {
  const short = n(par) - n(have);
  const step = Math.max(1, Math.floor(n(pack)) || 1);
  return short > 0 ? Math.ceil(short / step) * step : 0;
};

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
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: target, error: targetError }, { data: items, error: itemError }, { data: stock, error: stockError },
    { data: parRows, error: parError }, { data: branches, error: branchError }, { data: records, error: recordError }] = await Promise.all([
    db.from('line_report_targets').select('group_id').eq('id', 'daily_summary').eq('active', true).maybeSingle(),
    db.from('stock_items').select('id,name,unit,per_case,ship_pack').eq('active', true).order('display_order'),
    db.from('warehouse_stock').select('item_id,case_qty,loose_qty'),
    db.from('stock_par_levels').select('branch_id,item_id,par_qty'),
    db.from('branches').select('id,name').eq('active', true).order('id'),
    db.from('daily_records').select('branch_id,record_date,stock_snapshot').eq('sent', true).order('record_date', { ascending: false }),
  ]);
  if (targetError || itemError || stockError || parError || branchError || recordError)
    return res.status(500).json({ error: 'Could not load warehouse report data' });
  if (!target?.group_id) return res.status(409).json({ error: 'LINE group has not been linked yet' });

  // เลือกยอดปิดล่าสุดของแต่ละสาขา เพื่อคิดว่าแต่ละสาขาขาดอะไรจากระดับที่ต้องมีต่อรอบ
  const latestByBranch = new Map();
  (records || []).forEach(record => { if (!latestByBranch.has(record.branch_id)) latestByBranch.set(record.branch_id, record); });
  const parByKey = new Map((parRows || []).map(row => [`${row.branch_id}:${row.item_id}`, n(row.par_qty)]));
  const stockByItem = new Map((stock || []).map(row => [row.item_id, row]));
  const shortages = [];
  let needsDelivery = 0;

  for (const item of items || []) {
    let needed = 0, branchesNeeding = 0;
    for (const branch of branches || []) {
      const snapshot = latestByBranch.get(branch.id)?.stock_snapshot || {};
      const need = shipNeed(parByKey.get(`${branch.id}:${item.id}`), snapshot[item.id], item.ship_pack);
      if (need > 0) { needed += need; branchesNeeding += 1; }
    }
    if (!needed) continue;
    needsDelivery += 1;
    const row = stockByItem.get(item.id);
    const available = n(row?.case_qty) * n(item.per_case) + n(row?.loose_qty);
    if (available < needed) shortages.push({ item, available, needed, branchesNeeding, fill: needed - available });
  }

  const date = thaiDate();
  const message = [`📦 สถานะคลังกลาง`, `ตรวจ ${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`,
    '━━━━━━━━━━━━━━'];
  if (!shortages.length) {
    message.push('ของในคลังพอสำหรับจัดส่งตามยอดคงเหลือล่าสุดของทุกสาขา', `มีรายการต้องจัดส่ง ${needsDelivery} รายการ`);
  } else {
    message.push(`ต้องเติม ${shortages.length} รายการ ก่อนรอบส่งถัดไป`, '');
    shortages.forEach(({ item, available, needed, branchesNeeding, fill }) => {
      message.push(`【${item.name}】`, `คลังมี ${money(available)} ${item.unit} · ต้องจัด ${money(needed)} ${item.unit} (${branchesNeeding} สาขา)`, `ต้องเติม ${money(fill)} ${item.unit}`, '');
    });
  }
  message.push('━━━━━━━━━━━━━━', 'คำนวณจากยอดคงเหลือล่าสุดของแต่ละสาขา');
  try { await pushLineMessage(process.env.LINE_CHANNEL_ACCESS_TOKEN, target.group_id, message.join('\n')); }
  catch (error) { return res.status(502).json({ error: error.message }); }
  return res.status(200).json({ ok: true, shortages: shortages.length, needsDelivery });
}
