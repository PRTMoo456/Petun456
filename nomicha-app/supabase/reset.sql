-- ⚠ ล้างฐานข้อมูลทิ้งทั้งหมด แล้วเริ่มใหม่ ⚠
--
-- ใช้เฉพาะตอน "ติดตั้งครั้งแรกแล้วรันพลาด" เท่านั้น เช่นเจอ error
--     ERROR: 42710: type "user_role" already exists
-- แล้วอยากเริ่มนับหนึ่งใหม่ให้สะอาด
--
-- ❌ ห้ามรันไฟล์นี้หลังเริ่มใช้งานจริงแล้วเด็ดขาด — ยอดขาย เวลาเข้างาน เงินเดือน
--    ทุกอย่างที่บันทึกไว้จะหายหมด กู้คืนไม่ได้ (บัญชีล็อกอินไม่หาย แต่ต้องผูกใหม่)
--
-- วิธีใช้: วางทั้งไฟล์นี้ใน SQL Editor → Run → แล้วค่อยรัน schema.sql กับ
--          seed_reference_data.sql ใหม่ตามลำดับ

drop schema if exists public cascade;
create schema public;

-- คืนสิทธิ์มาตรฐานที่ Supabase ต้องใช้ (ถ้าไม่คืน แอปจะต่อฐานข้อมูลไม่ได้)
grant usage  on schema public to postgres, anon, authenticated, service_role;
grant create on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
