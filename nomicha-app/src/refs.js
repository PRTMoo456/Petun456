// ข้อมูลอ้างอิงที่ทุกหน้าใช้ร่วมกัน (สาขา/วัตถุดิบ/รอบส่งของ) — โหลดครั้งเดียวตอนเปิดหน้า
// รวมไว้ที่เดียวเพื่อให้ทุกหน้าเห็นชุดเดียวกันเสมอ (เช่นถ้าเปลี่ยนเงื่อนไข active หรือลำดับการเรียง จะมีผลพร้อมกันทุกหน้า)
import { supabase } from './supabaseClient.js';

let refsPromise;
// ลำดับที่ใช้แสดงในทุกหน้าที่เลือกสาขา (ไม่ผูกกับรหัสสาขาในฐานข้อมูล)
const BRANCH_ORDER = ['lnd', 'bwa', 'ksk', 'bdt', 'nlb'];
const sortBranches = branches => branches.sort((a, b) => {
  const ai = BRANCH_ORDER.indexOf(a.id), bi = BRANCH_ORDER.indexOf(b.id);
  return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
});
const sortRounds = rounds => rounds.sort((a, b) => {
  // เรียงสัปดาห์โดยเริ่มวันจันทร์ เพื่อให้รอบจันทร์อยู่ก่อนรอบศุกร์เสมอ
  const weekOrder = day => (day + 6) % 7;
  return weekOrder(a.day_of_week) - weekOrder(b.day_of_week) || a.id.localeCompare(b.id);
});

export async function loadRefs() {
  // ข้อมูลชุดนี้เปลี่ยนเฉพาะเมื่อเจ้าของบันทึกการตั้งค่า จึงใช้ร่วมกันตลอด session
  // เพื่อไม่ให้การวาดหน้าจอ/สลับแท็บยิง query เดิมซ้ำโดยไม่จำเป็น
  if (!refsPromise) {
    refsPromise = Promise.all([
      supabase.from('branches').select('id,name,float_cash,days_off_quota,holiday_work_days,gps_lat,gps_lng,gps_radius,work_start,work_end,late_grace_min,company_id,active,cash_tracking_from').eq('active', true).order('id'),
      supabase.from('stock_items').select('id,name,unit,min_qty,per_case,branch_price,category_id,display_order,active').eq('active', true).order('display_order'),
      supabase.from('delivery_rounds').select('id,name,day_of_week,branch_ids'),
    ]).then(results => {
      const failed = results.find(result => result.error);
      if (failed) throw failed.error;
      const [{ data: branches }, { data: items }, { data: rounds }] = results;
      return { branches: sortBranches(branches || []), stockItems: items || [], rounds: sortRounds(rounds || []) };
    })
      .catch(error => { refsPromise = undefined; throw error; });
  }
  return refsPromise;
}

export function invalidateRefs() { refsPromise = undefined; }
