// สต๊อกคลังกลาง + บิลขายวัตถุดิบนอกสาขา — ใช้ร่วมกันทั้งหน้าหัวหน้าและหน้าเจ้าของ
// พอร์ตจาก whAvail()/whTakeUnits()/whReturnUnits()/doIssueExternal()/applyExtEdit() ในต้นแบบ nomicha.html
import { supabase } from './supabaseClient.js';
import { N } from './util.js';

// ของที่หยิบขายได้จริงของแต่ละรายการ (ลังเต็ม × จำนวนต่อลัง + ชิ้นเศษ)
export async function whAvailMap(stockItems, stockRows) {
  const { data, error } = stockRows === undefined
    ? await supabase.from('warehouse_stock').select('item_id,case_qty,loose_qty')
    : { data: stockRows };
  if (error) throw error;
  const m = {};
  (data || []).forEach(s => {
    const it = stockItems.find(x => x.id === s.item_id);
    if (it) m[s.item_id] = (s.case_qty || 0) * it.per_case + (s.loose_qty || 0);
  });
  return m;
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
  if (lines.some(l => l.qty <= 0 || !Number.isInteger(l.qty))) return { error: 'จำนวนสินค้าต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป' };
  const items = lines.map(({ it, qty }) => ({ item_id: it.id, qty }));
  const { data, error } = await supabase.rpc('create_external_sale', { p_buyer: buyer, p_items: items });
  if (error) return { error: 'ออกบิลไม่สำเร็จ: ' + error.message };
  return { total: N(data?.total), id: data?.id };
}

/* แก้ไขบิลขายนอกย้อนหลัง (เฉพาะเจ้าของ) — ปรับสต๊อกคลังกลางตามส่วนต่างให้อัตโนมัติ
   ลดจำนวน = คืนของเข้าคลัง · เพิ่มจำนวน = หยิบออกเพิ่ม (ถ้าของไม่พอจะไม่ให้แก้)
   ตั้งจำนวนเป็น 0 ทุกรายการ = ยกเลิกบิล (ของกลับเข้าคลังครบ ยอดบิลเป็น 0) */
export async function editExternalSale({ sale, draftQty, stockItems, avail, byName }) {
  const qtyOf = li => (draftQty[li.item_id] != null && draftQty[li.item_id] !== '') ? N(draftQty[li.item_id]) : li.qty;
  for (const li of sale.items) {
    const q = qtyOf(li);
    if (q < 0 || !Number.isInteger(q)) return { error: 'จำนวนสินค้าต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป' };
    const it = stockItems.find(x => x.id === li.item_id);
    if (q > li.qty && it && (q - li.qty) > (avail[li.item_id] ?? 0)) {
      return { error: `${it.name} มีไม่พอสำหรับเพิ่มจำนวน (เหลือ ${avail[li.item_id] ?? 0} ${it.unit})` };
    }
  }
  const changes = [];
  sale.items.forEach(li => {
    const q = qtyOf(li);
    if (q === li.qty) return;
    const it = stockItems.find(x => x.id === li.item_id);
    changes.push(`${it ? it.name : li.item_id} ${li.qty}→${q}${it ? ' ' + it.unit : ''}`);
    li.qty = q;
  });
  if (!changes.length) return { error: 'ไม่มีอะไรเปลี่ยน' };
  const items = sale.items.filter(li => li.qty > 0);
  const { data, error } = await supabase.rpc('edit_external_sale', {
    p_sale_id: sale.id,
    p_items: items.map(li => ({ item_id: li.item_id, qty: li.qty })),
    p_editor_name: byName || '',
  });
  if (error) return { error: 'บันทึกไม่สำเร็จ: ' + error.message };
  return { changes: changes.length, cancelled: items.length === 0, total: N(data?.total) };
}
