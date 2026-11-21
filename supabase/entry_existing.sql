-- Lets the entry portal (a guest, no login) ask whether a once-a-day form already has that day
-- in the system before it is sent again. Returns only a count and the last submit time, never
-- the figures. Run once; safe to re-run.

create or replace function public.entry_existing(p_module text, p_day date) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('count', count(*), 'last_at', max(submitted_at))
  from public.records
  where module = p_module and report_date = p_day
    and p_module in ('traffic', 'traffic_tt', 'golf');
$$;
revoke all on function public.entry_existing(text, date) from public;
grant execute on function public.entry_existing(text, date) to anon, authenticated;
