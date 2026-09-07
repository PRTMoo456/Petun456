import { supabase } from './supabaseClient.js';
import { USERNAME_RE } from './auth.js';

/* งานที่ต้องใช้สิทธิ์ผู้ดูแล (สร้างบัญชี / เปลี่ยนรหัสผ่าน / เปลี่ยนชื่อผู้ใช้)
   ทำในหน้าเว็บตรง ๆ ไม่ได้ เพราะต้องใช้ service_role key ซึ่งถ้าอยู่ในหน้าเว็บใครก็เปิดดูได้
   จึงส่งไปให้ Edge Function ชื่อ admin-users ทำแทน (โค้ดอยู่ที่ supabase/functions/admin-users)
   ตัวฟังก์ชันเช็คซ้ำอีกชั้นว่าคนเรียกเป็น "เจ้าของ" จริง */
export async function adminCall(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { action, ...payload } });
  if (error) {
    // ข้อความจริงอยู่ในตัว response — ดึงออกมาบอกเจ้าของให้ตรงเรื่อง แทนคำว่า "error" ลอย ๆ
    let msg = '';
    try { msg = (await error.context?.json())?.error || ''; } catch { /* อ่านไม่ได้ก็ช่างมัน */ }
    if (!msg && String(error.message || '').includes('Failed to send')) {
      msg = 'ยังไม่ได้ติดตั้งตัวช่วยจัดการบัญชี (Edge Function ชื่อ "admin-users") — ดู DEPLOY.md ขั้นที่ 2.3';
    }
    return { error: msg || error.message || 'ทำรายการไม่สำเร็จ' };
  }
  if (data && data.error) return { error: data.error };
  return { data: data || {} };
}

export const usernameError = u =>
  USERNAME_RE.test(String(u || '').trim().toLowerCase())
    ? '' : 'ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษเล็ก/ตัวเลข 3-30 ตัว (ห้ามภาษาไทย ห้ามเว้นวรรค)';

// เลขบัตรประชาชนไทย 13 หลัก — ตรวจหลักสุดท้ายด้วย ไม่ให้พิมพ์ผิดแล้วไปโผล่บนสลิปเงินเดือน
export function nationalIdError(v) {
  const s = String(v || '').replace(/\D/g, '');
  if (!s) return '';                       // ปล่อยว่างได้ (ยังไม่ได้กรอก)
  if (s.length !== 13) return 'เลขบัตรประชาชนต้องมี 13 หลัก';
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += +s[i] * (13 - i);
  return (11 - (sum % 11)) % 10 === +s[12] ? '' : 'เลขบัตรประชาชนไม่ถูกต้อง (หลักตรวจสอบไม่ตรง) — ตรวจตัวเลขอีกครั้ง';
}
