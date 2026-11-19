-- Bug/idea tickets from Profile. Only admins with gets_tickets (set here by SQL, not Dkay) see them and get the Telegram ping. Applied 2026-11-19.
alter table public.profiles add column if not exists gets_tickets boolean not null default false;

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind text not null default 'bug' check (kind in ('bug', 'idea')),
  body text not null check (char_length(body) between 3 and 2000),
  status text not null default 'open' check (status in ('open', 'done')),
  notified_at timestamptz,
  done_notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tickets_created on public.tickets (created_at desc);
alter table public.tickets enable row level security;
create or replace function public.gets_tickets() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and gets_tickets);
$$;
create policy "tk read" on public.tickets for select using (user_id = (select auth.uid()) or (select public.gets_tickets()));
create policy "tk insert" on public.tickets for insert with check (user_id = (select auth.uid()));
create policy "tk update" on public.tickets for update using ((select public.gets_tickets()));
create trigger tickets_notify after insert on public.tickets for each row execute function public.notify_tg();
-- Mark done -> tg-notify pings the reporter.
create trigger tickets_done_notify after update of status on public.tickets for each row when (new.status = 'done' and old.status is distinct from 'done') execute function public.notify_tg();

-- gets_tickets can only be set from SQL / Edge Functions, never from the app.
create or replace function public.protect_profile_fields() returns trigger language plpgsql set search_path = public as $$
begin
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
                                 or new.tp_pinged is distinct from old.tp_pinged
                                 or new.gets_tickets is distinct from old.gets_tickets) then
    raise exception 'That field can only be set by the app';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

update public.profiles set gets_tickets = true where id = 'fbbed1ca-946b-422b-9e6c-160a584997ac';  -- MD (not Dkay)
