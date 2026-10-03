with functions as (
 select p.oid,p.proname,p.prosecdef
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('sync_public_mentions','publish_with_mentions','get_public_mentions','open_public_mention','can_mention_member','mention_picker_page')
), checks as (
 select
  (select count(*)=6 from functions) as functions_installed,
  coalesce((select bool_and(not has_function_privilege('anon',oid,'execute')) from functions),false) as anonymous_denied,
  coalesce((select bool_and(has_function_privilege('authenticated',oid,'execute')) from functions),false) as member_allowed,
  coalesce((select not prosecdef from functions where proname='publish_with_mentions'),false) as publication_uses_caller_permissions,
  coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.public_mentions')),false) as notification_rls,
  coalesce(not has_table_privilege('authenticated',to_regclass('public.public_mentions'),'insert'),false) as direct_inserts_denied,
  coalesce(not has_table_privilege('authenticated',to_regclass('public.public_mentions'),'select'),false) as direct_reads_denied,
  coalesce((select pg_get_functiondef(oid) like '%recipient_id=auth.uid()%' from functions where proname='open_public_mention'),false) as recipient_only_open,
  coalesce((select pg_get_functiondef(oid) like '%Unsupported publication.%' from functions where proname='publish_with_mentions'),false) as publication_allowlist_installed
)
select case when functions_installed and anonymous_denied and member_allowed and publication_uses_caller_permissions
 and notification_rls and direct_inserts_denied and direct_reads_denied and recipient_only_open and publication_allowlist_installed
 then 'PUBLIC_MENTIONS_READY' else 'PUBLIC_MENTIONS_NOT_READY' end as result, checks.* from checks;
