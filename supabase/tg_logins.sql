-- One-time "Sign in with Telegram" approvals for the home-screen app. Written by tg-bot, claimed once by tg-login. Service role only.
create table public.tg_logins (nonce text primary key, user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now());
alter table public.tg_logins enable row level security;
