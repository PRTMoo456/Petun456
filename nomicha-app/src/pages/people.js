// การ์ด "จัดการสาขา" ในหน้าตั้งค่าของเจ้าของ — รวมทุกอย่างของแต่ละสาขาไว้ที่เดียว
// ชื่อผู้ใช้ / รหัสผ่าน / ชื่อเล่น / ชื่อจริง / นามสกุล / เลขบัตรประชาชน / เงินเดือน / วันหยุด / ค่าเช่า / เวลาทำงาน / พิกัดลงเวลา
// 1 สาขา = 1 บัญชี — เปลี่ยนคนทำงานก็แก้ชื่อในบัญชีเดิม ไม่ต้องสร้างบัญชีใหม่ (ยอดของเดือนนั้นยังรวมเป็นก้อนของสาขา)
import { supabase } from '../supabaseClient.js';
import { esc, toast, numIn } from '../util.js';
import { adminCall, usernameError, nationalIdError } from '../admin.js';

export async function loadPeople() {
  const [{ data: employees }, { data: priv }] = await Promise.all([
    supabase.from('employees').select('*'),
    supabase.from('employee_private').select('*'),   // เจ้าของเท่านั้นที่อ่านได้ (หัวหน้าอ่านไม่ได้)
  ]);
  const nid = {}; (priv || []).forEach(p => { nid[p.employee_id] = p.national_id || ''; });
  return { employees: employees || [], nid };
}

const field = (label, html) => `<label class="pf"><span class="sub">${label}</span>${html}</label>`;
const txt = (k, id, v, extra = '') => `<input data-pf="${k}" data-id="${esc(id)}" value="${esc(v ?? '')}" ${extra}>`;

// ช่องชื่อผู้ใช้/รหัสผ่าน — ใช้ร่วมกันทั้งพนักงานสาขา หัวหน้า และเจ้าของ
function loginBlock(e) {
  return `<div class="prow">
    ${field('ชื่อผู้ใช้ (ใช้ล็อกอิน)', `<span class="row" style="gap:6px">
      <input data-uname="${esc(e.id)}" value="${esc(e.username || '')}" autocapitalize="none" autocorrect="off" spellcheck="false" style="width:150px">
      <button class="btn sm" data-saveuname="${esc(e.id)}">เปลี่ยน</button></span>`)}
    ${field('ตั้งรหัสผ่านใหม่', `<span class="row" style="gap:6px">
      <input type="password" data-pw="${esc(e.id)}" placeholder="อย่างน้อย 6 ตัว" autocomplete="new-password" style="width:150px">
      <button class="btn sm" data-savepw="${esc(e.id)}">ตั้ง</button></span>`)}
  </div>`;
}

// ช่องชื่อ-นามสกุล-เลขบัตร — ใช้ขึ้นสลิปเงินเดือน
function identityBlock(e, nid) {
  return `<div class="prow">
    ${field('ชื่อเล่น (แสดงบนจอ)', txt('name', e.id, e.name, 'style="width:110px"'))}
    ${field('ชื่อจริง', txt('first_name', e.id, e.first_name, 'style="width:130px"'))}
    ${field('นามสกุล', txt('last_name', e.id, e.last_name, 'style="width:150px"'))}
    ${field('เลขบัตรประชาชน', `<input data-nid="${esc(e.id)}" value="${esc(nid || '')}" inputmode="numeric" maxlength="17" style="width:150px">`)}
  </div>`;
}

// สาขาที่ยังไม่มีบัญชี — ฟอร์มสร้างบัญชีใหม่ (ผ่าน Edge Function เพราะต้องใช้สิทธิ์ผู้ดูแล)
function createBlock(key, role, branchId) {
  return `<div class="prow" data-newbox="${key}">
    ${field('ชื่อผู้ใช้', `<input data-new="username" data-newk="${key}" placeholder="เช่น laonadee" autocapitalize="none" spellcheck="false" style="width:150px">`)}
    ${field('รหัสผ่าน', `<input data-new="password" data-newk="${key}" type="password" placeholder="อย่างน้อย 6 ตัว" style="width:130px">`)}
    ${field('ชื่อเล่น', `<input data-new="name" data-newk="${key}" style="width:100px">`)}
    ${field('ชื่อจริง', `<input data-new="first_name" data-newk="${key}" style="width:120px">`)}
    ${field('นามสกุล', `<input data-new="last_name" data-newk="${key}" style="width:140px">`)}
    <button class="btn primary sm" data-create="${key}" data-role="${role}" data-branch="${esc(branchId || '')}">สร้างบัญชี</button>
  </div>`;
}

