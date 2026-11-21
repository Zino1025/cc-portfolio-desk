-- Signals tab, phase 1 (see cc-signals-digest §8).
-- Tiers: elite (default) / signals / both. Signals Admins (profiles.signals_admin) post and manage signals; the overall admin can too.
-- Posting goes through post_signal() so the signal and its targets land in one transaction (the Telegram ping reads both).
-- Each signal_updates row is a lifecycle post; apply_signal_update() applies it to the signal (entry filled, TP hit, breakeven, close).

alter table public.profiles add column if not exists tier text not null default 'elite' check (tier in ('elite', 'signals', 'both'));
alter table public.profiles add column if not exists signals_admin boolean not null default false;

create or replace function public.is_signals_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or signals_admin));
$$;
create or replace function public.sees_signals() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or signals_admin or tier in ('signals', 'both')));
$$;

-- Only an admin can change someone's tier or Signals Admin flag.
create or replace function public.protect_profile_fields() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  if auth.uid() is not null and (new.tier is distinct from old.tier or new.signals_admin is distinct from old.signals_admin) and not public.is_admin() then
    raise exception 'Only an admin can change plans';
  end if;
  if auth.uid() is not null and new.last_reviewed_at is distinct from old.last_reviewed_at and not public.is_admin() then
    raise exception 'Only an admin can mark a portfolio reviewed';
  end if;
  if auth.uid() is not null and (new.telegram_chat_id is distinct from old.telegram_chat_id
                                 or new.review_notified_at is distinct from old.review_notified_at
                                 or new.in_group is distinct from old.in_group
                                 or new.group_checked_at is distinct from old.group_checked_at
                                 or new.tp_pinged is distinct from old.tp_pinged
                                 or new.gets_tickets is distinct from old.gets_tickets) then
    raise exception 'That field can only be set by the app';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,15}$'),
  coin_id text,
  exchange text not null default 'MEXC' check (char_length(exchange) between 1 and 40),
  risk text not null default 'normal' check (risk in ('normal', 'high')),
  entry_type text not null check (entry_type in ('now', 'limit', 'zone')),
  entry_low numeric not null check (entry_low > 0),
  entry_high numeric check (entry_high > entry_low),
  stop_type text not null check (stop_type in ('sl', 'close', 'none')),   -- stop loss / invalidation on a daily close / none, we'll call it
  stop_price numeric check (stop_price > 0 and stop_price <= entry_low),   -- = entry after "move stop to breakeven"
  timeframe text not null check (timeframe in ('scalp', 'swing', 'long')),
  review_at date,
  note text check (char_length(note) <= 2000),
  attachments jsonb,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'closed')),
  outcome text check (outcome in ('won', 'stopped', 'early', 'expired')),
  closed_at timestamptz,
  analyst_id uuid references public.profiles(id) on delete set null,
  analyst_name text,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  check ((stop_type = 'none') = (stop_price is null)),
  check ((entry_type = 'zone') = (entry_high is not null)),
  check ((status = 'closed') = (outcome is not null))
);
create index if not exists signals_created on public.signals (created_at desc);

create table if not exists public.signal_targets (
  signal_id uuid not null references public.signals(id) on delete cascade,
  n smallint not null check (n between 1 and 4),
  price numeric not null check (price > 0),
  hit_at timestamptz,
  primary key (signal_id, n)
);

