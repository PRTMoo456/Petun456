// รับข้อความจาก LINE เพื่อผูกกลุ่มที่จะรับสรุปยอดรายวัน
// ตั้ง Webhook URL เป็น https://<vercel-domain>/api/line-webhook แล้วพิมพ์ "เริ่มสรุป" ในกลุ่ม
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// LINE เซ็นลายเซ็นจาก raw request body จึงห้ามให้ parser แปลง body ก่อนตรวจ
export const config = { api: { bodyParser: false } };

const rawBody = async req => {
  const parts = [];
  for await (const chunk of req) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(parts);
};

const validSignature = (body, signature, secret) => {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.LINE_CHANNEL_SECRET;
  const body = await rawBody(req);
  if (!validSignature(body, req.headers['x-line-signature'], secret)) return res.status(401).json({ error: 'Invalid LINE signature' });

  let payload;
  try { payload = JSON.parse(body.toString('utf8')); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const commands = new Set(['เริ่มสรุป', 'เริ่มรายงาน']);
  const groupEvents = (payload.events || []).filter(event =>
    event.source?.type === 'group' && event.source.groupId && event.type === 'message' &&
    event.message?.type === 'text' && commands.has(event.message.text.trim()),
  );

  for (const event of groupEvents) {
    const { error } = await db.from('line_report_targets').upsert({
      id: 'daily_summary', group_id: event.source.groupId, active: true, updated_at: new Date().toISOString(),
    });
    if (error) return res.status(500).json({ error: 'Could not save LINE group' });
  }
  return res.status(200).json({ ok: true, linked: groupEvents.length > 0 });
}
