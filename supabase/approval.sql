-- Applied 2026-11-27 (migration member_approval). New accounts see nothing shared until has_access():
-- admin / Signals Admin / approved by an admin / in the CC Telegram group (tg-link + hourly tp-check) / Signals plan.
alter table public.profiles add column if not exists approved boolean not null default false,
  add column if not exists pending_pinged_at timestamptz;   -- tp-check pings admins once per waiting person

create or replace function public.has_access() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid())
    and (role = 'admin' or signals_admin or approved or in_group is true or tier in ('signals', 'both')))
$$;
revoke execute on function public.has_access() from public, anon;
grant execute on function public.has_access() to authenticated;

-- protect_profile_fields: only admins change approved; pending_pinged_at is server-only (see live definition).
-- Gated by has_access(): updates read, app_settings read, members writing in their own thread,
-- attachments under updates/, and group_holdings().
