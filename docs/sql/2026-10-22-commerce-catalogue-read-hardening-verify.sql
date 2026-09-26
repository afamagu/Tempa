-- ============================================================
-- TEMPA — COMMERCE CATALOGUE READ HARDENING — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-22-commerce-catalogue-read-hardening.sql.
-- One SELECT; changes nothing. Expect exactly one row with every column
-- true and overall_pass = true.
-- ============================================================

with hidden(t, c) as (
  values ('commerce_products', 'rights_review_state'), ('commerce_products', 'rights_review_notes'),
         ('commerce_products', 'metadata'), ('commerce_products', 'created_by'),
         ('commerce_product_versions', 'created_by'), ('commerce_credit_prices', 'created_by'),
         ('commerce_collections', 'created_by'), ('commerce_bundle_versions', 'created_by'),
         ('commerce_purchases', 'idempotency_key'), ('commerce_purchases', 'ledger_entry_id'),
         ('commerce_purchases', 'credit_price_id'), ('commerce_purchases', 'refund_ledger_entry_id')
),
shown(t, c) as (
  values ('commerce_products', 'id'), ('commerce_products', 'title'), ('commerce_products', 'postcard_key'),
         ('commerce_products', 'is_complimentary'), ('commerce_products', 'preview_policy'),
         ('commerce_products', 'lifecycle_state'), ('commerce_product_versions', 'image_path'),
         ('commerce_credit_prices', 'credit_amount'), ('commerce_collections', 'is_featured'),
         ('commerce_purchases', 'credits_charged')
),
checks as (
  select
    not exists (
      select 1 from hidden h
      where has_column_privilege('authenticated', 'public.' || h.t, h.c, 'SELECT')
         or has_column_privilege('anon', 'public.' || h.t, h.c, 'SELECT')
    ) as internal_columns_not_readable,
    not exists (
      select 1 from shown s where not has_column_privilege('authenticated', 'public.' || s.t, s.c, 'SELECT')
    ) as catalogue_columns_readable,
    not exists (
      select 1 from unnest(array['commerce_products', 'commerce_product_versions', 'commerce_credit_prices',
                                 'commerce_collections', 'commerce_bundle_versions', 'commerce_purchases']) t
      where has_table_privilege('authenticated', 'public.' || t, 'SELECT')
    ) as no_table_wide_select,
    not exists (
      select 1 from unnest(array['commerce_products', 'commerce_product_versions', 'commerce_credit_prices',
                                 'commerce_collections', 'commerce_bundle_versions', 'commerce_purchases']) t,
                    unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
      where has_table_privilege('authenticated', 'public.' || t, p) or has_table_privilege('anon', 'public.' || t, p)
    ) as no_client_writes,
    coalesce((select p.prosecdef and 'search_path=pg_catalog' = any(p.proconfig) from pg_proc p
              where p.oid = to_regprocedure('public.commerce_member_context()')), false)
      and coalesce(has_function_privilege('authenticated', to_regprocedure('public.commerce_member_context()'), 'execute'), false)
      and not coalesce(has_function_privilege('anon', to_regprocedure('public.commerce_member_context()'), 'execute'), true)
      as member_context_definer_authenticated_only,
    coalesce(pg_get_functiondef(to_regprocedure('public.commerce_member_context()')), '') ~ 'user_id = auth\.uid\(\)'
      and coalesce(pg_get_functiondef(to_regprocedure('public.commerce_member_context()')), '') !~* 'updated_by|updated_at'
      as member_context_own_balance_no_admin_fields,
    coalesce((select not (commerce_enabled or credit_spend_enabled or fiat_checkout_enabled or live_payments_enabled
                          or gifts_enabled or home_shelf_enabled)
              from public.commerce_settings where id = true), false) as all_commercial_switches_off,
    not exists (select 1 from public.commerce_payment_providers where checkout_enabled or live_mode_enabled) as providers_disabled
)
select *,
  (internal_columns_not_readable and catalogue_columns_readable and no_table_wide_select and no_client_writes
   and member_context_definer_authenticated_only and member_context_own_balance_no_admin_fields
   and all_commercial_switches_off and providers_disabled) as overall_pass
from checks;
