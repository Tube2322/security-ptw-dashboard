-- เบิกจ่ายน้ำกลั่น รถกอล์ฟ (module golf_water): one record per withdrawal, forwarded to the other
-- department's Microsoft Form of the same name. Mirrors that form's six questions.
do $$
declare
  mods text := $m$'traffic','golf','visitors','traffic_tt','elevator','checkpoint','monthly_inspection_golf_cart','monthly_inspection_acc_door','monthly_inspection_cctv','monthly_inspection_fire_extinguisher','monthly_inspection_fire_exit','golf_water'$m$;
begin
  execute 'alter table public.records drop constraint if exists records_module_check';
  execute 'alter table public.records add constraint records_module_check check (module = any (array[' || mods || ']))';
  execute 'alter table public.form_fields drop constraint if exists form_fields_module_check';
  execute 'alter table public.form_fields add constraint form_fields_module_check check (module = any (array[' || mods || ']))';
  execute 'alter table public.module_labels drop constraint if exists module_labels_module_check';
  execute 'alter table public.module_labels add constraint module_labels_module_check check (module = any (array[' || mods || ']))';
end $$;

insert into public.form_fields (module, field_id, label, type, required, active, "order", options, placeholder, helper, "group", unit, allow_off, system, allow_custom)
values
  ('golf_water', 'gw_date',  'วันที่เบิก',     'date',     true,  true, 0, '[]', '', '', 'ข้อมูลการเบิก', '', false, true,  false),
  ('golf_water', 'gw_name',  'ชื่อ-นามสกุล',   'select',   true,  true, 1, '[]', 'เลือกชื่อ หรือพิมพ์ชื่อเอง', '', 'ข้อมูลการเบิก', '', false, true, true),
  ('golf_water', 'gw_shift', 'กะเช้า/กะดึก',   'radio',    true,  true, 2, '["เช้า","ดึก"]', '', '', 'ข้อมูลการเบิก', '', false, false, false),
  ('golf_water', 'gw_cart',  'ใช้กับรถ',       'radio',    true,  true, 3, '["รถกอล์ฟ 1","รถกอล์ฟ 2"]', '', '', 'ข้อมูลการเบิก', '', false, false, false),
  ('golf_water', 'gw_qty',   'จำนวนที่เบิก',   'number',   true,  true, 4, '[]', '0', '', 'ข้อมูลการเบิก', '', false, false, false),
  ('golf_water', 'gw_note',  'หมายเหตุ',       'textarea', false, true, 5, '[]', 'ถ้ามี', '', 'ข้อมูลการเบิก', '', false, false, false)
on conflict do nothing;

insert into public.form_links (label, url, sort)
select 'เบิกจ่ายน้ำกลั่น รถกอล์ฟ', 'https://is.gd/qY23fe', coalesce(max(sort), 0) + 1 from public.form_links
where not exists (select 1 from public.form_links where url = 'https://is.gd/qY23fe');
