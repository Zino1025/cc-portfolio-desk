-- Performance only, same access rules: evaluate auth.uid() / is_admin() once per query, not once per row
-- (Supabase advisor "auth_rls_initplan"). Plus indexes on author_id foreign keys.
alter policy "profiles read"   on public.profiles using ((id = (select auth.uid())) or (select public.is_admin()));
alter policy "profiles update" on public.profiles using ((id = (select auth.uid())) or (select public.is_admin()))
                                                  with check ((id = (select auth.uid())) or (select public.is_admin()));
alter policy "tx read"   on public.transactions using ((user_id = (select auth.uid())) or (select public.is_admin()));
alter policy "tx insert" on public.transactions with check (user_id = (select auth.uid()));
alter policy "tx update" on public.transactions using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "tx delete" on public.transactions using (user_id = (select auth.uid()));
alter policy "msg read"   on public.messages using ((member_id = (select auth.uid())) or (select public.is_admin()));
alter policy "msg insert" on public.messages with check ((author_id = (select auth.uid())) and ((member_id = (select auth.uid())) or (select public.is_admin())));
alter policy "msg delete" on public.messages using (author_id = (select auth.uid()));
alter policy "admins manage member notes" on public.member_notes using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "settings write" on public.app_settings using ((select public.is_admin())) with check ((select public.is_admin()));
alter policy "updates delete" on public.updates using ((select public.is_admin()));
alter policy "updates insert" on public.updates with check ((select public.is_admin()) and (notified_at is null));

create index if not exists member_notes_author_id_idx on public.member_notes (author_id);
create index if not exists messages_author_id_idx on public.messages (author_id);
create index if not exists updates_author_id_idx on public.updates (author_id);
