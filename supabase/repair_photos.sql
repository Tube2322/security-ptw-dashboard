-- Photos taken in the inspection form, attached to repair jobs. Private bucket:
-- anyone with the portal link may upload (the portal has no login), only admins may view or delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('repair-photos', 'repair-photos', false, 3145728, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg'];

drop policy if exists repair_photos_upload on storage.objects;
drop policy if exists repair_photos_admin_read on storage.objects;
drop policy if exists repair_photos_admin_delete on storage.objects;

-- uploads only into inbox/<yyyy-mm-dd>/<uuid>.jpg; no overwrite since there is no update policy
create policy repair_photos_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'repair-photos' and (storage.foldername(name))[1] = 'inbox'
              and name ~ '^inbox/\d{4}-\d{2}-\d{2}/[0-9a-f-]{36}\.jpg$');
create policy repair_photos_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'repair-photos' and is_admin());
create policy repair_photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'repair-photos' and is_admin());

-- the portal reads the "broken" answers so it can offer the camera only when one is picked
drop policy if exists repair_rules_public_read on public.repair_rules;
create policy repair_rules_public_read on public.repair_rules for select to anon, authenticated using (active);
