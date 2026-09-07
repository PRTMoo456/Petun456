// ตัวแทน supabaseClient.js ตอนทดสอบ — ชี้ไปที่ฐานข้อมูลจำลองใน globalThis (ไม่ต้องแก้โค้ดจริงเพื่อการทดสอบ)
export const supabase = new Proxy({}, { get: (_t, p) => globalThis.__mockSupabase[p] });