create table if not exists public.signal_updates (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.signals(id) on delete cascade,
  kind text not null check (kind in ('note', 'entry', 'tp', 'breakeven', 'close')),
  tp_n smallint check (tp_n between 1 and 4),
  outcome text check (outcome in ('won', 'stopped', 'early', 'expired')),
  body text check (char_length(body) <= 2000),
  author_id uuid references public.profiles(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  check ((kind = 'tp') = (tp_n is not null)),
  check ((kind = 'close') = (outcome is not null)),
  check (kind <> 'note' or char_length(body) >= 1)
);
create index if not exists signal_updates_signal on public.signal_updates (signal_id, created_at);

-- Phase 2 ("I took it"). Table only for now.
create table if not exists public.signal_entries (
  signal_id uuid not null references public.signals(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  entry_price numeric check (entry_price > 0),
  created_at timestamptz not null default now(),
  primary key (signal_id, user_id)
);
create index if not exists signal_entries_user on public.signal_entries (user_id);

-- Profit split per number of targets, e.g. (3, {25,60,15}). Empty until Dkay decides: members see "TBD".
create table if not exists public.split_rules (
  targets smallint primary key check (targets between 1 and 4),
  pcts numeric[] not null
);

-- Stamp who posted, so analysts get credit (members can't read other profiles).
create or replace function public.stamp_signal_author() returns trigger language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  select coalesce(display_name, telegram_handle) into nm from public.profiles where id = auth.uid();
  new.notified_at := null;
  if tg_table_name = 'signals' then
    new.analyst_id := auth.uid(); new.analyst_name := nm;
    new.status := case when new.entry_type = 'now' then 'active' else 'waiting' end;
    new.outcome := null; new.closed_at := null;
  else
    if (select status from public.signals where id = new.signal_id) = 'closed' then raise exception 'This signal is closed'; end if;
    new.author_id := auth.uid(); new.author_name := nm;
  end if;
  return new;
end;
$$;
drop trigger if exists signals_stamp on public.signals;
create trigger signals_stamp before insert on public.signals for each row execute function public.stamp_signal_author();
drop trigger if exists signal_updates_stamp on public.signal_updates;
create trigger signal_updates_stamp before insert on public.signal_updates for each row execute function public.stamp_signal_author();

create or replace function public.apply_signal_update() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind in ('entry', 'tp') then update public.signals set status = 'active' where id = new.signal_id and status = 'waiting'; end if;
  if new.kind = 'tp' then update public.signal_targets set hit_at = coalesce(hit_at, now()) where signal_id = new.signal_id and n <= new.tp_n; end if;
  if new.kind = 'breakeven' then update public.signals set stop_type = 'sl', stop_price = entry_low where id = new.signal_id; end if;
  if new.kind = 'close' then update public.signals set status = 'closed', outcome = new.outcome, closed_at = now() where id = new.signal_id; end if;
  return new;
end;
$$;
drop trigger if exists signal_updates_apply on public.signal_updates;
create trigger signal_updates_apply after insert on public.signal_updates for each row execute function public.apply_signal_update();

drop trigger if exists signals_tg on public.signals;
create trigger signals_tg after insert on public.signals for each row execute function public.notify_tg();
drop trigger if exists signal_updates_tg on public.signal_updates;
create trigger signal_updates_tg after insert on public.signal_updates for each row execute function public.notify_tg();

create or replace function public.post_signal(sig jsonb, tps numeric[]) returns uuid language plpgsql set search_path = '' as $$
declare s public.signals := jsonb_populate_record(null::public.signals, sig); sid uuid; prev numeric;
begin
  if coalesce(array_length(tps, 1), 0) not between 1 and 4 then raise exception 'Add 1 to 4 targets'; end if;
  prev := coalesce(s.entry_high, s.entry_low);
  for i in 1 .. array_length(tps, 1) loop
    if tps[i] is null or tps[i] <= prev then raise exception 'Targets must go up from the entry'; end if;
    prev := tps[i];
  end loop;
  insert into public.signals (symbol, coin_id, exchange, risk, entry_type, entry_low, entry_high, stop_type, stop_price, timeframe, review_at, note, attachments)
  values (s.symbol, s.coin_id, coalesce(s.exchange, 'MEXC'), coalesce(s.risk, 'normal'), s.entry_type, s.entry_low, s.entry_high, s.stop_type, s.stop_price, s.timeframe, s.review_at, s.note, s.attachments)
  returning id into sid;
  insert into public.signal_targets (signal_id, n, price) select sid, i, tps[i] from generate_subscripts(tps, 1) i;
  return sid;
end;
$$;

alter table public.signals enable row level security;
alter table public.signal_targets enable row level security;
alter table public.signal_updates enable row level security;
alter table public.signal_entries enable row level security;
alter table public.split_rules enable row level security;

create policy "signals read" on public.signals for select using ((select public.sees_signals()));
create policy "signals insert" on public.signals for insert with check ((select public.is_signals_admin()));
create policy "signals update" on public.signals for update using ((select public.is_signals_admin())) with check ((select public.is_signals_admin()));
create policy "signals delete" on public.signals for delete using ((select public.is_admin()));
create policy "signal targets read" on public.signal_targets for select using ((select public.sees_signals()));
create policy "signal targets write" on public.signal_targets for all using ((select public.is_signals_admin())) with check ((select public.is_signals_admin()));
create policy "signal updates read" on public.signal_updates for select using ((select public.sees_signals()));
create policy "signal updates insert" on public.signal_updates for insert with check ((select public.is_signals_admin()));
create policy "signal entries own" on public.signal_entries for all using (user_id = (select auth.uid()) or (select public.is_signals_admin()))
  with check (user_id = (select auth.uid()) and (select public.sees_signals()));
create policy "split rules read" on public.split_rules for select using ((select public.sees_signals()));
create policy "split rules write" on public.split_rules for all using ((select public.is_admin())) with check ((select public.is_admin()));

-- Chart images: signals/<uuid>/<file>, uploaded by Signals Admins, opened by anyone who sees signals.
drop policy if exists "attachments signals upload" on storage.objects;
create policy "attachments signals upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = 'signals' and public.is_signals_admin());
drop policy if exists "attachments read" on storage.objects;
create policy "attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (
    public.is_admin()
    or (storage.foldername(name))[1] = 'updates'
    or ((storage.foldername(name))[1] = 'signals' and public.sees_signals())
    or ((storage.foldername(name))[1] = 'msg' and (storage.foldername(name))[2] = auth.uid()::text)
  ));
