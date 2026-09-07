// สต๊อกคลังกลาง + บิลขายวัตถุดิบนอกสาขา — ใช้ร่วมกันทั้งหน้าหัวหน้าและหน้าเจ้าของ
// พอร์ตจาก whAvail()/whTakeUnits()/whReturnUnits()/doIssueExternal()/applyExtEdit() ในต้นแบบ nomicha.html
import { supabase } from './supabaseClient.js';
import { N, todayISO } from './util.js';

// ของที่หยิบขายได้จริงของแต่ละรายการ (ลังเต็ม × จำนวนต่อลัง + ชิ้นเศษ)
export async function whAvailMap(stockItems) {
  const { data } = await supabase.from('warehouse_stock').select('*');
  const m = {};
  (data || []).forEach(s => {
    const it = stockItems.find(x => x.id === s.item_id);
    if (it) m[s.item_id] = (s.case_qty || 0) * it.per_case + (s.loose_qty || 0);
  });
  return m;
}

const defaultRow = it => ({ case_qty: 0, loose_qty: 0, last_checked: null,
  avg_cost: 0 });

// หยิบของออก qty หน่วย — หยิบจากชิ้นเศษก่อน ไม่พอค่อยแกะลังเต็ม (พอร์ตจาก whTakeUnits)
function takeFrom(row, it, qty) {
  let loose = row.loose_qty || 0, cases = row.case_qty || 0, need = qty;
  if (need <= loose) loose -= need;
  else { need -= loose; loose = 0; const c = Math.ceil(need / it.per_case); cases -= c; loose += c * it.per_case - need; }
  return { case_qty: cases, loose_qty: loose };
}
// คืนของกลับเข้าคลัง qty หน่วย — เข้าเป็นชิ้นเศษ แล้วยุบเป็นลังเต็มถ้าครบ (พอร์ตจาก whReturnUnits)
function returnTo(row, it, qty) {
  let loose = (row.loose_qty || 0) + qty, cases = row.case_qty || 0;
  if (it.per_case > 0 && loose >= it.per_case) { const c = Math.floor(loose / it.per_case); cases += c; loose -= c * it.per_case; }
  return { case_qty: cases, loose_qty: loose };
}

// ปรับสต๊อกหลายรายการพร้อมกัน — delta > 0 = หยิบออก, delta < 0 = คืนเข้า
async function applyStockDeltas(stockItems, deltas) {
  const ids = Object.keys(deltas).map(Number).filter(id => deltas[id] !== 0);
  if (!ids.length) return;
  const { data: rows } = await supabase.from('warehouse_stock').select('*').in('item_id', ids);
  await Promise.all(ids.map(id => {
    const it = stockItems.find(x => x.id === id); if (!it) return null;
    const row = (rows || []).find(s => s.item_id === id) || defaultRow(it);
    const d = deltas[id];
    const next = d > 0 ? takeFrom(row, it, d) : returnTo(row, it, -d);
    return supabase.from('warehouse_stock').upsert(
      { item_id: id, ...next, avg_cost: row.avg_cost, last_checked: row.last_checked }, { onConflict: 'item_id' });
  }));
}

/* ออกบิลขายนอกสาขา — ตัดสต๊อกคลังกลางทันที ใช้ราคาส่งสาขาทุกรายการ
   lines = [{ it, qty }] · คืน { error } ถ้าของไม่พอหรือบันทึกไม่สำเร็จ */
export async function issueExternalSale({ buyer, lines, issuerId, stockItems, avail }) {
  if (!buyer) return { error: 'กรอกชื่อร้าน/ผู้ซื้อก่อน' };
  if (!lines.length) return { error: 'เลือกจำนวนอย่างน้อย 1 รายการ' };
  for (const l of lines) {
    const av = avail[l.it.id] ?? 0;
    if (l.qty > av) return { error: `${l.it.name} มีไม่พอ (เหลือ ${av} ${l.it.unit})` };
  }
  let total = 0;
  const items = lines.map(({ it, qty }) => { total += qty * it.branch_price; return { item_id: it.id, qty, price: it.branch_price }; });
  const deltas = {}; lines.forEach(({ it, qty }) => { deltas[it.id] = qty; });
  await applyStockDeltas(stockItems, deltas);
  const { error } = await supabase.from('external_sales')
    .insert({ sale_date: todayISO(), buyer, issuer: issuerId, items, total, paid: false });
  if (error) return { error: 'ออกบิลไม่สำเร็จ: ' + error.message };
  return { total };
}

/* แก้ไขบิลขายนอกย้อนหลัง (เฉพาะเจ้าของ) — ปรับสต๊อกคลังกลางตามส่วนต่างให้อัตโนมัติ
   ลดจำนวน = คืนของเข้าคลัง · เพิ่มจำนวน = หยิบออกเพิ่ม (ถ้าของไม่พอจะไม่ให้แก้)
   ตั้งจำนวนเป็น 0 ทุกรายการ = ยกเลิกบิล (ของกลับเข้าคลังครบ ยอดบิลเป็น 0) */
export async function editExternalSale({ sale, draftQty, stockItems, avail, byName }) {
  const qtyOf = li => (draftQty[li.item_id] != null && draftQty[li.item_id] !== '') ? N(draftQty[li.item_id]) : li.qty;
  for (const li of sale.items) {
    const q = qtyOf(li);
    if (q < 0) return { error: 'จำนวนติดลบไม่ได้' };
    const it = stockItems.find(x => x.id === li.item_id);
    if (q > li.qty && it && (q - li.qty) > (avail[li.item_id] ?? 0)) {
      return { error: `${it.name} มีไม่พอสำหรับเพิ่มจำนวน (เหลือ ${avail[li.item_id] ?? 0} ${it.unit})` };
    }
  }
  const deltas = {}; const changes = [];
  sale.items.forEach(li => {
    const q = qtyOf(li);
    if (q === li.qty) return;
    const it = stockItems.find(x => x.id === li.item_id);
    deltas[li.item_id] = q - li.qty;                       // + = หยิบออกเพิ่ม, − = คืนเข้าคลัง
    changes.push(`${it ? it.name : li.item_id} ${li.qty}→${q}${it ? ' ' + it.unit : ''}`);
    li.qty = q;
  });
  if (!changes.length) return { error: 'ไม่มีอะไรเปลี่ยน' };
  await applyStockDeltas(stockItems, deltas);
  const items = sale.items.filter(li => li.qty > 0);
  const total = items.reduce((s, li) => s + li.qty * li.price, 0);
  const edit_log = (sale.edit_log || []).concat({ label: changes.join(' · '), by: byName || '', at: new Date().toISOString() });
  const { error } = await supabase.from('external_sales').update({ items, total, edit_log }).eq('id', sale.id);
  if (error) return { error: 'บันทึกไม่สำเร็จ: ' + error.message };
  return { changes: changes.length, cancelled: items.length === 0, total };
}
