import { supabase } from './supabaseClient.js';
import { $, toast } from './util.js';

// พนักงานล็อกอินด้วย "ชื่อผู้ใช้ + รหัสผ่าน" ที่เจ้าของตั้งให้ในหน้า จัดการสาขา
// เบื้องหลัง Supabase Auth บังคับให้บัญชีเป็นรูปแบบอีเมล ระบบจึงต่อ "@nomicha.local" ให้เองอัตโนมัติ
// (ไม่มีการส่งอีเมลจริง โดเมนนี้ไม่มีอยู่จริง ใช้เป็นรูปแบบชื่อบัญชีเท่านั้น)
export const LOGIN_DOMAIN = 'nomicha.local';
export const userToEmail = u => `${String(u || '').trim().toLowerCase()}@${LOGIN_DOMAIN}`;
export const emailToUser = e => String(e || '').split('@')[0];
// ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ/ตัวเลขเท่านั้น เพราะต้องเอาไปประกอบเป็นอีเมลให้ Supabase ยอมรับ
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getMyEmployee() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('employees')
    .select('id,name,first_name,last_name,role,branch_id,employer_company_id,base_salary,days_off_quota,delivery_pay,active')
    .eq('id', user.id).maybeSingle();
  if (error) { console.error(error); return null; }
  if (!data) {
    // มีบัญชี auth แต่ยังไม่มีแถวใน employees — เจ้าของยังตั้งค่าไม่ครบ (ดู docs/DEPLOY.md ขั้นที่ 2.4)
    toast('บัญชีนี้ยังไม่ถูกผูกกับพนักงานคนไหน — แจ้งเจ้าของให้ตรวจหน้า จัดการสาขา');
    return null;
  }
  return data;
}

export function renderLogin(container, onSuccess) {
  container.innerHTML = `
    <div class="loginwrap">
      <h1>ปิดยอดโนมิชา</h1>
      <p class="sub" style="margin-bottom:18px">เข้าสู่ระบบด้วยชื่อผู้ใช้ที่เจ้าของตั้งให้</p>
      <div class="card pad">
        <div class="field2"><label>ชื่อผู้ใช้</label><input type="text" id="loginUser" autocomplete="username"
          autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="latin" placeholder="เช่น laonadee" /></div>
        <div class="field2"><label>รหัสผ่าน</label><input type="password" id="loginPass" autocomplete="current-password" /></div>
        <div class="err" id="loginErr" hidden></div>
        <button class="btn primary big" id="loginBtn">เข้าสู่ระบบ</button>
      </div>
    </div>`;
  const err = $('#loginErr');
  $('#loginBtn').addEventListener('click', async () => {
    err.hidden = true;
    const username = $('#loginUser').value.trim().toLowerCase();
    const password = $('#loginPass').value;
    if (!username || !password) { err.textContent = 'กรอกชื่อผู้ใช้และรหัสผ่านให้ครบ'; err.hidden = false; return; }
    // ผู้ใช้พิมพ์อีเมลเต็มมาก็รับได้ (บัญชีเก่าที่สร้างไว้ก่อนเปลี่ยนระบบ)
    const email = username.includes('@') ? username : userToEmail(username);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { err.textContent = 'เข้าสู่ระบบไม่สำเร็จ — ตรวจชื่อผู้ใช้/รหัสผ่านอีกครั้ง'; err.hidden = false; return; }
    onSuccess();
  });
  // กด Enter ในช่องรหัสผ่านแล้วล็อกอินได้เลย ไม่ต้องกดปุ่ม
  $('#loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginBtn').click(); });
}

export async function signOut() {
  await supabase.auth.signOut();
  location.reload();
}
