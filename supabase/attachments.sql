-- Attachments (charts, voice notes, videos, PDFs) on Dkay's messages, weekly updates and urgent bids.
-- Files live in a PRIVATE storage bucket; the app shows them through short-lived signed links.
--   updates/<uuid>/<file>          -> any signed-in member can open (updates are for everyone)
--   msg/<member_id>/<uuid>/<file>  -> only that member (and admins) can open
-- Only admins can upload or delete.

alter table public.messages add column if not exists attachments jsonb;
alter table public.updates  add column if not exists attachments jsonb;

-- A message may be just an attachment (no text).
do $$ declare c text; begin
  for c in select conname from pg_constraint
           where conrelid = 'public.messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%char_length(body)%'
  loop execute format('alter table public.messages drop constraint %I', c); end loop;
end $$;
alter table public.messages add constraint messages_body_check
  check (char_length(body) <= 4000 and (char_length(body) >= 1 or jsonb_array_length(coalesce(attachments, '[]'::jsonb)) > 0));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 52428800,
        array['image/*', 'audio/*', 'video/*', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "attachments admin upload" on storage.objects;
create policy "attachments admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.is_admin());

drop policy if exists "attachments admin delete" on storage.objects;
create policy "attachments admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.is_admin());

drop policy if exists "attachments read" on storage.objects;
create policy "attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (
    public.is_admin()
    or (storage.foldername(name))[1] = 'updates'
    or ((storage.foldername(name))[1] = 'msg' and (storage.foldername(name))[2] = auth.uid()::text)
  ));
