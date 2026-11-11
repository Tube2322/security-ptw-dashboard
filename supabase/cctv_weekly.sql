-- ตรวจกล้องประจำสัปดาห์: the CCTV camera list (by NVR) and weekly checks of how many days each one
-- can still play back and whether it works. Cameras are readable by the no-login entry portal;
-- checks are written only through cctv_check_submit() and read by signed-in users.
create table if not exists public.cctv_cameras (
  name   text primary key,
  nvr    integer not null check (nvr between 1 and 6),
  sort   integer not null default 0,
  active boolean not null default true
);
create table if not exists public.cctv_checks (
  id           uuid primary key default gen_random_uuid(),
  check_date   date not null,
  nvr          integer not null check (nvr between 1 and 6),
  checker      text not null,
  items        jsonb not null,            -- [{name, days, ok, note}]
  source       text not null default 'portal',
  submitted_at timestamptz not null default now()
);
create index if not exists cctv_checks_nvr_date on public.cctv_checks (nvr, check_date desc, submitted_at desc);

alter table public.cctv_cameras enable row level security;
alter table public.cctv_checks  enable row level security;
drop policy if exists cctv_cameras_read  on public.cctv_cameras;
drop policy if exists cctv_cameras_admin on public.cctv_cameras;
drop policy if exists cctv_checks_read   on public.cctv_checks;
drop policy if exists cctv_checks_admin  on public.cctv_checks;
create policy cctv_cameras_read  on public.cctv_cameras for select to anon, authenticated using (true);
create policy cctv_cameras_admin on public.cctv_cameras for all using (is_admin()) with check (is_admin());
create policy cctv_checks_read   on public.cctv_checks  for select to authenticated using (true);
create policy cctv_checks_admin  on public.cctv_checks  for all using (is_admin()) with check (is_admin());

-- the playback threshold (days) under which a camera is flagged; admin-editable
alter table public.portal_settings add column if not exists cctv jsonb not null default '{"min_days": 30}'::jsonb;

-- the portal's only way in: validates every item against the camera list of that NVR
create or replace function public.cctv_check_submit(p_date date, p_nvr integer, p_checker text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  it jsonb; v_id uuid; clean jsonb := '[]'::jsonb; d integer;
begin
  if p_nvr is null or p_nvr not between 1 and 6 then raise exception 'invalid NVR'; end if;
  if coalesce(trim(p_checker), '') = '' or length(p_checker) > 120 then raise exception 'checker required'; end if;
  if p_date is null or p_date > current_date + 1 or p_date < current_date - 60 then raise exception 'invalid date'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then raise exception 'invalid items'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from cctv_cameras where name = it->>'name' and nvr = p_nvr and active) then
      raise exception 'unknown camera % for NVR %', it->>'name', p_nvr;
    end if;
    d := case when coalesce(it->>'days', '') ~ '^\d{1,3}$' then (it->>'days')::integer end;
    clean := clean || jsonb_build_array(jsonb_build_object('name', it->>'name', 'days', d,
      'ok', coalesce((it->>'ok')::boolean, true), 'note', left(coalesce(it->>'note', ''), 200)));
  end loop;
  insert into cctv_checks (check_date, nvr, checker, items) values (p_date, p_nvr, trim(p_checker), clean) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.cctv_check_submit(date, integer, text, jsonb) from public;
grant execute on function public.cctv_check_submit(date, integer, text, jsonb) to anon, authenticated;

-- what the portal pre-fills: each camera's latest reading (days / ok only), and each NVR's last check date
create or replace function public.cctv_latest()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cams', coalesce((select jsonb_object_agg(name, jsonb_build_object('days', days, 'ok', ok)) from (
      select distinct on (i->>'name') i->>'name' as name, (i->>'days')::integer as days, (i->>'ok')::boolean as ok
      from cctv_checks c, jsonb_array_elements(c.items) i
      order by i->>'name', c.check_date desc, c.submitted_at desc) t), '{}'::jsonb),
    'nvr', coalesce((select jsonb_object_agg(nvr, last) from (select nvr, max(check_date) last from cctv_checks group by nvr) t), '{}'::jsonb)
  )
$$;
revoke all on function public.cctv_latest() from public;
grant execute on function public.cctv_latest() to anon, authenticated;

with r(p, a, b, nvr, grp) as (values
  ('FD-1-',1,36,1,1),('FD-G-',1,28,1,2),
  ('FD-2-',1,42,2,1),('FD-3-',1,21,2,2),
  ('FD-3-',22,34,3,1),('FD-4-',1,32,3,2),('FD-5-',1,11,3,3),('FD-6-',1,8,3,4),
  ('FD-6-',9,11,4,1),('FD-7-',1,14,4,2),('FD-8-',1,12,4,3),('FD-9-',1,12,4,4),('FD-10-',1,12,4,5),('FD-11-',1,11,4,6),
  ('FD-11-',12,12,5,1),('FD-11-CL0',1,2,5,2),('FD-11-PL0',1,4,5,3),('FD-11-SL0',1,2,5,4),('FD-S1-',1,6,5,5),('FD-S2-',1,9,5,6),
  ('FD-S3-',1,9,5,7),('FD-S4-',1,3,5,8),('FD-SR-',1,2,5,9),('FD-G-',29,31,5,10),('RF-1-',1,1,5,11),('RF-1-',2,2,5,12),('RF-2-',1,2,5,13),('RF-1-',3,3,5,14),
  ('FD-OD-1-',2,8,6,1),('FD-1-',37,37,6,2),('FD-OD-2-',1,8,6,3),('FD-OD-1-',1,1,6,4),('FD-OD-1-',9,9,6,5),('FD-OD-3-',1,3,6,6),('FD-OD-4-',1,6,6,7),('FD-OD-5-',1,8,6,8),('FD-OD-6-',1,2,6,9)
), cams as (
  select r.p || g as name, r.nvr, row_number() over (partition by r.nvr order by r.grp, g) as sort
  from r, generate_series(r.a, r.b) g
)
insert into public.cctv_cameras (name, nvr, sort) select name, nvr, sort from cams
on conflict (name) do update set nvr = excluded.nvr, sort = excluded.sort;

