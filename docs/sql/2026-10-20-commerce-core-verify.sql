-- ============================================================
-- TEMPA — COMMERCE CORE — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-20-commerce-core.sql.
-- One SELECT; changes nothing. Expect exactly one row with
-- overall_pass = true. Right after the migration every column is true;
-- all_commercial_switches_off, no_provider_enabled and no_money_moved are informational
-- (outside overall_pass) because they change once commerce launches.
-- ============================================================

with names(t) as (
  values ('commerce_settings'), ('commerce_products'), ('commerce_product_versions'), ('commerce_taxonomy_terms'),
         ('commerce_product_terms'), ('commerce_collections'), ('commerce_collection_products'), ('commerce_bundle_versions'),
         ('commerce_bundle_version_items'), ('commerce_credit_prices'), ('commerce_price_books'), ('commerce_payment_providers'),
         ('commerce_wallets'), ('commerce_ledger_entries'),
         ('commerce_purchases'), ('commerce_purchase_items'), ('commerce_entitlements'), ('commerce_gift_instances'),
         ('commerce_gift_preferences'), ('commerce_orders'), ('commerce_payment_attempts'), ('commerce_payment_events'),
         ('commerce_payment_adjustments')
),
member_tables(t) as (
  values ('commerce_wallets'), ('commerce_ledger_entries'), ('commerce_purchases'), ('commerce_purchase_items'),
         ('commerce_entitlements'), ('commerce_gift_instances'), ('commerce_gift_preferences'), ('commerce_orders'),
         ('commerce_payment_attempts'), ('commerce_payment_adjustments'), ('commerce_payment_events')
),
checks as (
  select
    (select count(*) from names n where to_regclass('public.' || n.t) is not null) = 23 as all_tables_exist,
    to_regclass('public.commerce_bundle_items') is null as no_unversioned_bundle_items,
    not exists (
      select 1 from names n join pg_class c on c.oid = to_regclass('public.' || n.t) where not c.relrowsecurity
    ) as rls_enabled_everywhere,
    -- no client role may write any commerce table
    not exists (
      select 1 from names n, unnest(array['anon', 'authenticated']) r(role), unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(priv)
      where has_table_privilege(r.role, 'public.' || n.t, p.priv)
    ) as no_client_write_privileges,
    not exists (
      select 1 from names n where has_table_privilege('anon', 'public.' || n.t, 'SELECT')
    ) as anon_reads_nothing,
    not exists (
      select 1 from pg_policies p join names n on n.t = p.tablename
      where p.schemaname = 'public' and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) as no_write_policies,
    -- money is integer, never floating point
    not exists (
      select 1 from information_schema.columns c join names n on n.t = c.table_name
      where c.table_schema = 'public'
        and (c.column_name ~ '(amount|credits|balance|delta|minor|charged|adjusted)' )
        and c.data_type <> 'bigint'
    ) as money_columns_bigint,
    not exists (
      select 1 from information_schema.columns c join names n on n.t = c.table_name
      where c.table_schema = 'public' and c.data_type in ('real', 'double precision', 'money')
    ) as no_float_money_types,
    -- ledger: append-only, only moved by the locked internal function
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.commerce_ledger_entries'::regclass
            and t.tgname = 'commerce_ledger_append_only' and t.tgenabled <> 'D') as ledger_append_only_trigger,
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.commerce_ledger_entries'::regclass
            and t.tgname = 'commerce_ledger_no_truncate' and t.tgenabled <> 'D') as ledger_no_truncate_trigger,
    coalesce((select p.prosecdef and 'search_path=pg_catalog' = any(p.proconfig) from pg_proc p
              where p.oid = to_regprocedure('tempa_private.commerce_append_ledger(uuid, bigint, text, text, uuid, text, text, uuid)')), false)
      as append_ledger_definer_pinned,
    coalesce(pg_get_functiondef(to_regprocedure('tempa_private.commerce_append_ledger(uuid, bigint, text, text, uuid, text, text, uuid)')), '')
      ~* 'from public\.commerce_wallets where user_id = p_user_id for update' as append_ledger_locks_wallet,
    not coalesce(has_function_privilege('authenticated', to_regprocedure('tempa_private.commerce_append_ledger(uuid, bigint, text, text, uuid, text, text, uuid)'), 'execute'), false)
      and not coalesce(has_function_privilege('anon', to_regprocedure('tempa_private.commerce_append_ledger(uuid, bigint, text, text, uuid, text, text, uuid)'), 'execute'), false)
      as append_ledger_not_client_callable,
    -- idempotent replay only for the identical operation (member, amount, type, source type, source id)
    coalesce(pg_get_functiondef(to_regprocedure('tempa_private.commerce_append_ledger(uuid, bigint, text, text, uuid, text, text, uuid)')), '')
      ~* 'v_existing\.source_type = p_source_type\s+and v_existing\.source_id is not distinct from p_source_id' as idempotency_matches_source,
    -- explicit accounting vocabulary, each type bound to its sign and source
    exists (select 1 from pg_constraint where conrelid = 'public.commerce_ledger_entries'::regclass and conname = 'commerce_ledger_source')
      and exists (select 1 from pg_constraint where conrelid = 'public.commerce_ledger_entries'::regclass and conname = 'commerce_ledger_sign')
      and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.commerce_ledger_entries'::regclass and conname = 'commerce_ledger_entries_entry_type_check')
          ~ 'purchase_refund_removal'
      and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.commerce_ledger_entries'::regclass and conname = 'commerce_ledger_entries_entry_type_check')
          ~ 'chargeback_restoration'
      and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.commerce_ledger_entries'::regclass and conname = 'commerce_ledger_entries_entry_type_check')
          ~ 'product_credit_refund'
      and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.commerce_ledger_entries'::regclass and conname = 'commerce_ledger_entries_entry_type_check')
          !~ 'refund_reversal|chargeback_reversal'
      as ledger_vocabulary_explicit,
    -- providers: a registry FK, never a hard-coded list
    (select count(*) from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'public.commerce_payment_providers'::regclass
        and c.conrelid in ('public.commerce_orders'::regclass, 'public.commerce_payment_attempts'::regclass, 'public.commerce_payment_events'::regclass)) = 3
      and not exists (select 1 from pg_constraint c join names n on c.conrelid = to_regclass('public.' || n.t)
                      where c.contype = 'c' and pg_get_constraintdef(c.oid) ~* 'flutterwave')
      as providers_registry_neutral,
    -- deterministic prices: no overlapping published windows
    exists (select 1 from pg_constraint where conname = 'commerce_credit_prices_no_overlap' and contype = 'x')
      and exists (select 1 from pg_constraint where conname = 'commerce_price_books_no_overlap' and contype = 'x')
      and exists (select 1 from pg_constraint where conname = 'commerce_bundle_versions_no_overlap' and contype = 'x')
      as price_windows_exclusive,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commerce_price_books' and column_name = 'market')
      and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commerce_price_books' and column_name = 'market_country_codes')
      as price_book_single_market,
    -- frozen history: versions, published prices / bundle versions, order and purchase snapshots
    (select count(*) from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'D' and t.tgname in (
       'commerce_product_versions_immutable', 'commerce_credit_prices_guard', 'commerce_price_books_guard',
       'commerce_bundle_versions_guard', 'commerce_bundle_items_guard', 'commerce_order_snapshot_guard',
       'commerce_purchase_price_guard', 'commerce_products_identity_guard')) = 8 as history_guards_present,
    -- Postcards added after this migration arrive as DRAFT products
    coalesce(pg_get_functiondef(to_regprocedure('tempa_private.commerce_postcard_product_for_new_catalog_row()')), '')
      ~ '''postcard'', new\.title, ''draft'', true'
      and coalesce(pg_get_functiondef(to_regprocedure('tempa_private.commerce_postcard_product_for_new_catalog_row()')), '') !~ '''published'''
      as new_postcards_default_draft,
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
                and column_name ~ 'credit|balance') as no_balance_on_profiles,
    -- wallet cache agrees with the ledger
    not exists (
      select 1 from public.commerce_wallets w
      where w.balance <> coalesce((select sum(l.delta) from public.commerce_ledger_entries l where l.user_id = w.user_id), 0)
    ) as wallet_matches_ledger,
    -- lifecycle-safe references: members via auth.users with NO ON DELETE action, never public.profiles
    not exists (
      select 1 from pg_constraint c join member_tables m on c.conrelid = to_regclass('public.' || m.t)
      where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
    ) and not exists (
      select 1 from pg_constraint c join names n on c.conrelid = to_regclass('public.' || n.t)
      where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
    ) as no_commerce_fk_to_profiles,
    not exists (
      select 1 from pg_constraint c join member_tables m on c.conrelid = to_regclass('public.' || m.t)
      where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'c'
    ) as financial_rows_never_cascade_deleted,
    -- a Gift is hidden from its recipient until delivered
    exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'commerce_gift_instances'
            and policyname = 'commerce_gift_instances_select_party' and qual ~* 'delivered') as gift_hidden_until_delivered,
    -- every commercial switch is off
    coalesce((select not (commerce_enabled or credit_spend_enabled or fiat_checkout_enabled or live_payments_enabled or gifts_enabled or home_shelf_enabled)
              from public.commerce_settings where id = true), false) as all_commercial_switches_off,
    not exists (select 1 from public.commerce_payment_providers where checkout_enabled or live_mode_enabled) as no_provider_enabled,
    -- existing Postcards covered, Complimentary, sending unchanged
    not exists (select 1 from public.postcard_catalog c where not exists (select 1 from public.commerce_products p where p.postcard_key = c.key))
      as every_postcard_has_product,
    not exists (select 1 from public.commerce_products where product_type = 'postcard' and not is_complimentary
                and not exists (select 1 from public.commerce_credit_prices cp where cp.product_id = commerce_products.id))
      as no_unpriced_paid_postcard,
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.postcard_catalog'::regclass
            and t.tgname = 'postcard_catalog_commerce_product' and t.tgenabled <> 'D') as new_postcards_auto_covered,
    -- nothing commercial exists yet
    (select count(*) from public.commerce_ledger_entries) = 0
      and (select count(*) from public.commerce_orders) = 0
      and (select count(*) from public.commerce_purchases) = 0 as no_money_moved
)
select *,
  (all_tables_exist and rls_enabled_everywhere and no_client_write_privileges and anon_reads_nothing and no_write_policies
   and money_columns_bigint and no_float_money_types and ledger_append_only_trigger and ledger_no_truncate_trigger
   and append_ledger_definer_pinned and append_ledger_locks_wallet and append_ledger_not_client_callable
   and no_unversioned_bundle_items and idempotency_matches_source and ledger_vocabulary_explicit and providers_registry_neutral
   and price_windows_exclusive and price_book_single_market and history_guards_present and new_postcards_default_draft
   and no_balance_on_profiles and wallet_matches_ledger and no_commerce_fk_to_profiles
   and financial_rows_never_cascade_deleted and gift_hidden_until_delivered
   and every_postcard_has_product and no_unpriced_paid_postcard and new_postcards_auto_covered) as overall_pass
from checks;
