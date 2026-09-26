-- ============================================================
-- TEMPA — COMMERCE ADMIN OPERATIONS — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-23-commerce-admin-operations.sql.
-- One SELECT; changes nothing. Expect exactly one row with every column
-- true and overall_pass = true.
-- ============================================================

with admin_fns(sig) as (
  values
    ('public.admin_commerce_overview()'), ('public.admin_commerce_catalog()'), ('public.admin_commerce_product(uuid)'),
    ('public.admin_commerce_taxonomy()'), ('public.admin_commerce_collections()'), ('public.admin_commerce_pricing()'),
    ('public.admin_commerce_member(uuid)'), ('public.admin_commerce_entitlements(integer)'), ('public.admin_commerce_orders(integer)'),
    ('public.admin_commerce_audit(integer)'),
    ('public.admin_commerce_create_product(text, text, boolean, bigint, text)'),
    ('public.admin_commerce_update_product(uuid, jsonb, text)'),
    ('public.admin_commerce_set_lifecycle(uuid, text, text, timestamptz, timestamptz)'),
    ('public.admin_commerce_add_version(uuid, text, text, text, text, numeric, text)'),
    ('public.admin_commerce_set_current_version(uuid, text)'),
    ('public.admin_commerce_save_term(uuid, text, text, text, text[], text, integer, text)'),
    ('public.admin_commerce_set_product_terms(uuid, uuid[])'),
    ('public.admin_commerce_save_collection(uuid, text, text, text, boolean, integer, timestamptz)'),
    ('public.admin_commerce_set_collection_products(uuid, uuid[])'),
    ('public.admin_commerce_reorder_collections(uuid[])'),
    ('public.admin_commerce_set_price(text, uuid, bigint, timestamptz, boolean, text, text, text, bigint)'),
    ('public.admin_commerce_publish_price(text, uuid, text)'),
    ('public.admin_commerce_end_price(text, uuid, timestamptz, text)'),
    ('public.admin_commerce_discard_draft_price(text, uuid)'),
    ('public.admin_commerce_save_bundle_draft(uuid, uuid, jsonb, timestamptz)'),
    ('public.admin_commerce_publish_bundle_version(uuid, text)'),
    ('public.admin_commerce_retire_bundle_version(uuid, text)'),
    ('public.admin_commerce_grant_entitlement(uuid, uuid, text, text)')
),
mutations(sig) as (
  select sig from admin_fns where sig not similar to 'public.admin_commerce_(overview|catalog|product|taxonomy|collections|pricing|member|entitlements|orders|audit)\(%'
),
-- Private helpers that read protected data or write the audit log: SECURITY DEFINER.
private_fns(sig) as (
  values ('tempa_private.commerce_require_admin()'), ('tempa_private.commerce_audit(text, text, uuid, text, text, jsonb)'),
         ('tempa_private.commerce_product_readiness(uuid)'), ('tempa_private.commerce_is_ready(uuid)'),
         ('tempa_private.commerce_member_label(uuid)')
),
-- Pure deterministic helpers: pinned search_path, deliberately NOT SECURITY DEFINER.
pure_fns(sig) as (
  values ('tempa_private.commerce_slugify(text)'), ('tempa_private.commerce_is_human_label(text, text)')
),
def(sig, body) as (
  select sig, coalesce(pg_get_functiondef(to_regprocedure(sig)), '') from admin_fns
),
checks as (
  select
    (select count(*) from admin_fns where to_regprocedure(sig) is not null) = (select count(*) from admin_fns)
      and (select count(*) from private_fns where to_regprocedure(sig) is not null) = (select count(*) from private_fns)
      and (select count(*) from pure_fns where to_regprocedure(sig) is not null) = (select count(*) from pure_fns)
      as all_functions_exist,
    not exists (
      select 1 from (select sig from admin_fns union all select sig from private_fns) f
      join pg_proc p on p.oid = to_regprocedure(f.sig)
      where not (p.prosecdef and 'search_path=pg_catalog' = any(p.proconfig))
    ) as definer_and_search_path_pinned,
    not exists (
      select 1 from pure_fns f join pg_proc p on p.oid = to_regprocedure(f.sig)
      where p.prosecdef or not ('search_path=pg_catalog' = any(p.proconfig)) or p.provolatile <> 'i'
    ) as pure_helpers_invoker_immutable_pinned,
    -- every admin RPC checks the ADMIN role first (moderators refused)
    not exists (select 1 from def where body !~ 'perform tempa_private\.commerce_require_admin\(\)') as every_rpc_admin_gated,
    coalesce(pg_get_functiondef(to_regprocedure('tempa_private.commerce_require_admin()')), '') ~ 'is_staff\(''admin''\)'
      as admin_gate_is_admin_role,
    not exists (select 1 from admin_fns f where has_function_privilege('anon', to_regprocedure(f.sig), 'execute'))
      and not exists (select 1 from (select sig from private_fns union all select sig from pure_fns) f where has_function_privilege('authenticated', to_regprocedure(f.sig), 'execute')
                                                   or has_function_privilege('anon', to_regprocedure(f.sig), 'execute'))
      as client_privileges_correct,
    -- every mutation writes the admin audit log
    not exists (select 1 from mutations m join def d on d.sig = m.sig where d.body !~ 'tempa_private\.commerce_audit\(')
      as every_mutation_audited,
    -- nothing here can switch commerce on or touch providers, wallets or the ledger directly
    not exists (select 1 from def where body ~* 'update public\.commerce_(settings|payment_providers|wallets|ledger_entries)'
                                     or body ~* 'insert into public\.commerce_(settings|payment_providers|wallets|ledger_entries)')
      as no_switch_wallet_or_ledger_writes,
    -- publishing is readiness-gated server-side
    (select body from def where sig = 'public.admin_commerce_set_lifecycle(uuid, text, text, timestamptz, timestamptz)')
      ~ 'p_state = ''published'' and not tempa_private\.commerce_is_ready\(p_product_id\)' as publish_requires_readiness,
    -- the only entitlement path is an explicit, reasoned admin grant of a durable product
    (select body from def where sig = 'public.admin_commerce_grant_entitlement(uuid, uuid, text, text)') ~ 'reason_required'
      and (select body from def where sig = 'public.admin_commerce_grant_entitlement(uuid, uuid, text, text)') ~ 'entitlement_model <> ''durable'''
      and (select body from def where sig = 'public.admin_commerce_grant_entitlement(uuid, uuid, text, text)') ~ '''admin_grant'''
      as entitlement_grant_explicit,
    not exists (select 1 from def where body ~* 'update public\.commerce_entitlements|delete from public\.commerce_entitlements')
      as no_entitlement_revoke_or_delete,
    -- publishing a taxonomy term needs a human label
    (select body from def where sig = 'public.admin_commerce_save_term(uuid, text, text, text, text[], text, integer, text)')
      ~ 'needs_human_label' as published_terms_need_human_labels,
    -- internal review columns stay invisible to members; display_order is readable
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commerce_products' and column_name = 'cultural_review_state')
      and not has_column_privilege('authenticated', 'public.commerce_products', 'cultural_review_state', 'SELECT')
      and not has_column_privilege('authenticated', 'public.commerce_products', 'cultural_review_notes', 'SELECT')
      and not has_column_privilege('authenticated', 'public.commerce_products', 'rights_review_notes', 'SELECT')
      and has_column_privilege('authenticated', 'public.commerce_products', 'display_order', 'SELECT')
      as review_fields_internal_only,
    not has_table_privilege('authenticated', 'public.commerce_products', 'SELECT')
      and not exists (
        select 1 from unnest(array['commerce_products', 'commerce_credit_prices', 'commerce_price_books', 'commerce_taxonomy_terms',
                                   'commerce_collections', 'commerce_bundle_versions', 'commerce_entitlements']) t,
                      unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
        where has_table_privilege('authenticated', 'public.' || t, p) or has_table_privilege('anon', 'public.' || t, p)
      ) as no_client_table_writes,
    coalesce((select not (commerce_enabled or credit_spend_enabled or fiat_checkout_enabled or live_payments_enabled
                          or gifts_enabled or home_shelf_enabled)
              from public.commerce_settings where id = true), false) as all_commercial_switches_off,
    not exists (select 1 from public.commerce_payment_providers where checkout_enabled or live_mode_enabled) as providers_disabled
)
select *,
  (all_functions_exist and definer_and_search_path_pinned and pure_helpers_invoker_immutable_pinned and every_rpc_admin_gated and admin_gate_is_admin_role
   and client_privileges_correct and every_mutation_audited and no_switch_wallet_or_ledger_writes
   and publish_requires_readiness and entitlement_grant_explicit and no_entitlement_revoke_or_delete
   and published_terms_need_human_labels and review_fields_internal_only and no_client_table_writes
   and all_commercial_switches_off and providers_disabled) as overall_pass
from checks;
