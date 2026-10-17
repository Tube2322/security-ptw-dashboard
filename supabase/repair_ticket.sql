-- Filing repair jobs into the technicians' site (api/repair-ticket.js).
alter table public.repair_jobs add column if not exists loc jsonb;            -- {building, floor, department} as their form names them
alter table public.repair_jobs add column if not exists reporter jsonb;       -- {name, phone} of whoever reports it
alter table public.repair_jobs add column if not exists ext_id text;          -- their internal job id
alter table public.repair_jobs add column if not exists ext_sending_at timestamptz; -- send in flight (claim against double filing)
alter table public.repair_jobs add column if not exists ext_synced_at timestamptz;  -- last status pull
alter table public.repair_jobs add column if not exists ext_hold jsonb;          -- {code, name, reason, since} while the technician has it on hold
