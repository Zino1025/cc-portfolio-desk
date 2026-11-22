-- Signals inbox: Signals Admins (Anton, Saad) and admins can read and reply to the threads of Signals-only members.
-- Replies from anyone other than the member carry the author's name, so members see who answered.
alter table public.messages add column if not exists author_name text;

create or replace function public.signals_only_member(uid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id::text = uid and tier = 'signals' and role <> 'admin' and not signals_admin);
$$;
-- True when the caller may handle this member's thread as a Signals Admin.
create or replace function public.handles_signals_thread(uid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_signals_admin() and public.signals_only_member(uid);
$$;

drop policy "msg read" on public.messages;
create policy "msg read" on public.messages for select using (member_id = (select auth.uid()) or (select public.is_admin()) or public.handles_signals_thread(member_id::text));
drop policy "msg insert" on public.messages;
create policy "msg insert" on public.messages for insert with check (author_id = (select auth.uid()) and (member_id = (select auth.uid()) or (select public.is_admin()) or public.handles_signals_thread(member_id::text)));

drop policy "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (id = (select auth.uid()) or (select public.is_admin()) or (tier = 'signals' and (select public.is_signals_admin())));

drop policy "attachments read" on storage.objects;
create policy "attachments read" on storage.objects for select to authenticated using (bucket_id = 'attachments' and (public.is_admin() or (storage.foldername(name))[1] = 'updates'
  or ((storage.foldername(name))[1] = 'signals' and public.sees_signals())
  or ((storage.foldername(name))[1] = 'msg' and ((storage.foldername(name))[2] = auth.uid()::text or public.handles_signals_thread((storage.foldername(name))[2])))));
create policy "attachments signals msg upload" on storage.objects for insert to authenticated with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = 'msg' and public.handles_signals_thread((storage.foldername(name))[2]));

create or replace function public.protect_message_fields() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null and tg_op = 'INSERT' then new.notified_at := null; end if;
  new.author_name := case when new.author_id is distinct from new.member_id then (select display_name from public.profiles where id = new.author_id) end;
  return new;
end;
$$;
