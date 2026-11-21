-- Log of form submissions that failed to save, so "I submitted but it's not there" can be checked.
-- The entry portal writes a row whenever its insert into records errors; a failure caused by a dead
-- connection is kept in the browser and written on the next page load once the network is back.
-- Anyone may insert (the portal signs in nobody); only admins can read. Run once; safe to re-run.

create table if not exists public.submit_failures (
  id uuid primary key default gen_random_uuid(),
  failed_at timestamptz not null,
  logged_at timestamptz not null default now(),
  module text,
  report_date date,
  submitted_by text,
  error text,
  payload jsonb,
  user_agent text
);
alter table public.submit_failures enable row level security;

drop policy if exists submit_failures_insert on public.submit_failures;
create policy submit_failures_insert on public.submit_failures for insert to anon, authenticated with check (true);
drop policy if exists submit_failures_read on public.submit_failures;
create policy submit_failures_read on public.submit_failures for select to authenticated using (public.is_admin());

create index if not exists submit_failures_failed_at on public.submit_failures (failed_at desc);
