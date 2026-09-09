// ฐานข้อมูลจำลองในหน่วยความจำ + ตัวแทน supabase client — ใช้ทดสอบหน้าจอจริงทั้ง 3 บทบาทโดยไม่ต้องต่อ Supabase จริง
// รูปแบบข้อมูลทุกตารางตรงกับ supabase/schema.sql (ชื่อคอลัมน์เป๊ะ) เพื่อให้จับได้ถ้าโค้ดหน้าจออ้างชื่อคอลัมน์ผิด
export function makeDb(TODAY) {
  // บวก/ลบวันแบบ "วันที่ตามปฏิทิน" ห้ามใช้ toISOString() (จะเลื่อนวันตามเขตเวลาของเครื่องที่รันเทส)
  const p2 = n => String(n).padStart(2, '0');
  const d = (offset) => { const x = new Date(TODAY + 'T00:00:00'); x.setDate(x.getDate() + offset);
    return x.getFullYear() + '-' + p2(x.getMonth() + 1) + '-' + p2(x.getDate()); };
  const branches = [
    { id: 'lnd', company_id: 'branch_co', name: 'เหล่านาดี', float_cash: 300, cash_tracking_from:'2026-01-01', days_off_quota: 2, holiday_work_days: 1, gps_lat: 16.411445, gps_lng: 102.811, gps_radius: 100, work_start: '08:00', work_end: '18:00', late_grace_min: 0, active: true },
    { id: 'bwa', company_id: 'branch_co', name: 'บ้านหว้า', float_cash: 300, cash_tracking_from:'2026-01-01', days_off_quota: 4, holiday_work_days: 0, gps_lat: 16.384157, gps_lng: 102.706986, gps_radius: 100, work_start: '09:00', work_end: '19:00', late_grace_min: 10, active: true },
    { id: 'nlb', company_id: 'branch_co', name: 'หนองหลุบ', float_cash: 300, cash_tracking_from:'2026-01-01', days_off_quota: 2, holiday_work_days: 0, gps_lat: 16.470103, gps_lng: 102.755351, gps_radius: 100, work_start: '08:30', work_end: '18:30', late_grace_min: 5, active: true },
  ];
  const stock_items = [
    { id: 0, name: 'แก้วเย็นโนมิชา', unit: 'แถว', min_qty: 2, per_case: 20, branch_price: 65, display_order: 0, active: true },
    { id: 1, name: 'แก้วปั่นโนมิชา', unit: 'แถว', min_qty: 2, per_case: 20, branch_price: 70, display_order: 1, active: true },
    { id: 2, name: 'ผงชาไทย', unit: 'ถุง', min_qty: 2, per_case: 12, branch_price: 120, display_order: 2, active: true },
    { id: 3, name: 'นมหมี', unit: 'กระป๋อง', min_qty: 4, per_case: 24, branch_price: 45, display_order: 3, active: true },
  ];
  const employees = [
    { id: 'u-lnd', username: 'laonadee', name: 'ตาล', first_name: 'ตาลทิพย์', last_name: 'ใจดี', role: 'staff', branch_id: 'lnd', employer_company_id: 'branch_co', base_salary: 9000, days_off_quota: 2, delivery_pay: null, active: true },
    { id: 'u-bwa', username: 'banwa', name: 'บีม', first_name: 'บีมรัตน์', last_name: 'สุขใจ', role: 'staff', branch_id: 'bwa', employer_company_id: 'branch_co', base_salary: 9000, days_off_quota: 4, delivery_pay: null, active: true },
    { id: 'u-nlb', username: 'nonglub', name: 'อัม', first_name: 'อัมพร', last_name: 'ทองดี', role: 'staff', branch_id: 'nlb', employer_company_id: 'branch_co', base_salary: 9000, days_off_quota: 2, delivery_pay: null, active: true },
    { id: 'u-rel', username: 'huana', name: 'ขวัญ', first_name: 'ขวัญเรือน', last_name: 'ศรีสุข', role: 'relief', branch_id: null, employer_company_id: 'warehouse', base_salary: 9000, days_off_quota: 4, delivery_pay: 5000, active: true },
    { id: 'u-own', username: 'owner', name: 'เจ้าของ', first_name: 'ภูริทัต', last_name: 'เจ้าของกิจการ', role: 'owner', branch_id: null, employer_company_id: null, base_salary: 0, days_off_quota: 0, delivery_pay: null, active: true },
  ];
  // ยอดปิดร้าน 6 วันย้อนหลังของทั้ง 3 สาขา + วันหนึ่งที่หัวหน้าไปทำแทน (ตรวจว่าค่าแก้ววันนั้นเข้าเงินเดือนหัวหน้าจริง)
  const daily_records = [], clock_records = [];
  branches.forEach((b, bi) => {
    for (let i = 1; i <= 6; i++) {
      const date = d(-i);
      const reliefDay = (b.id === 'lnd' && i === 2);
      const staff_name = reliefDay ? 'ขวัญ' : employees.find(e => e.branch_id === b.id).name;
      const openYen = 40 + bi * 5, openPan = 20 + bi;
      const yen = openYen - (10 + i), pan = openPan - (4 + bi);
      daily_records.push({
        id: `r-${b.id}-${i}`, branch_id: b.id, record_date: date, staff_name,
        open_yen:openYen,open_pan:openPan,yen, yen_add: 0, pan, pan_add: 0, cup_price_yen:25,cup_price_pan:35,grab_commission_pct:0.321,cup_own: 20, topping: 35, other: 0,
        ice: 60, water: 20, etc: 0, cash: 900 + bi * 40, transfer: 250, grab: 180, thaichaithai: 60,
        float_cash: 300, stock_snapshot: { 0: Math.floor(yen / 50), 1: Math.floor(pan / 25), 2: 3, 3: 6 },
        sent: true, closed: true, created_by: 'u-' + b.id,
      });
      clock_records.push({
        id: `c-${b.id}-${i}`, branch_id: b.id, clock_date: date, staff_name,
        // วันที่ i===5 ของสาขาแรก จงใจไม่ลงเวลาออก ไว้ทดสอบกติกา "ลืมลงเวลา หัก 40"
        time_in: '08:05', time_out: (bi === 0 && i === 5) ? null : '18:00',
        late_minutes: i === 3 ? 12 : 0, early_minutes: 0, no_clock: false,
        in_distance_m: 12, out_distance_m: (bi === 0 && i === 5) ? null : 15,
        open_yen: openYen, open_pan: openPan,
      });
    }
  });
  // วันนี้: lnd ลงเวลาเข้า+นับแก้วแล้ว แต่ยังไม่ปิดยอด (สถานะที่พนักงานเจอจริงตอนกลางวัน)
  clock_records.push({ id: 'c-lnd-0', branch_id: 'lnd', clock_date: TODAY, staff_name: 'ตาล', time_in: '08:00', time_out: null, late_minutes: 0, early_minutes: 0, no_clock: false, open_yen: 29, open_pan: 15 });

  return {
    companies: [
      { id: 'warehouse', name: 'บริษัท เพตั้น จำกัด', address: 'เลขที่ 379/20 หมู่ที่ 13 ตำบลหนองเรือ อำเภอหนองเรือ จังหวัดขอนแก่น 40210', tax_id: '0405567000967', vat_registered: false },
      { id: 'branch_co', name: 'บริษัท คาเชน จำกัด', address: 'เลขที่ 379/20 หมู่ที่ 13 ตำบลหนองเรือ อำเภอหนองเรือ จังหวัดขอนแก่น 40210', tax_id: '0405567002137', vat_registered: false },
    ],
    branches, stock_items, employees, daily_records, clock_records,
    // เลขบัตรประชาชนอยู่คนละตาราง — RLS เปิดให้เฉพาะเจ้าของกับเจ้าตัว (หัวหน้าอ่านไม่ได้)
    employee_private: [{ employee_id: 'u-lnd', national_id: '1409901234560' }],
    // ตั้งรอบหนึ่งให้ตรงกับวันนี้เสมอ เพื่อให้ทดสอบเส้นทางส่งเงินสดซึ่งขึ้นเฉพาะวันรอบส่งของได้จริง
    delivery_rounds: [
      { id: 'r1', name: 'รอบวันนี้', day_of_week: new Date(TODAY + 'T00:00:00').getDay(), branch_ids: ['lnd', 'bwa', 'nlb'] },
      { id: 'r2', name: 'รอบศุกร์', day_of_week: (new Date(TODAY + 'T00:00:00').getDay() + 3) % 7, branch_ids: ['lnd', 'bwa', 'nlb'] },
    ],
    branch_rent_history: branches.map(b => ({ id: 'br-' + b.id, branch_id: b.id, effective_from: '2026-01-01', rent: 3500 })),
    warehouse_rent_history: [{ id: 'wr1', effective_from: '2026-01-01', rent: 2000 }],
    stock_par_levels: branches.flatMap(b => stock_items.map(it => ({ item_id: it.id, branch_id: b.id, par_qty: 6 }))),
    warehouse_stock: stock_items.map(it => ({ item_id: it.id, case_qty: 2, loose_qty: 3, avg_cost: it.branch_price * 0.9, last_checked: d(-3) })),
    purchases: [{ id: 'p1', item_id: 2, purchase_date: d(-5), case_qty: 2, total_price: 2400, cost_per_unit: 100, note: 'บิลทดสอบ', created_by: 'u-rel' }],
    deliveries: [
      { id: 'dl1', delivery_date: d(-3), branch_id: 'lnd', round_id: 'r1', items: { 2: 3, 3: 4 }, price_snapshot:{2:120,3:45},cost_snapshot:{2:108,3:40.5},received: { 2: 3, 3: 3 }, packed_by: 'u-rel', received_at: null },
      { id: 'dl2', delivery_date: d(-3), branch_id: 'bwa', round_id: 'r1', items: { 2: 2 }, price_snapshot:{2:120},cost_snapshot:{2:108},received: null, packed_by: 'u-rel', received_at: null },
    ],
    external_sales: [{ id: 'es1', sale_date: d(-4), buyer: 'ร้านทดสอบ', issuer: 'u-rel', items: [{ item_id: 2, qty: 2, price: 120, cost:108 }], total: 240, paid: false, edit_log: [] }],
    repairs: [{ id: 'rp1', branch_id: 'lnd', repair_date: d(-2), description: 'ซ่อมเครื่องปั่น', cost: 850 }],
    cash_remittances: [{ id: 'cr1', branch_id: 'lnd', remit_date: d(-4), through_record_date:d(-4), amount: 1200, method: 'cash',created_at:d(-4)+'T10:00:00Z' }],
    head_remittances: [{ id: 'hr1', remit_date: d(-3), amount: 800, method: 'cash' }],
    day_offs: [{ id: 'do1', off_date: d(3), branch_id: 'bwa' }],
    relief_day_offs: [{ off_date: d(6) }],
    recount_requests: [{ id: 'rc1', branch_id: 'nlb', request_date: d(-1), prev_record_id: 'r-nlb-2', staff_name: 'อัม', old_yen: 20, old_pan: 10, new_yen: 18, new_pan: 10, value_diff: -50, status: 'pending', requested_at: TODAY }],
    record_edit_history: [],
    settings: [
      { key: 'grab_commission_pct', value: 0.321 },
      { key: 'cup_price', value: { yen: 25, pan: 35 } }, { key: 'cups_per_row', value: { yen: 50, pan: 25 } },
      { key: 'diligence_rules', value: { step: 500, cap: 1500, lateAllowance: 250 } },
      { key: 'holiday_pay_scale', value: [400, 450, 500, 550] }, { key: 'overuse_threshold_units', value: 0.5 },
      { key: 'pay_rules', value: { cupPay: 1, latePerMin: 1, earlyPerMin: 1, noClock: 40, excessDayOff: 330 } },
    ],
  };
}

