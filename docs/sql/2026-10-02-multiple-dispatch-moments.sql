-- Allow every attached photo in a Dispatch passage, in attachment order.
-- Run before merging the dependent reader/composer release.
-- Applies to member, Tempa and Sponsored Dispatches. No letter tables change.
begin;

alter table public.dispatch_moments
  add column if not exists attachment_order bigint generated always as identity;

alter table public.dispatch_moments
  drop constraint if exists dispatch_moments_unique_gap;

create index if not exists dispatch_moments_passage_order
  on public.dispatch_moments(dispatch_id, position, attachment_order);

-- Preserve the installed public-reader bodies, privacy gates, return shapes,
-- SECURITY DEFINER settings and grants. Change only the attachment sort order.
do $migration$
declare
  signature text;
  function_oid oid;
  definition text;
  updated_definition text;
begin
  foreach signature in array array[
    'public.get_shared_dispatch(uuid)',
    'public.get_public_dispatch(text)'
  ] loop
    function_oid := to_regprocedure(signature);
    if function_oid is null then
      raise exception 'Required reader is missing: %', signature;
    end if;
    definition := pg_get_functiondef(function_oid);
    if definition ~* 'order\s+by\s+dm\.position\s*,\s*dm\.attachment_order' then
      continue;
    end if;
    updated_definition := regexp_replace(
      definition,
      'order\s+by\s+dm\.position(\s*\))',
      'order by dm.position, dm.attachment_order\1',
      'gi'
    );
    if updated_definition = definition then
      raise exception 'Reader sort does not match the reviewed migration: %', signature;
    end if;
    execute updated_definition;
  end loop;
end;
$migration$;

commit;
