-- Every 5 minutes, ask api/repair-ticket.js to pull statuses from the technicians' site (and find
-- or re-file tickets whose reply was lost), so nothing depends on an admin keeping the page open.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- the shared secret, made here and never typed anywhere; RLS on with no policies = service role only
create table if not exists public.repair_cron (
  id     integer primary key check (id = 1),
  secret text not null default encode(extensions.gen_random_bytes(24), 'hex')
);
alter table public.repair_cron enable row level security;
insert into public.repair_cron (id) values (1) on conflict (id) do nothing;

select cron.unschedule('repair-sync') where exists (select 1 from cron.job where jobname = 'repair-sync');
select cron.schedule('repair-sync', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://security-ptw-dashboard.vercel.app/api/repair-ticket',
    body    := '{"action":"sync"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select secret from public.repair_cron where id = 1)),
    timeout_milliseconds := 55000
  );
$$);
