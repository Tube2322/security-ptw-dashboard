-- ACC door register edits made on the map (added / removed doors, renamed rooms), layered on the
-- built-in register in soc-acc.js. Run Nov 2026.
alter table public.portal_settings add column if not exists acc_doors jsonb not null default '{}'::jsonb;
