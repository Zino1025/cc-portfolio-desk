-- iPhone/Android app notifications (Web Push) + a switch to mute Telegram pings.
-- The VAPID private key is the Edge Function secret VAPID_PRIVATE_KEY (never in this repo).
alter table public.profiles add column if not exists tg_mute boolean not null default false;

create table if not exists public.push_subs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  sub jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_id_idx on public.push_subs (user_id);
alter table public.push_subs enable row level security;
grant select, insert, delete on public.push_subs to authenticated;
create policy "own push subs: read" on public.push_subs for select to authenticated using ((select auth.uid()) = user_id);
create policy "own push subs: add" on public.push_subs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own push subs: remove" on public.push_subs for delete to authenticated using ((select auth.uid()) = user_id);

