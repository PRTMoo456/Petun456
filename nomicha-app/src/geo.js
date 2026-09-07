// ตรวจตำแหน่งก่อนลงเวลา — ลงเวลาได้เฉพาะตอนอยู่ในรัศมีของร้านจริงเท่านั้น
// (ต้นแบบใช้สวิตช์จำลองเปิด/ปิดเอา ไม่ได้วัดระยะจริง — ตัวนี้วัดจริงจาก GPS ของเครื่อง)

// ระยะระหว่าง 2 พิกัดบนผิวโลก (สูตร haversine) หน่วยเมตร
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;                       // รัศมีโลกโดยเฉลี่ย (เมตร)
  const rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// ขอตำแหน่งปัจจุบันจากเครื่อง — บังคับความแม่นยำสูง (เปิด GPS จริง ไม่เอาตำแหน่งจากเสาสัญญาณคร่าว ๆ)
export function getPosition({ timeout = 15000 } = {}) {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve({ error: 'unsupported' }); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy || 0) }),
      e => resolve({ error: e && e.code === 1 ? 'denied' : e && e.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}

/* ตรวจว่าอยู่ที่ร้านหรือยัง — คืน { ok, distance, accuracy, reason, message }
   ถ้าสาขายังไม่ได้ตั้งพิกัด จะปล่อยผ่าน (ok=true, reason='no-branch-gps') พร้อมข้อความเตือนให้ไปตั้งค่า
   เพราะถ้าบล็อกทั้งที่เจ้าของยังไม่ได้กรอกพิกัด พนักงานจะลงเวลาไม่ได้เลยทั้งสาขา */
export async function checkAtBranch(branch) {
  // ต้องเช็คค่าว่างก่อนแปลงเป็นตัวเลข — Number(null) และ Number('') ได้ 0 ซึ่งเป็นพิกัดกลางมหาสมุทร ไม่ใช่ "ยังไม่ได้ตั้ง"
  const has = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const bLat = Number(branch.gps_lat), bLng = Number(branch.gps_lng);
  const radius = Number(branch.gps_radius) || 100;
  if (!has(branch.gps_lat) || !has(branch.gps_lng)) {
    return { ok: true, reason: 'no-branch-gps', message: 'สาขานี้ยังไม่ได้ตั้งพิกัดร้าน — ลงเวลาได้ก่อน แต่บอกเจ้าของให้ไปตั้งค่าพิกัดด้วย' };
  }
  const pos = await getPosition();
  if (pos.error) {
    const message = pos.error === 'denied'
      ? 'ลงเวลาไม่ได้ — ยังไม่ได้อนุญาตให้ใช้ตำแหน่ง กดอนุญาต "ตำแหน่งที่ตั้ง" ให้เว็บนี้ในเบราว์เซอร์ แล้วลองใหม่'
      : pos.error === 'timeout'
        ? 'ลงเวลาไม่ได้ — หาตำแหน่งไม่เจอ (สัญญาณ GPS อ่อน) ลองออกไปที่โล่งหน้าร้านแล้วกดใหม่'
        : pos.error === 'unsupported'
          ? 'ลงเวลาไม่ได้ — เครื่องนี้ใช้ระบุตำแหน่งไม่ได้ ใช้มือถือลงเวลาแทน'
          : 'ลงเวลาไม่ได้ — เปิด GPS/ตำแหน่งที่ตั้งของเครื่องก่อน แล้วลองใหม่';
    return { ok: false, reason: pos.error, message };
  }
  const distance = distanceMeters(pos.lat, pos.lng, bLat, bLng);
  if (distance > radius) {
    return {
      ok: false, reason: 'too-far', distance, accuracy: pos.accuracy,
      message: `ลงเวลาไม่ได้ — อยู่ห่างจากร้าน ${distance} เมตร (ลงเวลาได้ในระยะ ${radius} เมตร)`
        + (pos.accuracy > radius ? ` · สัญญาณ GPS ยังไม่นิ่ง (คลาดเคลื่อน ±${pos.accuracy} ม.) รอสักครู่แล้วกดใหม่` : ''),
    };
  }
  return { ok: true, distance, accuracy: pos.accuracy };
}

/* ใช้ตอนกดลงเวลา — ตรวจตำแหน่งแล้วแจ้งเหตุผลให้เลยถ้าลงไม่ได้
   คืน null = ลงเวลาไม่ได้ (บอกเหตุผลไปแล้ว) · คืน { distance } = ลงได้ พร้อมระยะที่วัดได้ไว้เก็บลงฐานข้อมูล */
export async function verifyForClock(branch, toast) {
  const at = await checkAtBranch(branch);
  if (!at.ok) { toast(at.message); return null; }
  if (at.reason === 'no-branch-gps') toast(at.message);
  return { distance: at.distance ?? null };
}
