-- Repair request made by the inspector while filling a monthly inspection form.
-- The entry portal ticks "มีงานแจ้งซ่อม", asks for the technicians' building / floor / department, what is
-- wrong, the inspector's name and phone, and at least one photo, and saves them in the record's data:
--   repair_request = true, repair_loc {building, floor, department}, repair_detail, repair_inspector {name, phone},
--   repair_photos [storage paths]
-- This opens a job in repair_jobs from those answers. The technicians' site is filed by api/repair-ticket.js
-- (5-minute scheduler) with the inspector's own name and phone as the reporter, so the technicians call them.
--
-- Rules:
--  * only on INSERT of the record, i.e. at the moment of inspection. Editing a record later never opens or
--    changes a job.
--  * independent of repair_tracking.enabled (that only gates the old automatic "bad answer" rules).
--  * a photo, a location, a detail and the inspector's name/phone are all required; one open job per spot
--    (a second request for the same spot is merged into the open one).
--  * never blocks saving the inspection.
--  * filing on the technicians' site stays OFF until repair_tracking.inspector_auto_send is set to true
--    (see the last statement). Until then the job simply waits in the admin's repair queue.
-- Run once in the Supabase SQL editor. repair_jobs_from_record (the old rule path) is left untouched.

-- the switch that lets api/repair-ticket.js file these jobs on the technicians' site: off until turned on
update public.portal_settings set repair_tracking = repair_tracking
  || jsonb_build_object('inspector_auto_send', coalesce((repair_tracking -> 'inspector_auto_send'), 'false'::jsonb));

create or replace function public.repair_jobs_from_request(r public.records)
returns text language plpgsql security definer set search_path = public as $$
declare
  t         public.repair_topics;
  spot      text;
  v_place   text;
  v_photos  jsonb := coalesce(r.data -> 'repair_photos', '[]'::jsonb);
  v_loc     jsonb := r.data -> 'repair_loc';
  v_who     jsonb := r.data -> 'repair_inspector';
  v_detail  text  := nullif(btrim(coalesce(r.data ->> 'repair_detail', '')), '');
  v_faults  jsonb;
  existing  uuid;
begin
  if r.is_test then return 'test-record'; end if;
  if coalesce(r.data ->> 'repair_request', '') <> 'true' then return 'no-request'; end if;
  if jsonb_typeof(v_photos) <> 'array' or jsonb_array_length(v_photos) = 0 then return 'no-photo'; end if;
  if v_detail is null then return 'no-detail'; end if;
  if jsonb_typeof(v_loc) <> 'object'
     or coalesce(v_loc ->> 'building', '') = '' or coalesce(v_loc ->> 'floor', '') = '' or coalesce(v_loc ->> 'department', '') = ''
     then return 'no-location'; end if;
  if jsonb_typeof(v_who) <> 'object' or coalesce(btrim(v_who ->> 'name'), '') = '' or coalesce(btrim(v_who ->> 'phone'), '') = ''
     then return 'no-inspector'; end if;

  select * into t from repair_topics where module = r.module;
  if not found then return 'no-topic'; end if;

  select string_agg(lower(btrim(coalesce(r.data ->> f, ''))), '|' order by o),
         string_agg(nullif(btrim(r.data ->> f), ''), ' · ' order by o)
    into spot, v_place
    from unnest(t.spot_fields) with ordinality as s(f, o);
  if coalesce(replace(spot, '|', ''), '') = '' then return 'no-spot'; end if;
  spot := r.module || ':' || spot;

  v_faults := jsonb_build_array(jsonb_build_object(
    'field_id', 'inspector_request', 'label', 'ผู้ตรวจแจ้งซ่อม · ' || t.topic, 'value', v_detail));

  select id into existing from repair_jobs where spot_key = spot and status not in ('closed','rejected');
  if existing is not null then
    update repair_jobs set
      dup_count  = dup_count + case when r.id = any(record_ids) then 0 else 1 end,
      record_ids = case when r.id = any(record_ids) then record_ids else record_ids || r.id end,
      photos     = case when r.id = any(record_ids) then photos else photos || v_photos end,
      updated_at = now()
    where id = existing;
    return 'merged-into-open-job';
  end if;

  insert into repair_jobs (code, module, topic, spot_key, place, faults, photos, record_ids, detail, times, loc, reporter, approved_by)
  values (
    'RP-' || (extract(year from now())::int + 543) || '-' || lpad(nextval('repair_job_seq')::text, 4, '0'),
    r.module, t.topic, spot, coalesce(v_place, '-'), v_faults, v_photos, array[r.id], v_detail,
    -- the inspector's tick is the approval
    jsonb_build_object('found', to_char(now(), 'YYYY-MM-DD HH24:MI'), 'approved', to_char(now(), 'YYYY-MM-DD HH24:MI')),
    v_loc, jsonb_build_object('name', btrim(v_who ->> 'name'), 'phone', btrim(v_who ->> 'phone')),
    btrim(v_who ->> 'name'))
  on conflict do nothing;
  return 'created';
end $$;

revoke all on function public.repair_jobs_from_request(public.records) from public, anon, authenticated;

-- The existing trigger function: keep the old rule-based path as it was, and add the inspector's request
-- for INSERT only.
create or replace function public.repair_jobs_record_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform repair_jobs_from_record(new);
  exception when others then
    raise warning 'repair_jobs_from_record failed for %: %', new.id, sqlerrm;
  end;
  begin
    if tg_op = 'INSERT' then perform repair_jobs_from_request(new); end if;
  exception when others then
    raise warning 'repair_jobs_from_request failed for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

-- To let these jobs be filed on the technicians' site automatically (once the first one has been checked
-- by hand), run:
--   update public.portal_settings set repair_tracking = repair_tracking || '{"inspector_auto_send": true}'::jsonb;
-- and to stop it again, set it back to false.
