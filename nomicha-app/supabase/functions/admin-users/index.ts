// Supabase Edge Function — งานที่ต้องใช้สิทธิ์ผู้ดูแล (สร้างบัญชี / เปลี่ยนรหัสผ่าน / เปลี่ยนชื่อผู้ใช้)
// ต้องอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น เพราะใช้ service_role key ซึ่งห้ามหลุดไปอยู่ในหน้าเว็บเด็ดขาด
// (ใครถือ key นี้ = แก้ฐานข้อมูลได้ทุกอย่าง ข้ามระบบสิทธิ์ทั้งหมด)
// วิธี deploy: ดู docs/DEPLOY.md ขั้นที่ 2.3
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const DOMAIN = 'nomicha.local';                       // โดเมนปลอมสำหรับต่อท้ายชื่อผู้ใช้ (ไม่มีการส่งอีเมลจริง)
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;    // ต้องเป็นอังกฤษ/ตัวเลข เพราะเอาไปประกอบเป็นอีเมล
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  // Supabase ใส่กุญแจผู้ดูแลมาให้เองอัตโนมัติ — รับได้ทั้งชื่อเดิม (service_role) และชื่อใหม่ (secret key)
  // เพราะ Supabase ประกาศเลิกใช้ชื่อเดิมภายในสิ้นปี 2026 · ถ้าไม่มีทั้งคู่ให้ตั้ง secret ชื่อ ADMIN_SECRET_KEY เอง
  const adminKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('ADMIN_SECRET_KEY');
  if (!adminKey) return json({ error: 'ยังไม่มีกุญแจผู้ดูแลในฟังก์ชันนี้ — ตั้ง secret ชื่อ ADMIN_SECRET_KEY ที่ Edge Functions → Secrets (ดู DEPLOY.md ขั้นที่ 2.3)' }, 500);
  const admin = createClient(url, adminKey, { auth: { persistSession: false } });

  // 1) ตรวจว่าคนเรียกเป็น "เจ้าของ" จริง — ไม่งั้นใครล็อกอินได้ก็เปลี่ยนรหัสผ่านคนอื่นได้หมด
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'ไม่มีสิทธิ์' }, 401);
  const { data: { user }, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !user) return json({ error: 'ไม่มีสิทธิ์' }, 401);
  const { data: me } = await admin.from('employees').select('role').eq('id', user.id).maybeSingle();
  if (!me || me.role !== 'owner') return json({ error: 'เฉพาะเจ้าของเท่านั้น' }, 403);

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  // 2) ทำงานตามคำสั่ง
  if (action === 'create') {
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!USERNAME_RE.test(username)) return json({ error: 'ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ/ตัวเลข 3-30 ตัว' }, 400);
    if (password.length < 6) return json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัว' }, 400);
    const { data: created, error } = await admin.auth.admin.createUser({
      email: `${username}@${DOMAIN}`, password, email_confirm: true,
    });
    if (error) return json({ error: error.message.includes('already') ? 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' : error.message }, 400);
    const row = {
      id: created.user.id, username, name: String(body.name || username).trim(),
      first_name: body.first_name || null, last_name: body.last_name || null,
      role: body.role, branch_id: body.branch_id || null,
      employer_company_id: body.role === 'staff' ? 'branch_co' : body.role === 'relief' ? 'warehouse' : null,
      base_salary: Number(body.base_salary) || 0, days_off_quota: Number(body.days_off_quota) || 2,
    };
    const { error: eErr } = await admin.from('employees').insert(row);
    if (eErr) {  // ผูกกับตาราง employees ไม่สำเร็จ — ลบบัญชี auth ทิ้ง ไม่ให้เหลือบัญชีลอย
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: eErr.message }, 400);
    }
    return json({ ok: true, id: created.user.id });
  }

  if (action === 'password') {
    const password = String(body.password || '');
    if (password.length < 6) return json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัว' }, 400);
    const { error } = await admin.auth.admin.updateUserById(String(body.id), { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === 'username') {
    const username = String(body.username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) return json({ error: 'ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ/ตัวเลข 3-30 ตัว' }, 400);
    const { error } = await admin.auth.admin.updateUserById(String(body.id), { email: `${username}@${DOMAIN}` });
    if (error) return json({ error: error.message.includes('already') ? 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' : error.message }, 400);
    const { error: eErr } = await admin.from('employees').update({ username }).eq('id', String(body.id));
    if (eErr) return json({ error: eErr.message }, 400);
    return json({ ok: true });
  }

  return json({ error: 'ไม่รู้จักคำสั่งนี้' }, 400);
});
