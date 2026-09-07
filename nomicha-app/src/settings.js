import { supabase } from './supabaseClient.js';

// โหลดค่าคงที่ทางธุรกิจทั้งหมดจากตาราง settings ครั้งเดียวตอนเข้าแอป (แทนค่าคงที่ตายตัวในต้นแบบ)
// ให้เจ้าของแก้ค่าพวกนี้ได้จากหน้าตั้งค่าจริงในอนาคต โดยไม่ต้องแก้โค้ด/deploy ใหม่
let cache = null;

export async function loadSettings() {
  const { data, error } = await supabase.from('settings').select('key,value');
  if (error) throw error;
  const s = {};
  for (const row of data) s[row.key] = row.value;
  cache = {
    grabCommissionPct: s.grab_commission_pct ?? 0.321,
    costDiscountPct: s.cost_discount_pct ?? 0.10,
    advanceCap: s.advance_cap ?? 4000,
    loanCap: s.loan_cap ?? 2000,
    loanInterestPct: s.loan_interest_pct ?? 0.10,
    advanceDay: s.advance_day ?? 20,
    settleDays: s.settle_days ?? [5, 20],
    cupPrice: s.cup_price ?? { yen: 25, pan: 35 },
    cupsPerRow: s.cups_per_row ?? { yen: 50, pan: 25 },
    diligenceRules: s.diligence_rules ?? { step: 500, cap: 1500, lateAllowance: 250 },
    holidayPayScale: s.holiday_pay_scale ?? [400, 450, 500, 550],
    overuseThresholdUnits: s.overuse_threshold_units ?? 0.5,
    // กติกาจ่าย/หัก — ค่าแก้ว/บาทต่อนาทีที่สาย/ค่าปรับลืมลงเวลา/ค่าปรับหยุดเกินโควตา
    payRules: { cupPay: 1, latePerMin: 1, earlyPerMin: 1, noClock: 40, excessDayOff: 330, ...(s.pay_rules || {}) },
  };
  return cache;
}

export function getSettings() {
  if (!cache) throw new Error('settings ยังไม่ได้โหลด — เรียก loadSettings() ก่อน');
  return cache;
}
