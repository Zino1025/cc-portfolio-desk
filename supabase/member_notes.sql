-- Private owner/admin notes about members (Member profile section in the admin member view).
-- Members can't see or read these. Run once in Supabase → SQL Editor.
create table if not exists public.member_notes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists member_notes_member_idx on public.member_notes (member_id, created_at desc);

alter table public.member_notes enable row level security;

drop policy if exists "admins manage member notes" on public.member_notes;
create policy "admins manage member notes" on public.member_notes
  for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

revoke all on public.member_notes from anon;
grant select, insert, delete on public.member_notes to authenticated;
