-- ลบวุ้นคริสตัล (item_id 15) ออกจากทั้งข้อมูลปัจจุบันและประวัติที่เก็บเป็น JSON
begin;

update daily_records
set stock_snapshot = stock_snapshot - '15'
where stock_snapshot ? '15';

update deliveries
set items = items - '15',
    received = case when received is null then null else received - '15' end
where items ? '15' or coalesce(received, '{}'::jsonb) ? '15';

update external_sales es
set items = (
      select coalesce(jsonb_agg(line), '[]'::jsonb)
      from jsonb_array_elements(es.items) line
      where line ->> 'item_id' <> '15'
    ),
    total = (
      select coalesce(sum((line ->> 'qty')::numeric * (line ->> 'price')::numeric), 0)
      from jsonb_array_elements(es.items) line
      where line ->> 'item_id' <> '15'
    )
where exists (
  select 1 from jsonb_array_elements(es.items) line
  where line ->> 'item_id' = '15'
);

update external_sales es
set edit_log = (
  select coalesce(jsonb_agg(entry), '[]'::jsonb)
  from jsonb_array_elements(es.edit_log) entry
  where coalesce(entry ->> 'label', '') not ilike '%วุ้นคริสตัล%'
)
where es.edit_log::text ilike '%วุ้นคริสตัล%';

delete from stock_par_levels where item_id = 15;
delete from purchases where item_id = 15;
delete from warehouse_stock where item_id = 15;
delete from stock_items where id = 15 or name = 'วุ้นคริสตัล';

commit;
