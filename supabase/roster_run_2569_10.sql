-- Run once in the Supabase SQL Editor: new roster columns, then the October 2569 sheet.
-- v2: status-only staff (shown on the team grid / today strip, no hour totals) and per-day custom times
alter table public.roster_staff add column if not exists status_only boolean not null default false;
alter table public.roster_days  add column if not exists start_time text check (start_time ~ '^\d{2}:\d{2}$');
alter table public.roster_days  add column if not exists end_time   text check (end_time   ~ '^\d{2}:\d{2}$');
-- v3: the supervisor (shown only as a red dot on days they work) and hours written on the paper when not the standard shift
alter table public.roster_staff add column if not exists is_head boolean not null default false;
alter table public.roster_days  add column if not exists hours numeric check (hours > 0 and hours <= 24);

-- October 2569 (2026) paper roster, entered exactly as the sheet reads. Safe to re-run.
-- Codes: D day, N night, W office day (ช), X off, L leave. hours only where the paper writes other than 11.

-- 1) supervisor: คุณอัฒม์เดช มัชวาท (616631, หนน.)
insert into public.roster_staff (emp_code, name, position, phone, is_head, status_only, sort)
select '616631', 'อัศม์เดช มัฆวาฬ', 'หนน.', '061-4655288', true, true, 0
where not exists (select 1 from public.roster_staff where emp_code = '616631');

-- 2) ฟ้า: full name, ID and phone from the sheet
update public.roster_staff set name = 'ธนสร วงษ์แก้วฟ้า', emp_code = '629793', phone = '063-9236582', position = 'CCTV'
where nickname = 'ฟ้า' and active;

-- 3) days
with s as (
  select id, emp_code from public.roster_staff where emp_code in ('616631', '626986', '629793')
), want(emp_code, d, code, ot, hours, note) as (
  -- supervisor: ช / X / ลาพักร้อน 12, AOP on 19 27 29
  select '616631', g, substr('WWXXWWWWWXXLXWWWXXWWWWXXXWWWWWX', g, 1), false, null::numeric,
         case when g in (19, 27, 29) then 'AOP' when g = 12 then 'ลาพักร้อน' end
  from generate_series(1, 31) g
  union all
  -- โอ๊ต: as on the sheet, OT 5 8 9 12 16 19 21 25 26
  select '626986', g, substr('XXXDNNXDDDDDDNXDDDDNNXDDDDDXDDD', g, 1), g = any (array[5, 8, 9, 12, 16, 19, 21, 25, 26]), null, null
  from generate_series(1, 31) g
  union all
  -- ฟ้า: D on 16 (8 h), 19 (11), 20 21 22 (12 h), 26 (11); 27-30 crossed out = not worked
  select '629793', v.d, 'D', false, v.h, null
  from (values (16, 8::numeric), (19, null), (20, 12), (21, 12), (22, 12), (26, null)) v(d, h)
)
insert into public.roster_days (staff_id, day, code, ot, hours, note)
select s.id, make_date(2026, 10, w.d), w.code, w.ot, w.hours, w.note
from want w join s using (emp_code)
on conflict (staff_id, day) do update set code = excluded.code, ot = excluded.ot, hours = excluded.hours, note = excluded.note,
  start_time = null, end_time = null, updated_at = now();

-- ฟ้า: anything else in October that is not on the sheet goes
delete from public.roster_days rd using public.roster_staff st
where rd.staff_id = st.id and st.emp_code = '629793'
  and rd.day between '2026-10-01' and '2026-10-31'
  and extract(day from rd.day)::int not in (16, 19, 20, 21, 22, 26);
