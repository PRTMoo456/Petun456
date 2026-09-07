import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/* ยังไม่ได้ตั้งค่า = แอปทำงานไม่ได้เลย ต้องบอกบนหน้าจอให้ชัด ไม่ใช่ขึ้นหน้าขาว ๆ แล้วเงียบ
   (เดิมเตือนแค่ใน console ซึ่งเจ้าของไม่ได้เปิดดู — เจอหน้าว่างแล้วไม่รู้ว่าพลาดตรงไหน) */
const missing = !url || !anonKey || String(url).includes('xxxxxxxxxxxx');
if (missing && typeof document !== 'undefined') {
  const which = [!url && 'VITE_SUPABASE_URL', !anonKey && 'VITE_SUPABASE_ANON_KEY'].filter(Boolean);
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = `<div style="max-width:520px;margin:16vh auto;padding:0 22px;
      font-family:system-ui,-apple-system,'Noto Sans Thai',sans-serif;line-height:1.7;color:#1a1a1a">
      <h1 style="font-size:20px;margin:0 0 12px">ยังต่อฐานข้อมูลไม่ได้</h1>
      <p style="margin:0 0 12px">แอปนี้ยังไม่รู้ว่าจะไปคุยกับฐานข้อมูลไหน เพราะ<b>ค่าเชื่อมต่อยังไม่ได้ตั้ง</b>
        ${which.length ? `(ขาด ${which.join(' และ ')})` : '(ค่าที่ใส่ไว้ยังเป็นตัวอย่าง ไม่ใช่ของจริง)'}</p>
      <p style="margin:0 0 12px">แก้ที่ <b>Vercel → โปรเจกต์นี้ → Settings → Environment Variables</b>
        ใส่ให้ครบ 2 ตัว แล้วกด <b>Redeploy</b> อีกครั้ง — ค่าทั้งสองหาได้จาก
        <b>Supabase → Project Settings → API Keys</b></p>
      <p style="margin:0;color:#666;font-size:13.5px">ขั้นตอนละเอียดอยู่ในไฟล์ <code>docs/DEPLOY.md</code> ขั้นที่ 3</p>
    </div>`;
  });
}

export const supabase = createClient(url || 'https://unset.supabase.co', anonKey || 'unset', {
  auth: { persistSession: true, autoRefreshToken: true },
});
