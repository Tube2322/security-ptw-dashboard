-- Duty roster (ตารางเวร). Admin-only: staff, one row per staff per day, and per-month targets.
create table if not exists public.roster_staff (
  id        uuid primary key default gen_random_uuid(),
  emp_code  text,
  name      text not null,
  nickname  text,
  position  text,
  phone     text,
  active    boolean not null default true,
  sort      integer not null default 0,
  created_at timestamp not null default now()
);

create table if not exists public.roster_days (
  staff_id  uuid not null references public.roster_staff(id) on delete cascade,
  day       date not null,
  code      text not null check (code in ('D','N','W','X','L')),  -- day, night, office day (ช), off, leave
  ot        boolean not null default false,
  note      text,
  updated_at timestamp not null default now(),
  primary key (staff_id, day)
);

create table if not exists public.roster_months (
  year            integer not null,
  month           integer not null check (month between 1 and 12),
  holidays        integer not null default 0,
  required_shifts integer not null default 0,
  hours_per_shift numeric not null default 11,
  primary key (year, month)
);

alter table public.roster_staff  enable row level security;
alter table public.roster_days   enable row level security;
alter table public.roster_months enable row level security;
drop policy if exists roster_staff_admin  on public.roster_staff;
drop policy if exists roster_days_admin   on public.roster_days;
drop policy if exists roster_months_admin on public.roster_months;
create policy roster_staff_admin  on public.roster_staff  for all using (is_admin()) with check (is_admin());
create policy roster_days_admin   on public.roster_days   for all using (is_admin()) with check (is_admin());
create policy roster_months_admin on public.roster_months for all using (is_admin()) with check (is_admin());

-- Seed: October 2569 (2026) from the paper roster
insert into public.roster_months (year, month, holidays, required_shifts, hours_per_shift)
values (2026, 10, 16, 15, 11) on conflict (year, month) do nothing;

with s as (
  insert into public.roster_staff (emp_code, name, nickname, position, sort)
  select '626986', 'เทพภกรณ์ ศรีเมือง', 'โอ๊ต', 'CCTV', 1
  where not exists (select 1 from public.roster_staff where emp_code = '626986')
  returning id
)
insert into public.roster_days (staff_id, day, code, ot)
select s.id, make_date(2026, 10, d), substr('XXXDNNXDDDDDDNXDDDNNNXDDDNNNXDD', d, 1),
       d = any (array[5, 8, 9, 12, 16, 19, 21, 25, 26])
from s, generate_series(1, 31) d
on conflict do nothing;
