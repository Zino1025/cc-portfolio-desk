-- Lets an admin remove a member from the CC Portfolio Desk.
-- Deletes their trades, messages, profile and login. Run once in Supabase → SQL Editor.
create or replace function public.admin_remove_member(target uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Only admins can remove members';
  end if;
  if target = auth.uid() then
    raise exception 'You can''t remove yourself';
  end if;
  if exists (select 1 from public.profiles where id = target and role = 'admin') then
    raise exception 'Admins can''t be removed here';
  end if;
  delete from public.messages where member_id = target or author_id = target;
  delete from public.transactions where user_id = target;
  delete from public.profiles where id = target;
  delete from auth.users where id = target;
end;
$$;

revoke all on function public.admin_remove_member(uuid) from public, anon;
grant execute on function public.admin_remove_member(uuid) to authenticated;
