// ตรวจตำแหน่งก่อนลงเวลา — รองรับมือถือที่จับ GPS ช้าและแจ้งเหตุผลที่แก้ได้ชัดเจน
const GPS_TOLERANCE_M = 75;

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const v = [lat1, lng1, lat2, lng2].map(Number);
  if (!v.every(Number.isFinite)) return Infinity;
  const R = 6371000, rad = d => d * Math.PI / 180;
  const dLat = rad(v[2] - v[0]), dLng = rad(v[3] - v[1]);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(v[0])) * Math.cos(rad(v[2])) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
}

const errorName = e => Number(e && e.code) === 1 ? 'denied'
  : Number(e && e.code) === 3 ? 'timeout' : 'unavailable';

function requestPosition(options) {
  return new Promise(resolve => {
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      clearTimeout(safetyTimer);
      resolve(value);
    };
    // iOS บางรุ่นไม่เรียก callback เมื่อสัญญาณขาด จึงกันปุ่มค้างด้วย timer ของเราเอง
    const safetyTimer = setTimeout(() => finish({ error: 'timeout' }), options.timeout + 1500);
    try {
      navigator.geolocation.getCurrentPosition(p => {
        const lat = Number(p && p.coords && p.coords.latitude);
        const lng = Number(p && p.coords && p.coords.longitude);
        const accuracy = Math.max(0, Math.round(Number(p && p.coords && p.coords.accuracy) || 0));
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          finish({ error: 'unavailable' }); return;
        }
        finish({ lat, lng, accuracy });
      }, e => finish({ error: errorName(e) }), options);
    } catch (_) {
      finish({ error: 'unavailable' });
    }
  });
}

async function permissionState() {
  if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) return 'unknown';
  try {
    const result = await Promise.race([
      navigator.permissions.query({ name: 'geolocation' }),
      new Promise(resolve => setTimeout(() => resolve(null), 1500)),
    ]);
    return result && result.state ? result.state : 'unknown';
  } catch (_) {
    return 'unknown'; // Safari หลายรุ่นไม่มี Permissions API แต่ Geolocation ใช้ได้
  }
}

export async function getPosition({ timeout = 25000, fallbackTimeout = 12000 } = {}) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return { error: 'unsupported' };
  if (typeof window !== 'undefined' && !window.isSecureContext) return { error: 'insecure' };
  if (await permissionState() === 'denied') return { error: 'denied' };

  const precise = await requestPosition({ enableHighAccuracy: true, timeout, maximumAge: 0 });
  if (!precise.error || precise.error === 'denied') return precise;

  // ในอาคาร high accuracy มัก timeout: ลองโหมดสำรองและใช้ตำแหน่งล่าสุดได้ไม่เกิน 1 นาที
  return requestPosition({ enableHighAccuracy: false, timeout: fallbackTimeout, maximumAge: 60000 });
}

const validCoordinate = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export async function checkAtBranch(branch = {}) {
  const rawLat = branch.gps_lat, rawLng = branch.gps_lng;
  const bLat = Number(rawLat), bLng = Number(rawLng);
  const configured = rawLat !== null && rawLat !== undefined && rawLat !== ''
    && rawLng !== null && rawLng !== undefined && rawLng !== ''
    && validCoordinate(bLat, bLng);
  const rawRadius = Number(branch.gps_radius);
  const radius = Number.isFinite(rawRadius) && rawRadius > 0 ? rawRadius : 100;

  if (!configured) return {
    ok: true,
    reason: 'no-branch-gps',
    message: 'สาขานี้ยังไม่ได้ตั้งพิกัดร้านที่ถูกต้อง — ลงเวลาได้ก่อน และแจ้งเจ้าของให้ตรวจพิกัดสาขา',
  };

  const pos = await getPosition();
  if (pos.error) {
    const messages = {
      denied: 'ลงเวลาไม่ได้ — เว็บยังไม่ได้รับสิทธิ์ตำแหน่ง กรุณาอนุญาต Location แบบ While Using/ขณะใช้งาน แล้วกดลองใหม่',
      timeout: 'ยังจับตำแหน่งไม่ได้ — เปิด GPS และ Wi-Fi แล้วออกมายืนบริเวณหน้าร้าน จากนั้นกดลองใหม่',
      unsupported: 'เครื่องหรือเบราว์เซอร์นี้ไม่รองรับตำแหน่ง กรุณาใช้ Safari/Chrome บนมือถือ',
      insecure: 'ลงเวลาไม่ได้ — ต้องเปิดเว็บผ่านลิงก์ https ที่ปลอดภัย',
      unavailable: 'อ่านตำแหน่งไม่ได้ — เปิดบริการหาตำแหน่งของเครื่อง แล้วกดลองใหม่',
    };
    return { ok: false, reason: pos.error, message: messages[pos.error] || messages.unavailable };
  }

  const distance = distanceMeters(pos.lat, pos.lng, bLat, bLng);
  // เผื่อค่าคลาดเคลื่อนตามที่เครื่องรายงาน แต่จำกัดไม่เกิน 75 ม. ไม่ให้รัศมีร้านกว้างเกินไป
  const tolerance = Math.min(pos.accuracy || 0, GPS_TOLERANCE_M);
  if (distance > radius + tolerance) {
    const unstable = pos.accuracy > radius && distance <= radius + pos.accuracy;
    return {
      ok: false,
      reason: unstable ? 'inaccurate' : 'too-far',
      distance,
      accuracy: pos.accuracy,
      message: unstable
        ? `สัญญาณ GPS ยังไม่นิ่ง (คลาดเคลื่อน ±${pos.accuracy} ม.) กรุณารอสักครู่ที่หน้าร้านแล้วกดลองใหม่`
        : `ลงเวลาไม่ได้ — อยู่ห่างจากร้าน ${distance} เมตร (กำหนดรัศมี ${radius} เมตร)`,
    };
  }
  return {
    ok: true, distance, accuracy: pos.accuracy, tolerance,
    reason: distance > radius ? 'within-accuracy' : undefined,
  };
}

export async function verifyForClock(branch, toast) {
  const at = await checkAtBranch(branch);
  if (!at.ok) { toast(at.message); return null; }
  if (at.reason === 'no-branch-gps') toast(at.message);
  return { distance: at.distance ?? null, accuracy: at.accuracy ?? null };
}
