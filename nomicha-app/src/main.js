import { supabase } from './supabaseClient.js';
import { getSession, getMyEmployee, renderLogin, signOut } from './auth.js';
import { loadRefs, invalidateRefs } from './refs.js';
import { loadSettings, invalidateSettings } from './settings.js';
import { $ } from './util.js';
import { renderStaffApp } from './pages/staff.js';
import { renderReliefApp } from './pages/relief.js';
import { renderOwnerApp } from './pages/owner.js';

const app = $('#app');

async function boot() {
  try {
  app.innerHTML = '<div class="boot">กำลังโหลด…</div>';
  const session = await getSession();
  if (!session) { renderLogin(app, boot); return; }

  const [me] = await Promise.all([getMyEmployee(), loadSettings(), loadRefs()]);
  if (!me) {
    app.innerHTML = '<div class="boot">เข้าบัญชีไม่สำเร็จ — บัญชีนี้ยังไม่ได้ผูกกับพนักงานคนไหน<br><button class="btn" id="backBtn" style="margin-top:14px">กลับไปหน้าล็อกอิน</button></div>';
    $('#backBtn').addEventListener('click', signOut);
    return;
  }


  app.innerHTML = `
    <div class="topbar">
      <div><b>${me.name}</b> <span class="who">· ${roleLabel(me.role)}</span></div>
      <button id="logoutBtn">ออกจากระบบ</button>
    </div>
    <div id="roleRoot"></div>`;
  $('#logoutBtn').addEventListener('click', signOut);
  const root = $('#roleRoot');

  if (me.role === 'staff') await renderStaffApp(root, me);
  else if (me.role === 'relief') await renderReliefApp(root, me);
  else await renderOwnerApp(root, me);
  } catch (error) {
    console.error(error);
    app.innerHTML = '<div class="boot">โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง<br><button class="btn" id="retryBoot">ลองใหม่</button></div>';
    $('#retryBoot').addEventListener('click', boot);
  }
}

function roleLabel(r) {
  return { staff: 'พนักงานสาขา', relief: 'หัวหน้า', owner: 'เจ้าของ' }[r] || r;
}

// พาไปหน้าล็อกอินอัตโนมัติถ้าเซสชันหมดอายุ/ออกจากระบบระหว่างใช้งาน
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') { invalidateRefs(); invalidateSettings(); setTimeout(boot, 0); }
});

boot();
