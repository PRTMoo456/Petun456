// ข้อมูลอ้างอิงที่ทุกหน้าใช้ร่วมกัน (สาขา/วัตถุดิบ/รอบส่งของ) — โหลดครั้งเดียวตอนเปิดหน้า
// รวมไว้ที่เดียวเพื่อให้ทุกหน้าเห็นชุดเดียวกันเสมอ (เช่นถ้าเปลี่ยนเงื่อนไข active หรือลำดับการเรียง จะมีผลพร้อมกันทุกหน้า)
import { supabase } from './supabaseClient.js';

export async function loadRefs() {
  const [{ data: branches }, { data: items }, { data: rounds }] = await Promise.all([
    supabase.from('branches').select('*').eq('active', true).order('id'),
    supabase.from('stock_items').select('*').eq('active', true).order('display_order'),
    supabase.from('delivery_rounds').select('*'),
  ]);
  return { branches: branches || [], stockItems: items || [], rounds: rounds || [] };
}
