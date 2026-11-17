-- Optional "date joined CC" on each profile (set by the member in Profile, or by an admin in Member profile).
-- Run once in Supabase → SQL Editor.
alter table public.profiles add column if not exists cc_joined_on date;
