// ฐานข้อมูล Postgres จริง (PGlite — Postgres ที่รันในหน่วยความจำ ไม่ต้องต่อ Supabase)
// โหลด schema.sql + migrations ตัวจริง แล้วใช้ทดสอบฟังก์ชันในฐานข้อมูล (RPC / policy) ด้วย SQL ของจริง
// ต่างจาก mockdb.mjs ที่จำลองตรรกะด้วย JavaScript — ตัวนี้จับได้ถ้า SQL จริงเขียนผิด
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = f => readFileSync(new URL('../supabase/' + f, import.meta.url), 'utf8');

// สิ่งที่ Supabase มีให้อยู่แล้ว แต่ Postgres เปล่า ๆ ไม่มี: schema auth, auth.uid(), role authenticated/anon
const SUPABASE_SHIM = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
`;

// ลำดับเดียวกับที่ติดตั้งจริง (docs/DEPLOY.md) — ข้าม 001–005 (รวมอยู่ใน schema.sql แล้ว),
// 007 (นำเข้ายอดจริงของ 5 สาขา) และ 010 (ซ่อมข้อมูลบัณฑิต 26/09 ตาม id จริง) เพราะผูกกับข้อมูลจริงเฉพาะ
export const MIGRATIONS = ['006_simplify_harden_and_snapshot.sql', '008_day_off_booking_window.sql',
  '009_reconcile_unstaffed_leave_days.sql', '011_edit_warehouse_purchase.sql', '012_day_off_booking_window_4_days.sql'];

export async function makePg() {
  const pg = new PGlite();
  await pg.exec(SUPABASE_SHIM);
  // PGlite มี gen_random_uuid() ในตัวอยู่แล้ว (Postgres 13+) ไม่ต้องโหลด pgcrypto
  await pg.exec(read('schema.sql').replace(/create extension if not exists "pgcrypto";/i, ''));
  await pg.exec(read('seed_reference_data.sql'));
  for (const m of MIGRATIONS) await pg.exec(read('migrations/' + m));
  return pg;
}

// เรียกฟังก์ชันในฐานข้อมูลในนามผู้ใช้คนหนึ่ง (เหมือนล็อกอินอยู่) — uid = null คือเรียกแบบ migration/SQL editor
export async function asUser(pg, uid, sql, params = []) {
  await pg.exec(`select set_config('test.uid', '${uid || ''}', false)`);
  return pg.query(sql, params);
}
