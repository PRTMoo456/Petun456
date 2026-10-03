-- กลุ่ม LINE ที่รับสรุปยอดรายวัน: แก้ไขได้เฉพาะฝั่งเซิร์ฟเวอร์ด้วย service role key
create table if not exists line_report_targets (
  id text primary key check (id = 'daily_summary'),
  group_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table line_report_targets enable row level security;
comment on table line_report_targets is 'ปลายทางกลุ่ม LINE สำหรับสรุปยอดรายวัน; บันทึกเมื่อพิมพ์ เริ่มสรุป ในกลุ่มหลังตั้ง webhook';
