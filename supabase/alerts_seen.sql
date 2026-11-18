-- Alerts a member has already seen (urgent bid ids + daily price-drop keys). Applied 2026-11-18.
alter table public.profiles add column if not exists alerts_seen jsonb;