-- first check from เวลาเช็คกล้อง.xlsx: every camera of an NVR read the same days, except FD-1-37 (33);
-- FD-7-2 / FD-11-12 / RF-1-1 could not play back; five cameras on the list are not in the sheet
insert into public.cctv_checks (check_date, nvr, checker, items, source)
select '2026-11-10', c.nvr, 'นำเข้าจากไฟล์ Excel',
  jsonb_agg(jsonb_build_object('name', c.name,
    'days', case when c.name in ('FD-7-2','FD-11-12','RF-1-1') then null when c.name = 'FD-1-37' then 33
                 else (array[28,34,47,29,37,25])[c.nvr] end,
    'ok', c.name not in ('FD-7-2','FD-11-12','RF-1-1'),
    'note', case when c.name in ('FD-7-2','FD-11-12','RF-1-1') then 'ไม่สามารถบันทึกย้อนหลังได้' else '' end) order by c.sort),
  'excel'
from public.cctv_cameras c
where c.name not in ('FD-G-28','FD-S1-2','FD-S1-3','RF-1-2','RF-1-3')
  and not exists (select 1 from public.cctv_checks x where x.source = 'excel')
group by c.nvr;

-- v2: each camera's capacity (most days it can hold) = its Excel baseline; a weekly reading below it is a shortfall
alter table public.cctv_cameras add column if not exists capacity integer check (capacity between 1 and 365);
update public.cctv_cameras c set capacity = (i->>'days')::integer
from public.cctv_checks k, jsonb_array_elements(k.items) i
where k.source = 'excel' and i->>'name' = c.name and (i->>'days') is not null and c.capacity is null;
-- no baseline reading: the most common capacity of the same NVR
update public.cctv_cameras c set capacity = m.cap
from (select nvr, mode() within group (order by capacity) cap from public.cctv_cameras where capacity is not null group by nvr) m
where c.nvr = m.nvr and c.capacity is null;

-- v3: the Excel baseline is a starting point, not a weekly check — it no longer counts as an NVR's last check
create or replace function public.cctv_latest()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cams', coalesce((select jsonb_object_agg(name, jsonb_build_object('days', days, 'ok', ok)) from (
      select distinct on (i->>'name') i->>'name' as name, (i->>'days')::integer as days, (i->>'ok')::boolean as ok
      from cctv_checks c, jsonb_array_elements(c.items) i
      order by i->>'name', c.check_date desc, c.submitted_at desc) t), '{}'::jsonb),
    'nvr', coalesce((select jsonb_object_agg(nvr, last) from (select nvr, max(check_date) last from cctv_checks where source <> 'excel' group by nvr) t), '{}'::jsonb)
  )
$$;

-- v4: FD-G-27 belongs to NVR1 (64 cameras); cameras with no reading in the sheet start at 28 days
update public.cctv_cameras set nvr = 1, sort = 63 where name = 'FD-G-27';
update public.cctv_cameras set sort = 64 where name = 'FD-G-28';
update public.cctv_checks set items = (select jsonb_agg(i) from jsonb_array_elements(items) i where i->>'name' <> 'FD-G-27')
where source = 'excel' and nvr = 2 and items @> '[{"name":"FD-G-27"}]';
update public.cctv_checks k set items = k.items || coalesce((
  select jsonb_agg(jsonb_build_object('name', c.name, 'days', 28, 'ok', true, 'note', '') order by c.sort)
  from public.cctv_cameras c
  where c.nvr = k.nvr and c.name in ('FD-G-27','FD-G-28','FD-S1-2','FD-S1-3','RF-1-2','RF-1-3')
    and not k.items @> jsonb_build_array(jsonb_build_object('name', c.name))), '[]'::jsonb)
where k.source = 'excel';
update public.cctv_cameras set capacity = 28 where name in ('FD-G-27','FD-G-28','FD-S1-2','FD-S1-3','RF-1-2','RF-1-3');
-- v5: FD-2-23 does not exist on NVR2 (screen shows 22 then 24); hidden, not deleted
update public.cctv_cameras set active = false where name = 'FD-2-23';
-- v6: NVR2 also records FD-G-27 (last on its screen); names are unique, so it is listed as its own entry
insert into public.cctv_cameras (name, nvr, sort, active, capacity) values ('FD-G-27 (NVR2)', 2, 64, true, 34) on conflict (name) do nothing;