export function peopleCardHTML({ branches, employees, nid, rentAtBranch, whRentNow, graceNote }) {
  const blocks = branches.map(b => {
    const e = employees.find(x => x.branch_id === b.id && x.role === 'staff');
    const head = `<b>${esc(b.name)}</b> <span class="sub">${e ? `${esc(e.name)} · ${esc(e.username || 'ยังไม่มีชื่อผู้ใช้')}` : 'ยังไม่มีบัญชี'}</span>`;
    const person = e ? loginBlock(e) + identityBlock(e, nid[e.id])
      + `<div class="prow">${field('เงินเดือน', txt('base_salary', e.id, e.base_salary ?? 0, 'style="width:90px" inputmode="numeric"'))}</div>`
      : createBlock(b.id, 'staff', b.id);
    return `<details class="pcard"><summary>${head}</summary>
      ${person}
      <div class="prow">
        ${field('วันหยุด/เดือน', `<input data-br="days_off_quota" data-bid="${b.id}" value="${b.days_off_quota}" style="width:60px" inputmode="numeric">`)}
        ${field('ค่าเช่าสาขา', `<input data-rent="${b.id}" value="${rentAtBranch(b.id)}" style="width:90px" inputmode="numeric">`)}
        ${field('เข้างาน', `<input type="time" data-br="work_start" data-bid="${b.id}" value="${(b.work_start || '08:00').slice(0, 5)}" style="width:126px">`)}
        ${field('ปิดร้าน', `<input type="time" data-br="work_end" data-bid="${b.id}" value="${(b.work_end || '18:00').slice(0, 5)}" style="width:126px">`)}
        ${field('ผ่อนผันสาย (นาที)', `<input data-br="late_grace_min" data-bid="${b.id}" value="${b.late_grace_min ?? 0}" style="width:60px" inputmode="numeric">`)}
      </div>
      <div class="prow">
        ${field('ละติจูด', `<input data-br="gps_lat" data-bid="${b.id}" value="${b.gps_lat ?? ''}" style="width:120px" inputmode="decimal">`)}
        ${field('ลองจิจูด', `<input data-br="gps_lng" data-bid="${b.id}" value="${b.gps_lng ?? ''}" style="width:120px" inputmode="decimal">`)}
        ${field('รัศมีลงเวลา (ม.)', `<input data-br="gps_radius" data-bid="${b.id}" value="${b.gps_radius ?? 100}" style="width:70px" inputmode="numeric">`)}
      </div></details>`;
  }).join('');

  const relief = employees.find(x => x.role === 'relief');
  const reliefBlock = `<details class="pcard"><summary><b>หัวหน้า</b> <span class="sub">${
    relief ? `${esc(relief.name)} · ${esc(relief.username || 'ยังไม่มีชื่อผู้ใช้')} · ลูกจ้างเพตั้น` : 'ยังไม่มีบัญชี'}</span></summary>
    ${relief ? loginBlock(relief) + identityBlock(relief, nid[relief.id]) + `<div class="prow">
      ${field('เงินเดือนฐาน', txt('base_salary', relief.id, relief.base_salary ?? 0, 'style="width:90px" inputmode="numeric"'))}
      ${field('เงินส่งของ/เดือน', txt('delivery_pay', relief.id, relief.delivery_pay ?? 0, 'style="width:90px" inputmode="numeric"'))}
      ${field('ค่าเช่าคลังกลาง', `<input data-whrent="1" value="${whRentNow}" style="width:90px" inputmode="numeric">`)}
    </div>` : createBlock('relief', 'relief', '')}</details>`;

  const owner = employees.find(x => x.role === 'owner');
  const ownerBlock = owner ? `<details class="pcard"><summary><b>เจ้าของ</b> <span class="sub">${esc(owner.name)} · ${
    esc(owner.username || 'ยังไม่มีชื่อผู้ใช้')}</span></summary>${loginBlock(owner)}${identityBlock(owner, nid[owner.id])}</details>` : '';

  return `<div class="card pad" style="grid-column:1/-1"><h3 style="margin-bottom:4px">จัดการสาขา</h3>
    <p class="sub" style="margin:0 0 10px">แตะชื่อสาขาเพื่อกางดู · <b>1 สาขา = 1 บัญชี</b> เปลี่ยนคนทำงานให้แก้ชื่อ-นามสกุล-เลขบัตรในบัญชีเดิม
      ไม่ต้องสร้างบัญชีใหม่ (ยอดแก้ว/เงินเดือนของเดือนนั้นคิดรวมเป็นก้อนของสาขา) · ชื่อจริง นามสกุล เลขบัตรประชาชน ใช้ขึ้น<b>สลิปเงินเดือน</b></p>
    ${blocks}${reliefBlock}${ownerBlock}
    <p class="foot">ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษเล็ก/ตัวเลข (ห้ามภาษาไทย) เพราะระบบล็อกอินเบื้องหลังบังคับรูปแบบนี้ ·
      เลขบัตรประชาชน<b>เห็นได้เฉพาะเจ้าของกับเจ้าตัว</b> หัวหน้าเปิดดูไม่ได้ ·
      ค่าเช่า/เงินเดือนแก้แล้ว<b>ไม่มีผลย้อนหลัง</b> เดือนที่ผ่านไปยังใช้ค่าที่มีผล ณ ตอนนั้น · ${graceNote}</p></div>`;
}