// ตัวแทน supabase client — รองรับเฉพาะเมธอดที่โค้ดจริงเรียกใช้ (select/eq/neq/gte/lte/lt/in/is/order/limit/maybeSingle/single/insert/update/upsert/delete)
export function makeSupabase(db, log = []) {
  const clone = v => JSON.parse(JSON.stringify(v));
  function query(table) {
    const rows = () => (db[table] || []);
    const q = { _f: [], _order: null, _limit: null, _cols: '*' };
    const apply = () => {
      let out = clone(rows());
      for (const f of q._f) out = out.filter(f);
      if (q._order) out.sort((a, b) => {
        const x = a[q._order.col], y = b[q._order.col];
        const r = x < y ? -1 : x > y ? 1 : 0;
        return q._order.asc ? r : -r;
      });
      if (q._limit != null) out = out.slice(0, q._limit);
      return out;
    };
    const thenable = {
      select(cols) { q._cols = cols; return thenable; },
      eq(c, v) { q._f.push(r => String(r[c]) === String(v)); return thenable; },
      neq(c, v) { q._f.push(r => String(r[c]) !== String(v)); return thenable; },
      gte(c, v) { q._f.push(r => r[c] >= v); return thenable; },
      lte(c, v) { q._f.push(r => r[c] <= v); return thenable; },
      lt(c, v) { q._f.push(r => r[c] < v); return thenable; },
      gt(c, v) { q._f.push(r => r[c] > v); return thenable; },
      in(c, arr) { q._f.push(r => arr.map(String).includes(String(r[c]))); return thenable; },
      is(c, v) { q._f.push(r => (v === null ? r[c] == null : r[c] === v)); return thenable; },
      order(col, o) { q._order = { col, asc: !o || o.ascending !== false }; return thenable; },
      limit(n) { q._limit = n; return thenable; },
      maybeSingle() { const o = apply(); return Promise.resolve({ data: o[0] || null, error: null }); },
      single() { const o = apply(); return Promise.resolve({ data: o[0] || null, error: o.length ? null : { message: 'not found' } }); },
      insert(v) { const arr = Array.isArray(v) ? v : [v]; arr.forEach(x => { const row = { id: table + '-' + Math.random().toString(36).slice(2, 8), ...x }; (db[table] = db[table] || []).push(row); log.push({ op: 'insert', table, row }); }); return Promise.resolve({ data: arr, error: null }); },
      update(patch) {
        const target = thenable; const run = () => { const ids = apply(); let n = 0;
          (db[table] || []).forEach(r => { if (ids.some(x => JSON.stringify(x) === JSON.stringify(r) || (x.id && x.id === r.id))) { Object.assign(r, patch); n++; } });
          log.push({ op: 'update', table, patch, n }); return Promise.resolve({ data: null, error: null }); };
        target.then = (res, rej) => run().then(res, rej);
        ['eq','neq','gte','lte','lt','gt','in','is'].forEach(m => { const orig = thenable[m]; target[m] = (...a) => { orig(...a); return target; }; });
        return target;
      },
      upsert(v, opts) {
        const keys = (opts && opts.onConflict ? opts.onConflict.split(',') : ['id']).map(s => s.trim());
        const arr = Array.isArray(v) ? v : [v];
        arr.forEach(x => {
          const list = (db[table] = db[table] || []);
          const hit = list.find(r => keys.every(k => String(r[k]) === String(x[k])));
          if (hit) { Object.assign(hit, x); log.push({ op: 'upsert-update', table, row: x }); }
          else { list.push({ id: table + '-' + Math.random().toString(36).slice(2, 8), ...x }); log.push({ op: 'upsert-insert', table, row: x }); }
        });
        return Promise.resolve({ data: arr, error: null });
      },
      delete() {
        const target = { ...thenable };
        const run = () => { const doomed = apply(); db[table] = (db[table] || []).filter(r => !doomed.some(x => JSON.stringify(x) === JSON.stringify(r))); log.push({ op: 'delete', table, n: doomed.length }); return Promise.resolve({ data: null, error: null }); };
        target.then = (res, rej) => run().then(res, rej);
        ['eq','neq','gte','lte','lt','gt','in','is'].forEach(m => { target[m] = (...a) => { thenable[m](...a); return target; }; });
        return target;
      },
      then(res, rej) { return Promise.resolve({ data: apply(), error: null }).then(res, rej); },
    };
    return thenable;
  }
  // ฟังก์ชันฝั่งฐานข้อมูล (security definer) ที่โค้ดจริงเรียกผ่าน supabase.rpc()
  const setUnits=(id,units)=>{const it=db.stock_items.find(x=>x.id===id);const row=db.warehouse_stock.find(x=>x.item_id===id);row.case_qty=Math.floor(units/it.per_case);row.loose_qty=units%it.per_case;};
  const units=id=>{const it=db.stock_items.find(x=>x.id===id);const row=db.warehouse_stock.find(x=>x.item_id===id);return row.case_qty*it.per_case+row.loose_qty;};
  const rpcs = {
    relief_name: () => ((db.employees || []).find(e => e.role === 'relief' && e.active !== false) || {}).name ?? null,
    create_external_sale:p=>{let total=0;const lines=p.p_items.map(x=>{const it=db.stock_items.find(i=>i.id===x.item_id);const row=db.warehouse_stock.find(w=>w.item_id===x.item_id);setUnits(it.id,units(it.id)-x.qty);total+=x.qty*it.branch_price;return{item_id:it.id,qty:x.qty,price:it.branch_price,cost:row.avg_cost};});const id='es-'+Math.random().toString(36).slice(2,8);const saleDate=db.clock_records.find(c=>c.id==='c-lnd-0')?.clock_date||'';db.external_sales.push({id,sale_date:saleDate,buyer:p.p_buyer,issuer:'u-own',items:lines,total,paid:false,edit_log:[]});return{id,total};},
    edit_external_sale:p=>{const sale=db.external_sales.find(x=>x.id===p.p_sale_id);sale.items.forEach(x=>setUnits(x.item_id,units(x.item_id)+x.qty));let total=0;const next=p.p_items.map(x=>{const old=sale.items.find(y=>y.item_id===x.item_id);const it=db.stock_items.find(i=>i.id===x.item_id);const row=db.warehouse_stock.find(w=>w.item_id===x.item_id);setUnits(it.id,units(it.id)-x.qty);const line={item_id:it.id,qty:x.qty,price:old?.price??it.branch_price,cost:old?.cost??row.avg_cost};total+=line.qty*line.price;return line;});sale.edit_log.push({by:p.p_editor_name,from_total:sale.total,to_total:total});sale.items=next;sale.total=total;return{total};},
    record_warehouse_count:p=>{p.p_counts.forEach(x=>{let row=db.warehouse_stock.find(w=>w.item_id===x.item_id);if(!row){row={item_id:x.item_id,avg_cost:0};db.warehouse_stock.push(row);}row.case_qty=x.case_qty;row.loose_qty=x.loose_qty;});return{updated:p.p_counts.length};},
    record_store_closure:p=>({id:'closed-'+p.p_branch_id,quota:p.p_reason==='absent'?2:p.p_reason==='approved_leave'?1:0}),
    set_external_sale_paid:p=>{const sale=db.external_sales.find(x=>x.id===p.p_sale_id);if(sale)sale.paid=p.p_paid;return{paid:p.p_paid};},
    update_daily_record:p=>{const row=db.daily_records.find(x=>x.id===p.p_record_id);Object.assign(row,p.p_values);return{id:row.id};},
    owner_update_day_off:p=>({cancelled:p.p_cancel,date:p.p_new_date}),
    owner_update_closure:()=>({}),owner_cancel_closure:()=>({cancelled:true}),owner_resolve_recount:()=>({}),
  };
  const rpc = async (name,params={}) => {
    if (!rpcs[name]) return { data: null, error: { message: 'ไม่มีฟังก์ชัน ' + name } };
    return { data: rpcs[name](params), error: null };
  };
  return { rpc, from: query, auth: { getUser: async () => ({ data: { user: { id: 'u-own' } } }), signOut: async () => ({}) } };
}
