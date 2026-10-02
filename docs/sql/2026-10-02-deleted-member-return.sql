begin;

-- A permanent admin ban is the only sanction that prevents a fresh account.
-- Closure records remain intact; returning members receive a new Auth id.
create or replace function public.account_auth_state(p_user_id uuid)
returns text language sql stable security definer set search_path='pg_catalog' as $fn$
 select case when e.status='banned' then 'permanently_banned'
   when c.user_id is not null then 'deleted'
   when e.status='suspended' then 'suspended' else 'none' end
 from (select p_user_id as id) u
 left join public.account_enforcement_state e on e.user_id=u.id
 left join public.account_closures c on c.user_id=u.id
$fn$;
revoke all on function public.account_auth_state(uuid) from public,anon,authenticated;
grant execute on function public.account_auth_state(uuid) to service_role;

create or replace function public.account_auth_state_for_email_link(p_token_hash text)
returns text language sql stable security definer set search_path='pg_catalog' as $fn$
 select public.account_auth_state(u.id) from auth.users u
 where p_token_hash is not null and char_length(p_token_hash) between 40 and 128
 and (u.recovery_token=p_token_hash or u.confirmation_token=p_token_hash) limit 1
$fn$;
revoke all on function public.account_auth_state_for_email_link(text) from public,anon,authenticated;
grant execute on function public.account_auth_state_for_email_link(text) to service_role;

-- Read-only repair queue. Auth mutation uses the supported Admin API, not SQL.
create or replace function public.closed_account_auth_repair_candidates(p_user_id uuid default null)
returns table(user_id uuid,closed_at timestamptz,storage_objects jsonb)
language sql stable security definer set search_path='pg_catalog' as $fn$
 select c.user_id,c.closed_at,c.storage_objects from public.account_closures c
 join auth.users u on u.id=c.user_id
 where u.deleted_at is null and public.account_auth_state(c.user_id)='deleted'
 and (p_user_id is null or c.user_id=p_user_id)
 order by c.closed_at,c.user_id limit 50
$fn$;
revoke all on function public.closed_account_auth_repair_candidates(uuid) from public,anon,authenticated;
grant execute on function public.closed_account_auth_repair_candidates(uuid) to service_role;

grant select(user_id) on public.account_closures to service_role;
grant update(storage_cleaned_at,auth_disabled_at,last_error) on public.account_closures to service_role;

commit;