/* ผูกปุ่ม/ช่องทั้งหมดของการ์ดนี้ — reload() ให้หน้าเรียกวาดใหม่หลังสร้างบัญชีหรือเปลี่ยนชื่อผู้ใช้
   saveBranch/saveRent มาจากหน้าเจ้าของ เพื่อให้ใช้ตัวเดียวกับที่อื่นและอัปเดต BRANCHES ในหน่วยความจำด้วย */
export function bindPeopleCard(body, { reload, saveBranch, saveRent, saveWhRent }) {
  const num = (inp, cur) => { const n = numIn(inp.value); if (n === '') { inp.value = cur; toast('กรอกเป็นตัวเลขเท่านั้น — คงค่าเดิมไว้'); return null; } return n; };

  // ช่องของตาราง employees (ชื่อเล่น/ชื่อจริง/นามสกุล/เงินเดือน/เงินส่งของ)
  body.querySelectorAll('input[data-pf]').forEach(inp => inp.addEventListener('change', async () => {
    const k = inp.dataset.pf, id = inp.dataset.id;
    let v = inp.value.trim();
    if (k === 'base_salary' || k === 'delivery_pay') { const n = num(inp, inp.defaultValue); if (n === null) return; if(n<0){toast('จำนวนเงินติดลบไม่ได้');inp.value=inp.defaultValue;return;} v = n; }
    else if (k === 'name' && !v) { inp.value = inp.defaultValue; toast('ชื่อเล่นว่างไม่ได้'); return; }
    else if (!v) v = null;
    const { error } = await supabase.from('employees').update({ [k]: v }).eq('id', id);
    if (error) { toast('บันทึกไม่สำเร็จ: ' + error.message); return; }
    inp.defaultValue = inp.value;
    toast('บันทึกแล้ว');
  }));

  // เลขบัตรประชาชน — เก็บคนละตารางเพราะหัวหน้าอ่านตาราง employees ได้ทั้งตาราง
  body.querySelectorAll('input[data-nid]').forEach(inp => inp.addEventListener('change', async () => {
    const digits = inp.value.replace(/\D/g, '');
    const err = nationalIdError(digits);
    if (err) { toast(err); return; }
    inp.value = digits;
    const { error } = await supabase.from('employee_private').upsert(
      { employee_id: inp.dataset.nid, national_id: digits || null }, { onConflict: 'employee_id' });
    toast(error ? 'บันทึกไม่สำเร็จ: ' + error.message : 'บันทึกเลขบัตรประชาชนแล้ว');
  }));

  // ช่องของตาราง branches
  body.querySelectorAll('[data-br]').forEach(inp => inp.addEventListener('change', () => {
    const k = inp.dataset.br;
    if (k === 'work_start' || k === 'work_end') { saveBranch(inp.dataset.bid, { [k]: inp.value }, 'บันทึกเวลาทำงานแล้ว — มีผลกับการลงเวลาครั้งถัดไป'); return; }
    const n = num(inp, inp.defaultValue); if (n === null) return;
    if (['days_off_quota','late_grace_min','gps_radius'].includes(k) && (n<0||!Number.isInteger(n))) { toast('ค่านี้ต้องเป็นจำนวนเต็มตั้งแต่ 0'); inp.value=inp.defaultValue; return; }
    inp.defaultValue = inp.value;
    saveBranch(inp.dataset.bid, { [k]: n }, 'บันทึกแล้ว');
  }));
  body.querySelectorAll('input[data-rent]').forEach(inp => inp.addEventListener('change', () => {
    const n = num(inp, inp.defaultValue); if (n === null) return;
    if(n<0){toast('ค่าเช่าติดลบไม่ได้');inp.value=inp.defaultValue;return;}
    inp.defaultValue = inp.value; saveRent(inp.dataset.rent, n);
  }));
  const wh = body.querySelector('input[data-whrent]');
  if (wh) wh.addEventListener('change', () => { const n = num(wh, wh.defaultValue); if (n === null) return; if(n<0){toast('ค่าเช่าติดลบไม่ได้');wh.value=wh.defaultValue;return;} wh.defaultValue = wh.value; saveWhRent(n); });

  // เปลี่ยนชื่อผู้ใช้ / ตั้งรหัสผ่านใหม่ / สร้างบัญชี — ผ่าน Edge Function ทั้งหมด
  body.querySelectorAll('button[data-saveuname]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.saveuname;
    const inp = body.querySelector(`input[data-uname="${CSS.escape(id)}"]`);
    const u = inp.value.trim().toLowerCase();
    const err = usernameError(u); if (err) { toast(err); return; }
    btn.disabled = true;
    const res = await adminCall('username', { id, username: u });
    btn.disabled = false;
    if (res.error) { toast(res.error); return; }
    toast(`เปลี่ยนชื่อผู้ใช้เป็น "${u}" แล้ว — ครั้งหน้าให้ล็อกอินด้วยชื่อนี้`);
    reload();
  }));
  body.querySelectorAll('button[data-savepw]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.savepw;
    const inp = body.querySelector(`input[data-pw="${CSS.escape(id)}"]`);
    if (inp.value.length < 6) { toast('รหัสผ่านต้องยาวอย่างน้อย 6 ตัว'); return; }
    btn.disabled = true;
    const res = await adminCall('password', { id, password: inp.value });
    btn.disabled = false;
    if (res.error) { toast(res.error); return; }
    inp.value = '';
    toast('ตั้งรหัสผ่านใหม่แล้ว — บอกรหัสใหม่กับคนที่ใช้บัญชีนี้ด้วย');
  }));
  body.querySelectorAll('button[data-create]').forEach(btn => btn.addEventListener('click', async () => {
    const key = btn.dataset.create;
    const get = f => (body.querySelector(`input[data-new="${f}"][data-newk="${CSS.escape(key)}"]`) || {}).value || '';
    const username = get('username').trim().toLowerCase();
    const err = usernameError(username); if (err) { toast(err); return; }
    if (get('password').length < 6) { toast('รหัสผ่านต้องยาวอย่างน้อย 6 ตัว'); return; }
    btn.disabled = true;
    const res = await adminCall('create', {
      username, password: get('password'), name: get('name').trim() || username,
      first_name: get('first_name').trim() || null, last_name: get('last_name').trim() || null,
      role: btn.dataset.role, branch_id: btn.dataset.branch || null,
    });
    btn.disabled = false;
    if (res.error) { toast(res.error); return; }
    toast('สร้างบัญชีแล้ว — ให้ล็อกอินด้วยชื่อผู้ใช้กับรหัสผ่านที่เพิ่งตั้ง');
    reload();
  }));
}
