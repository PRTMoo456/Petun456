// ส่งเฉพาะวันสุดท้ายของเดือน 21:00 ไทย; cron เรียกทุกวันเพื่อให้ตรวจวันสุดท้ายได้แน่นอน
import { createClient } from '@supabase/supabase-js';
import { calcDay, payrollFor, payrollForRelief, branchPL, warehousePL, monthMaterialCost, rentAt } from '../src/calc.js';

const n = v => Number(v) || 0;
const money = v => Math.round(v).toLocaleString('th-TH');
const thaiParts = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
const thaiISO = date => { const p = thaiParts(date); return `${p.year}-${p.month}-${p.day}`; };
const datesInMonth = key => { const [y, m] = key.split('-').map(Number), last = new Date(y, m, 0).getDate(); return Array.from({ length: last }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`); };
const cfgFrom = rows => { const s = Object.fromEntries((rows || []).map(r => [r.key, r.value])); return { grabCommissionPct: n(s.grab_commission_pct || .321), cupPrice: s.cup_price || { yen: 25, pan: 35 }, cupsPerRow: s.cups_per_row || { yen: 50, pan: 25 }, diligenceRules: s.diligence_rules || { step: 500, cap: 1500, lateAllowance: 250 }, holidayPayScale: s.holiday_pay_scale || [400,450,500,550], payRules: { cupPay: 1, latePerMin: 1, earlyPerMin: 1, excessDayOff: 330, ...(s.pay_rules || {}) } }; };
async function push(token, to, text) { const r = await fetch('https://api.line.me/v2/bot/message/push', { method:'POST', headers:{'content-type':'application/json',authorization:`Bearer ${token}`}, body:JSON.stringify({to,messages:[{type:'text',text}]}) }); if (!r.ok) throw new Error(`LINE returned ${r.status}`); }

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({error:'Unauthorized'});
  const today = thaiISO(), tomorrow = thaiISO(new Date(Date.now() + 86400000));
  if (today.slice(0,7) === tomorrow.slice(0,7)) return res.status(200).json({ok:true, skipped:'Not the last day of the month'});
  const month = today.slice(0,7), dates = datesInMonth(month);
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
  const [targetR, branchesR, employeesR, recordsR, clocksR, deliveriesR, itemsR, repairsR, settingsR, rentR, whRentR, externalR] = await Promise.all([
    db.from('line_report_targets').select('group_id').eq('id','daily_summary').eq('active',true).maybeSingle(), db.from('branches').select('*').eq('active',true), db.from('employees').select('*').eq('active',true),
    db.from('daily_records').select('*').gte('record_date',dates[0]).lte('record_date',dates.at(-1)).eq('sent',true), db.from('clock_records').select('*').gte('clock_date',dates[0]).lte('clock_date',dates.at(-1)),
    db.from('deliveries').select('*').gte('delivery_date',dates[0]).lte('delivery_date',dates.at(-1)), db.from('stock_items').select('*').eq('active',true), db.from('repairs').select('*').gte('repair_date',dates[0]).lte('repair_date',dates.at(-1)),
    db.from('settings').select('key,value'), db.from('branch_rent_history').select('*').order('effective_from'), db.from('warehouse_rent_history').select('*').order('effective_from'), db.from('external_sales').select('*').gte('sale_date',dates[0]).lte('sale_date',dates.at(-1)),
  ]);
  if ([targetR,branchesR,employeesR,recordsR,clocksR,deliveriesR,itemsR,repairsR,settingsR,rentR,whRentR,externalR].some(x=>x.error)) return res.status(500).json({error:'Could not load monthly report data'});
  if (!targetR.data?.group_id) return res.status(409).json({error:'LINE group has not been linked yet'});
  const cfg = cfgFrom(settingsR.data), branches = branchesR.data || [], records = recordsR.data || [], clocks = clocksR.data || [], items = itemsR.data || [], deliveries = deliveriesR.data || [], repairs = repairsR.data || [], emps = employeesR.data || [];
  const relief = emps.find(e=>e.role==='relief'), stockById = Object.fromEntries(items.map(i=>[i.id,i]));
  const clocksByBranch = {}; clocks.forEach(c=>((clocksByBranch[c.branch_id] ||= {})[c.clock_date]=c));
  const branchLines=[]; let totalSales=0,totalCups=0,totalOrders=0,totalSalary=0,totalNet=0;
  for (const b of branches) {
    const recs=records.filter(r=>r.branch_id===b.id), dlv=deliveries.filter(d=>d.branch_id===b.id), emp=emps.find(e=>e.role==='staff'&&e.branch_id===b.id) || {base_salary:0,days_off_quota:b.days_off_quota};
    const pr=payrollFor({branch:{...b,relief_name:relief?.name||'',base_salary:n(emp.base_salary),days_off_quota:n(b.days_off_quota)},records:recs,clocksByDate:clocksByBranch[b.id]||{},allDatesInMonth:dates,todayISO:tomorrow,cfg});
    const sale=recs.reduce((s,r)=>s+(calcDay(r,clocksByBranch[b.id]?.[r.record_date],cfg)?.income||0)-(calcDay(r,clocksByBranch[b.id]?.[r.record_date],cfg)?.expense||0),0);
    const grab=recs.reduce((s,r)=>s+n(r.grab),0), grabComm=recs.reduce((s,r)=>s+n(calcDay(r,clocksByBranch[b.id]?.[r.record_date],cfg)?.grabCommission),0), material=monthMaterialCost(dlv,stockById), rent=rentAt((rentR.data||[]).filter(x=>x.branch_id===b.id).map(x=>({from:x.effective_from,rent:x.rent})),dates[0]), repair=repairs.filter(x=>x.branch_id===b.id);
    const net=branchPL({sales:sale,grab,grabCommission:grabComm,materialCost:material,rent,repairs:repair,grabCommissionPct:cfg.grabCommissionPct,payroll:pr}).net, cups=recs.reduce((s,r)=>s+n(calcDay(r,clocksByBranch[b.id]?.[r.record_date],cfg)?.cups),0);
    totalSales+=sale;totalCups+=cups;totalOrders+=material;totalSalary+=pr.total;totalNet+=net;
    branchLines.push(`【${b.name}】\nยอดขายสุทธิ ${money(sale)} บาท · ${money(cups)} แก้ว\nยอดสั่งของ ${money(material)} บาท · ใช้วัตถุดิบ ${sale?((material/sale)*100).toFixed(1):'0.0'}%\nเงินเดือนพนักงาน ${money(pr.total)} บาท\nกำไรสุทธิ ${money(net)} บาท`);
  }
  const whRent=rentAt((whRentR.data||[]).map(x=>({from:x.effective_from,rent:x.rent})),dates[0]), prR=payrollForRelief({relief:{...relief,base_salary:n(relief?.base_salary),delivery_pay:n(relief?.delivery_pay)},allBranchRecords:records,allBranchClocksByDate:clocksByBranch,todayISO:tomorrow,cfg,whRent,monthEnd:dates.at(-1)}), wh=warehousePL({deliveries,externalSales:externalR.data||[],stockItemsById:stockById,avgCostById:{},reliefPayroll:prR}); totalSalary+=prR.total; totalNet+=wh.net;
  const year=Number(month.slice(0,4))+543, msg=['📈 สรุปผลประกอบการร้านน้ำคาเซน',`ประจำเดือน ${month.slice(5,7)}/${year}`,'━━━━━━━━━━━━━━',branchLines.join('\n\n'),'━━━━━━━━━━━━━━',`【คลังกลาง】\nยอดส่งวัตถุดิบ ${money(wh.sales)} บาท\nเงินเดือนหัวหน้าและค่าใช้จ่าย ${money(prR.total)} บาท\nกำไร/ขาดทุน ${money(wh.net)} บาท`,'━━━━━━━━━━━━━━',`💰 ยอดขายรวม ${money(totalSales)} บาท`,`🥤 รวม ${money(totalCups)} แก้ว`,`📦 ยอดสั่งของรวม ${money(totalOrders)} บาท`,`💼 เงินเดือนรวมทุกคน ${money(totalSalary)} บาท`,`✅ กำไรสุทธิรวม ${money(totalNet)} บาท`].join('\n');
  try { await push(process.env.LINE_CHANNEL_ACCESS_TOKEN,targetR.data.group_id,msg); } catch(e) { return res.status(502).json({error:e.message}); }
  return res.status(200).json({ok:true,month});
}
