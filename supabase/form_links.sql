-- รวมลิงก์ (Data → Links): admin-managed list of external form links to copy and share.
create table if not exists public.form_links (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  url        text not null check (url ~* '^https?://'),
  sort       integer not null default 0,
  created_at timestamp not null default now()
);

alter table public.form_links enable row level security;
drop policy if exists form_links_read  on public.form_links;
drop policy if exists form_links_admin on public.form_links;
create policy form_links_read  on public.form_links for select to authenticated using (true);
create policy form_links_admin on public.form_links for all using (is_admin()) with check (is_admin());

insert into public.form_links (label, url, sort)
select v.label, v.url, v.sort from (values
  ('แบบฟอร์มขอรหัสเข้าประตู Access Control', 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=YDYBfPpivEywct4fZ2hkPDikm5IrrH5LheWy-VUfBo1UNFI0UUlQMzlDNTc1WTQxMTk1SUFPNE4yNS4u&origin=QRCode', 1),
  ('แบบฟอร์มขอข้อมูลจากกล้องวงจรปิด CCTV Request form', 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=YDYBfPpivEywct4fZ2hkPDikm5IrrH5LheWy-VUfBo1UMExQODNLQkE3UEM5RjMwRVdSNllXU0dFSC4u&origin=QRCode', 2)
) as v(label, url, sort)
where not exists (select 1 from public.form_links);
