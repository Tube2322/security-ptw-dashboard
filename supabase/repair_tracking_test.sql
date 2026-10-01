-- Self-contained filter test for repair_tracking.sql. Everything runs in one DO block that ends by
-- raising an exception, so every change (flag, test jobs, test record) is rolled back automatically.
-- The result list is shown as the error message. Nothing is sent anywhere.
do $$
declare
  out text := '';
  r records;
  function_result text;
  n int;
  mk_id uuid;
begin
  -- helper: build an in-memory record (never inserted)
  create temp table _cases (no int, label text, module text, is_test boolean, data jsonb, expect text, rid uuid) on commit drop;
  mk_id := gen_random_uuid();
  insert into _cases values
    (1,  'flag off',                 'monthly_inspection_fire_extinguisher', false, '{"mi_fire_ext_floor":"ชั้นที่ 1","mi_fire_ext_tank_no":"T1","mi_fire_ext_gauge":"ไม่อยู่ในเกจวัด (สีแดง)","repair_photos":["x.jpg"]}', 'disabled', gen_random_uuid()),
    (2,  'test record skipped',      'monthly_inspection_fire_extinguisher', true,  '{"mi_fire_ext_floor":"ชั้นที่ 1","mi_fire_ext_tank_no":"T1","mi_fire_ext_gauge":"ไม่อยู่ในเกจวัด (สีแดง)","repair_photos":["x.jpg"]}', 'test-record', gen_random_uuid()),
    (3,  'all normal',               'monthly_inspection_fire_extinguisher', false, '{"mi_fire_ext_floor":"ชั้นที่ 1","mi_fire_ext_tank_no":"T1","mi_fire_ext_gauge":"อยู่ในเกจวัด (สีเขียว)","repair_photos":["x.jpg"]}', 'no-fault', gen_random_uuid()),
    (4,  'housekeeping only',        'monthly_inspection_fire_extinguisher', false, '{"mi_fire_ext_floor":"ชั้นที่ 1","mi_fire_ext_tank_no":"T1","mi_fire_ext_obstruction":"มี","repair_photos":["x.jpg"]}', 'no-fault', gen_random_uuid()),
    (5,  'broken, no photo',         'monthly_inspection_fire_extinguisher', false, '{"mi_fire_ext_floor":"ชั้นที่ 1","mi_fire_ext_tank_no":"T1","mi_fire_ext_gauge":"ไม่อยู่ในเกจวัด (สีแดง)"}', 'no-photo', gen_random_uuid()),
    (6,  'broken with photo',        'monthly_inspection_fire_extinguisher', false, '{"mi_fire_ext_floor":"ชั้นที่ 1","mi_fire_ext_tank_no":"T1","mi_fire_ext_gauge":"ไม่อยู่ในเกจวัด (สีแดง)","repair_photos":["x.jpg"]}', 'created', mk_id),
    (7,  'same record saved again',  'monthly_inspection_fire_extinguisher', false, '{"mi_fire_ext_floor":"ชั้นที่ 1","mi_fire_ext_tank_no":"T1","mi_fire_ext_gauge":"ไม่อยู่ในเกจวัด (สีแดง)","repair_photos":["x.jpg"]}', 'merged-into-open-job', mk_id),
    (8,  'same tank, next month',    'monthly_inspection_fire_extinguisher', false, '{"mi_fire_ext_floor":"ชั้นที่ 1","mi_fire_ext_tank_no":" t1 ","mi_fire_ext_pin":"หลุด","repair_photos":["y.jpg"]}', 'merged-into-open-job', gen_random_uuid()),
    (9,  'other tank',               'monthly_inspection_fire_extinguisher', false, '{"mi_fire_ext_floor":"ชั้นที่ 1","mi_fire_ext_tank_no":"T2","mi_fire_ext_hose":"แตก","repair_photos":["z.jpg"]}', 'created', gen_random_uuid()),
    (10, 'golf checkbox array',      'monthly_inspection_golf_cart',         false, '{"mi_golf_cart":"รถกอล์ฟ 2","mi_golf_tire":["ยางรั่ว"],"repair_photos":["g.jpg"]}', 'created', gen_random_uuid()),
    (11, 'no spot value',            'monthly_inspection_acc_door',          false, '{"mi_acc_magnet":"ไม่ปกติ","repair_photos":["a.jpg"]}', 'no-spot', gen_random_uuid()),
    (12, 'module without topic',     'traffic',                              false, '{"x":"y"}', 'no-topic', gen_random_uuid()),
    (13, 'daily cap reached',        'monthly_inspection_fire_exit',         false, '{"mi_fire_exit_door":"ST 1 (ประตูกลาง)","mi_fire_exit_damaged":"ชำรุด","repair_photos":["d.jpg"]}', 'daily-cap', gen_random_uuid());

  for n in select no from _cases order by no loop
    if n = 2 then update portal_settings set repair_tracking = repair_tracking || '{"enabled": true}'; end if;
    if n = 13 then update portal_settings set repair_tracking = repair_tracking || '{"daily_cap": 3}'; end if;
    r := (select (c.rid, c.module, 'repair-test', 1, current_date, now(), now(), '', '', c.is_test, c.data)::records
          from _cases c where c.no = n);
    function_result := repair_jobs_from_record(r);
    out := out || format(E'\n%s %s. %s: %s', case when function_result = (select expect from _cases where no = n) then 'PASS' else 'FAIL' end,
                         n, (select label from _cases where no = n), function_result);
  end loop;

  select dup_count into n from repair_jobs where spot_key = 'monthly_inspection_fire_extinguisher:ชั้นที่ 1|t1';
  out := out || format(E'\n%s dup_count after re-save + next month = %s (expect 1)', case when n = 1 then 'PASS' else 'FAIL' end, n);
  select jsonb_array_length(faults) into n from repair_jobs where spot_key = 'monthly_inspection_fire_extinguisher:ชั้นที่ 1|t1';
  out := out || format(E'\n%s faults merged = %s (expect 2: gauge + pin)', case when n = 2 then 'PASS' else 'FAIL' end, n);

  -- trigger path: a real insert into records (rolled back with everything else)
  update portal_settings set repair_tracking = repair_tracking || '{"daily_cap": 10}';
  insert into records (module, form_id, report_date, data)
  values ('monthly_inspection_cctv', 'repair-test', current_date, '{"mi_cctv_nvr_name":"NVR1","mi_cctv_location":"ล็อบบี้","mi_cctv_status":"ไม่สามารถใช้งานได้","repair_photos":["c.jpg"]}');
  select count(*) into n from repair_jobs where module = 'monthly_inspection_cctv';
  out := out || format(E'\n%s trigger on records insert created job = %s', case when n = 1 then 'PASS' else 'FAIL' end, n);

  raise exception 'TEST RESULTS (all rolled back):%', out;
end $$;
