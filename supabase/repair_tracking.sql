-- Repair tracking backend. Ships disabled: portal_settings.repair_tracking->>'enabled' = 'false'
-- means no job is ever created, sent or polled until an admin turns it on.

alter table public.portal_settings
  add column if not exists repair_tracking jsonb not null
  default '{"enabled": false, "daily_cap": 10, "require_photo": true}'::jsonb;

-- Which answers count as "broken". Only rows here can open a job; anything else is ignored.
create table if not exists public.repair_rules (
  module      text not null,
  field_id    text not null,
  bad_values  text[] not null,
  active      boolean not null default true,
  primary key (module, field_id)
);

-- What identifies one physical spot per module, so one spot never has two open jobs.
create table if not exists public.repair_topics (
  module       text primary key,
  topic        text not null,
  spot_fields  text[] not null
);

create table if not exists public.repair_jobs (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  module        text not null,
  topic         text not null,
  spot_key      text not null,
  place         text not null,
  faults        jsonb not null,            -- [{field_id, label, value}]
  photos        jsonb not null default '[]'::jsonb,
  record_ids    uuid[] not null,
  dup_count     integer not null default 0, -- later inspections that found the same spot still broken
  status        text not null default 'pending'
                check (status in ('pending','sent','accepted','repairing','done','closed','rejected')),
  ext_code      text,                       -- technicians' site job number
  ext_status    text,
  detail        text,
  times         jsonb not null default '{}'::jsonb, -- {found, approved, sent, accepted, repairing, done, closed, rejected}
  approved_by   text,
  last_error    text,
  created_at    timestamp not null default now(),
  updated_at    timestamp not null default now()
);

-- Hard guarantee behind the dedupe rule: at most one open job per spot.
create unique index if not exists repair_jobs_one_open_per_spot
  on public.repair_jobs (spot_key) where status not in ('closed','rejected');
create index if not exists repair_jobs_status_idx on public.repair_jobs (status);

create sequence if not exists public.repair_job_seq;

alter table public.repair_rules  enable row level security;
alter table public.repair_topics enable row level security;
alter table public.repair_jobs   enable row level security;
drop policy if exists repair_rules_admin  on public.repair_rules;
drop policy if exists repair_topics_admin on public.repair_topics;
drop policy if exists repair_jobs_admin   on public.repair_jobs;
create policy repair_rules_admin  on public.repair_rules  for all using (is_admin()) with check (is_admin());
create policy repair_topics_admin on public.repair_topics for all using (is_admin()) with check (is_admin());
create policy repair_jobs_admin   on public.repair_jobs   for all using (is_admin()) with check (is_admin());

