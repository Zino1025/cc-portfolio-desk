-- Security hardening (2026-11-22). Applied.
-- 1) tg-notify only accepts calls carrying x-notify-secret (Vault "tg_notify_secret"); triggers + cron send it.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'tg_notify_secret')
where not exists (select 1 from vault.secrets where name = 'tg_notify_secret');

create or replace function public.notify_secret() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'tg_notify_secret';
$$;
revoke all on function public.notify_secret() from public, anon, authenticated;
grant execute on function public.notify_secret() to service_role;

create or replace function public.notify_tg() returns trigger
language plpgsql security definer set search_path = 'public' as $function$
begin
  perform net.http_post(
    url     := 'https://euoozfbbihtxrmafupeg.supabase.co/functions/v1/tg-notify',
    headers := jsonb_build_object('Content-Type','application/json', 'x-notify-secret', public.notify_secret()),
    body    := jsonb_build_object('table', tg_table_name, 'id', new.id)
  );
  return new;
exception when others then
  return new;
end;
$function$;

select cron.schedule('cc-price-check', '7 * * * *', $$select net.http_post(
  url := 'https://euoozfbbihtxrmafupeg.supabase.co/functions/v1/tg-notify',
  headers := jsonb_build_object('Content-Type','application/json', 'x-notify-secret', public.notify_secret()),
  body := '{"table":"price-check"}'::jsonb)$$);
select cron.schedule('tp-check', '7 * * * *', $$select net.http_post(
  url := 'https://euoozfbbihtxrmafupeg.supabase.co/functions/v1/tg-notify',
  headers := jsonb_build_object('Content-Type','application/json', 'x-notify-secret', public.notify_secret()),
  body := '{"table":"tp-check"}'::jsonb)$$);

-- 2) Trigger functions are never called over the API.
revoke execute on function public.notify_tg(), public.handle_new_user(), public.protect_message_fields(),
  public.stamp_signal_author(), public.protect_profile_fields() from public, anon, authenticated;

-- 3) Signed-in only: helpers used by RLS and app RPCs (each checks auth.uid()).
revoke execute on function public.is_admin(), public.is_signals_admin(), public.sees_signals(), public.gets_tickets(),
  public.handles_signals_thread(text), public.signals_only_member(text), public.group_holdings(),
  public.admin_remove_member(uuid) from public, anon;
grant execute on function public.is_admin(), public.is_signals_admin(), public.sees_signals(), public.gets_tickets(),
  public.handles_signals_thread(text), public.signals_only_member(text), public.group_holdings(),
  public.admin_remove_member(uuid) to authenticated, service_role;

alter function public.protect_profile_fields() set search_path = public;
