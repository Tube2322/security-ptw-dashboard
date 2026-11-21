-- Early warning for API overuse (lesson from ptw-room-track, Nov 2026: egress over the free quota
-- got the whole Supabase org suspended). Every hour pg_cron snapshots how many SQL statements the
-- API roles have run (pg_stat_statements). usage_status() turns the snapshots into a last-24h count;
-- the Admin Console calls it on load and shows a red banner to admins when it is over the limit.
-- Normal load for this app is a few thousand calls a day; 20k/day means something is reloading
-- far too much again. Run once in the SQL editor; safe to re-run.

create extension if not exists pg_cron;
create extension if not exists pg_stat_statements with schema extensions;

create table if not exists public.usage_snapshots (
  at timestamptz primary key default now(),
  api_calls bigint not null
);
alter table public.usage_snapshots enable row level security;
-- no policies: only the security-definer functions below touch it

create or replace function public._usage_snapshot() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare total bigint;
begin
  select coalesce(sum(s.calls), 0)::bigint into total
  from extensions.pg_stat_statements s join pg_roles r on r.oid = s.userid
  where r.rolname in ('authenticated', 'anon', 'authenticator');
  insert into public.usage_snapshots (at, api_calls) values (clock_timestamp(), total)
  on conflict (at) do update set api_calls = excluded.api_calls;
  delete from public.usage_snapshots where at < now() - interval '35 days';
end $$;
revoke all on function public._usage_snapshot() from public, anon, authenticated;

-- admins only; counters reset on a database restart, then the count starts from zero
create or replace function public.usage_status() returns json
language plpgsql security definer set search_path = public as $$
declare cur public.usage_snapshots; prev public.usage_snapshots; day_calls bigint;
begin
  if not public.is_admin() then return null; end if;
  select * into cur from public.usage_snapshots order by at desc limit 1;
  select * into prev from public.usage_snapshots where at <= cur.at - interval '23 hours' order by at desc limit 1;
  if cur.at is null or prev.at is null then return json_build_object('day_calls', null, 'limit', 20000); end if;
  day_calls := case when cur.api_calls >= prev.api_calls then cur.api_calls - prev.api_calls else cur.api_calls end;
  return json_build_object('day_calls', day_calls, 'limit', 20000, 'at', cur.at);
end $$;
revoke all on function public.usage_status() from public, anon;
grant execute on function public.usage_status() to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'usage-snapshot';
select cron.schedule('usage-snapshot', '7 * * * *', 'select public._usage_snapshot()');
select public._usage_snapshot();