-- Field answers may be a plain string (radio) or a JSON array (checkbox).
create or replace function public.repair_answer_values(v jsonb) returns text[]
language sql immutable as $$
  select case jsonb_typeof(v)
    when 'array'  then array(select jsonb_array_elements_text(v))
    when 'string' then array[v #>> '{}']
    else '{}'::text[] end
$$;

-- Core filter. Returns what happened so it can be tested without side effects on real data.
create or replace function public.repair_jobs_from_record(r public.records)
returns text language plpgsql security definer set search_path = public as $$
declare
  cfg      jsonb;
  t        public.repair_topics;
  v_faults jsonb := '[]'::jsonb;
  rule     public.repair_rules;
  hit      text[];
  spot     text;
  v_place  text;
  v_photos jsonb;
  existing uuid;
  today_n  integer;
begin
  select repair_tracking into cfg from portal_settings limit 1;
  if coalesce((cfg->>'enabled')::boolean, false) is not true then return 'disabled'; end if;
  if r.is_test then return 'test-record'; end if;

  select * into t from repair_topics where module = r.module;
  if not found then return 'no-topic'; end if;

  for rule in select * from repair_rules where module = r.module and active loop
    hit := array(select unnest(repair_answer_values(r.data -> rule.field_id))
                 intersect select unnest(rule.bad_values));
    if array_length(hit, 1) > 0 then
      v_faults := v_faults || jsonb_build_object(
        'field_id', rule.field_id,
        'label', coalesce((select label from form_fields f where f.module = r.module and f.field_id = rule.field_id limit 1), rule.field_id),
        'value', array_to_string(hit, ', '));
    end if;
  end loop;
  if jsonb_array_length(v_faults) = 0 then return 'no-fault'; end if;

  -- spot identity: normalized values of the module's spot fields
  select string_agg(lower(btrim(coalesce(r.data ->> f, ''))), '|' order by o),
         string_agg(nullif(btrim(r.data ->> f), ''), ' · ' order by o)
    into spot, v_place
    from unnest(t.spot_fields) with ordinality as s(f, o);
  if coalesce(replace(spot, '|', ''), '') = '' then return 'no-spot'; end if;
  spot := r.module || ':' || spot;

  select id into existing from repair_jobs where spot_key = spot and status not in ('closed','rejected');
  if existing is not null then
    update repair_jobs set
      dup_count  = dup_count + case when r.id = any(record_ids) then 0 else 1 end,
      record_ids = case when r.id = any(record_ids) then record_ids else record_ids || r.id end,
      faults     = faults_merge.f,
      photos     = case when r.id = any(record_ids) then photos
                        else photos || coalesce(r.data -> 'repair_photos', '[]'::jsonb) end,
      updated_at = now()
    from (select jsonb_agg(distinct e) f from jsonb_array_elements(
            (select faults from repair_jobs where id = existing) || v_faults) e) faults_merge
    where id = existing;
    return 'merged-into-open-job';
  end if;

  v_photos := coalesce(r.data -> 'repair_photos', '[]'::jsonb);
  if coalesce((cfg->>'require_photo')::boolean, true) and jsonb_array_length(v_photos) = 0 then
    return 'no-photo';
  end if;

  select count(*) into today_n from repair_jobs where created_at::date = now()::date;
  if today_n >= coalesce((cfg->>'daily_cap')::int, 10) then return 'daily-cap'; end if;

  insert into repair_jobs (code, module, topic, spot_key, place, faults, photos, record_ids, detail, times)
  values (
    'RP-' || (extract(year from now())::int + 543) || '-' || lpad(nextval('repair_job_seq')::text, 4, '0'),
    r.module, t.topic, spot, coalesce(v_place, '-'), v_faults, v_photos, array[r.id],
    nullif(btrim(coalesce(r.data ->> (select field_id from form_fields f where f.module = r.module and f.type = 'textarea' limit 1), '')), ''),
    jsonb_build_object('found', to_char(now(), 'YYYY-MM-DD HH24:MI')))
  on conflict do nothing;
  return 'created';
end $$;

create or replace function public.repair_jobs_record_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform repair_jobs_from_record(new);
  exception when others then
    -- repair tracking must never block saving an inspection
    raise warning 'repair_jobs_from_record failed for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists repair_jobs_from_records on public.records;
create trigger repair_jobs_from_records
  after insert or update of data on public.records
  for each row when (new.module like 'monthly_inspection_%')
  execute function public.repair_jobs_record_trigger();

revoke all on function public.repair_jobs_from_record(public.records) from public, anon, authenticated;

-- Draft rules. Housekeeping answers (dust, dirt, obstruction, cleanliness) are left out on purpose:
-- they are not engineering repairs and would spam the technicians.
insert into public.repair_topics (module, topic, spot_fields) values
  ('monthly_inspection_acc_door',          'ACC',          array['mi_acc_floor']),
  ('monthly_inspection_fire_exit',         'ประตูหนีไฟ',    array['mi_fire_exit_door']),
  ('monthly_inspection_fire_extinguisher', 'ถังดับเพลิง',   array['mi_fire_ext_floor','mi_fire_ext_tank_no']),
  ('monthly_inspection_cctv',              'CCTV',         array['mi_cctv_nvr_name','mi_cctv_location']),
  ('monthly_inspection_golf_cart',         'รถกอล์ฟ',       array['mi_golf_cart'])
on conflict (module) do nothing;

insert into public.repair_rules (module, field_id, bad_values) values
  ('monthly_inspection_acc_door', 'mi_acc_reader_status',     array['ผิดปกติ']),
  ('monthly_inspection_acc_door', 'mi_acc_electric_lock',     array['ไม่ปกติ']),
  ('monthly_inspection_acc_door', 'mi_acc_magnet',            array['ไม่ปกติ']),
  ('monthly_inspection_acc_door', 'mi_acc_alarm_light',       array['ไม่มีไฟแจ้งเตือน']),
  ('monthly_inspection_acc_door', 'mi_acc_lock_status',       array['ประตูไม่ล็อค']),
  ('monthly_inspection_acc_door', 'mi_acc_sensor_box',        array['ใช้ไม่ได้']),
  ('monthly_inspection_acc_door', 'mi_acc_emergency_release', array['ไม่ปกติ']),
  ('monthly_inspection_fire_exit', 'mi_fire_exit_push_open',   array['ไม่ได้']),
  ('monthly_inspection_fire_exit', 'mi_fire_exit_alarm',       array['ไม่มี']),
  ('monthly_inspection_fire_exit', 'mi_fire_exit_lock_outside', array['ไม่ล็อค']),
  ('monthly_inspection_fire_exit', 'mi_fire_exit_sign',        array['ไม่มี']),
  ('monthly_inspection_fire_exit', 'mi_fire_exit_damaged',     array['ชำรุด']),
  ('monthly_inspection_fire_extinguisher', 'mi_fire_ext_condition', array['ถังบุบ']),
  ('monthly_inspection_fire_extinguisher', 'mi_fire_ext_gauge',     array['ไม่อยู่ในเกจวัด (สีแดง)']),
  ('monthly_inspection_fire_extinguisher', 'mi_fire_ext_pin',       array['ไม่มี','หลุด']),
  ('monthly_inspection_fire_extinguisher', 'mi_fire_ext_weight',    array['เบา','หนัก']),
  ('monthly_inspection_fire_extinguisher', 'mi_fire_ext_hose',      array['แตก','แข็ง']),
  ('monthly_inspection_fire_extinguisher', 'mi_fire_ext_label',     array['ฉีก/ขาด','หลุด']),
  ('monthly_inspection_cctv', 'mi_cctv_crack',  array['มี']),
  ('monthly_inspection_cctv', 'mi_cctv_status', array['ไม่สามารถใช้งานได้']),
  ('monthly_inspection_golf_cart', 'mi_golf_body',       array['มีรอยแตก/หัก']),
  ('monthly_inspection_golf_cart', 'mi_golf_steering',   array['ผิดปกติ']),
  ('monthly_inspection_golf_cart', 'mi_golf_horn',       array['ไม่ดัง']),
  ('monthly_inspection_golf_cart', 'mi_golf_seat',       array['มีรอยฉีก/ขาด']),
  ('monthly_inspection_golf_cart', 'mi_golf_tire',       array['ยางแบน','ยางรั่ว']),
  ('monthly_inspection_golf_cart', 'mi_golf_battery',    array['ไม่พร้อมใช้งาน']),
  ('monthly_inspection_golf_cart', 'mi_golf_suspension', array['ไม่พร้อมใช้งาน']),
  ('monthly_inspection_golf_cart', 'mi_golf_canvas',     array['มีรอยฉีก/ขาด']),
  ('monthly_inspection_golf_cart', 'mi_golf_status',     array['ไม่พร้อมใช้งาน'])
on conflict (module, field_id) do nothing;
