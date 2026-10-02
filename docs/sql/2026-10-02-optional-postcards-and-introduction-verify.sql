with checks as (
  select
    (select count(*) = 2 and bool_and(pg_get_constraintdef(oid) like '%>= 0%' or pg_get_constraintdef(oid) like '%BETWEEN 0 AND 300%')
     from pg_constraint where conname in ('letter_postcards_back_message_length', 'dispatch_postcards_back_message_length')
     and conrelid in ('public.letter_postcards'::regclass, 'public.dispatch_postcards'::regclass)
     and convalidated) as blank_notes_allowed,
    (select count(*) = 6 and bool_and(
       pg_get_functiondef(p.oid) like '%coalesce(p_postcard->>''back_message'', '''')%'
       and pg_get_functiondef(p.oid) not like '%A Postcard needs its own written message%'
       and pg_get_functiondef(p.oid) not like '%if v_back_message is null or char_length(trim(both from v_back_message)) = 0%'
     ) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'public' and p.proname in ('write_letter','reply_to_letter','publish_dispatch','update_dispatch','publish_official_dispatch'))
       or (n.nspname = 'tempa_private' and p.proname = 'postcard_shape_is_valid')) as postcard_validators_updated,
    to_regprocedure('public.defer_flagship_onboarding()') is not null as deferral_installed,
    not has_function_privilege('anon', 'public.defer_flagship_onboarding()', 'execute') as anonymous_denied,
    has_function_privilege('authenticated', 'public.defer_flagship_onboarding()', 'execute') as member_allowed,
    (select pg_get_functiondef(oid) like '%where id = auth.uid()%'
      and pg_get_functiondef(oid) not like '%insert into%'
     from pg_proc where oid = 'public.defer_flagship_onboarding()'::regprocedure) as self_only_no_fabricated_answer
)
select case when blank_notes_allowed and postcard_validators_updated and deferral_installed
  and anonymous_denied and member_allowed and self_only_no_fabricated_answer
  then 'OPTIONAL_POSTCARDS_INTRODUCTION_READY' else 'OPTIONAL_POSTCARDS_INTRODUCTION_NOT_READY' end as result,
  checks.* from checks;
