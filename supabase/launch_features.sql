-- Money in/out log, TP-hit pings, CC group gate, bot drafts. Applied 2026-11-18.

-- Deposits and withdrawals (fiat/stables moved in or out), for true P&L.
create table if not exists public.cash_flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('deposit', 'withdrawal')),
  amount_usd numeric not null check (amount_usd > 0),
  at timestamptz not null default now(),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists cash_flows_user on public.cash_flows (user_id, at);
alter table public.cash_flows enable row level security;
create policy "cf read" on public.cash_flows for select using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "cf insert" on public.cash_flows for insert with check (user_id = (select auth.uid()));
create policy "cf update" on public.cash_flows for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "cf delete" on public.cash_flows for delete using (user_id = (select auth.uid()));

-- tp_alerts: member opted in to TP-hit pings. tp_pinged: {"coin:step": iso} already sent.
-- in_group: CC Telegram group membership, set only by the bot functions.
alter table public.profiles
  add column if not exists tp_alerts boolean not null default false,
  add column if not exists tp_pinged jsonb,
  add column if not exists in_group boolean,
  add column if not exists group_checked_at timestamptz;

create or replace function public.protect_profile_fields() returns trigger language plpgsql as $$
begin
  -- auth.uid() is null for the SQL editor and for Edge Functions using the service role.
  if auth.uid() is not null and new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  if auth.uid() is not null and new.last_reviewed_at is distinct from old.last_reviewed_at and not public.is_admin() then
    raise exception 'Only an admin can mark a portfolio reviewed';
  end if;
  if auth.uid() is not null and (new.telegram_chat_id is distinct from old.telegram_chat_id
                                 or new.review_notified_at is distinct from old.review_notified_at
                                 or new.in_group is distinct from old.in_group
                                 or new.group_checked_at is distinct from old.group_checked_at
                                 or new.tp_pinged is distinct from old.tp_pinged) then
    raise exception 'That field can only be set by the app';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Trades a member sent the bot, waiting for their ✅. Service role only (no policies).
create table if not exists public.bot_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  rows jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.bot_drafts enable row level security;

-- Hourly: TP-hit pings + group membership re-check.
select cron.schedule('tp-check', '7 * * * *', $$select net.http_post(
  url := 'https://euoozfbbihtxrmafupeg.supabase.co/functions/v1/tg-notify',
  headers := '{"Content-Type":"application/json"}'::jsonb,
  body := '{"table":"tp-check"}'::jsonb)$$);
