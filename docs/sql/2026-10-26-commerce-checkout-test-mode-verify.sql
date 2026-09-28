-- ============================================================
-- TEMPA — COMMERCE CHECKOUT (FLUTTERWAVE TEST MODE) — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-26-commerce-checkout-test-mode.sql.
-- One SELECT; changes nothing. Expect exactly one row with overall_pass = true.
--
-- overall_pass covers the structural guarantees and must stay true forever.
-- The *_right_after_migration columns describe the state immediately after
-- the migration (nothing enabled); they become false once the owner turns
-- on test checkout, which is expected and not part of overall_pass.
-- ============================================================

with fns(sig, exposure) as (
  values
    ('public.commerce_credit_pack_offers()', 'member'),
    ('public.commerce_my_order(text)', 'member'),
    ('public.commerce_member_context()', 'member'),
    ('public.commerce_create_credit_order(uuid, text, text)', 'member'),
    ('public.commerce_settle_payment(text, text, text, text, bigint, text, text, text, text)', 'service'),
    ('public.admin_commerce_orders(integer)', 'member'),
    ('public.admin_commerce_checkout_config()', 'member'),
    ('tempa_private.commerce_checkout_gate(uuid, text)', 'private'),
    ('tempa_private.commerce_resolve_pack_price(uuid, text, text)', 'private')
),
def as (
  select f.sig, f.exposure, p.oid, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as body
  from fns f left join pg_proc p on p.oid = to_regprocedure(f.sig)
),
checks as (
  select
    not exists (select 1 from def where oid is null) as all_functions_exist,
    not exists (select 1 from def where not prosecdef or not coalesce(proconfig @> array['search_path=pg_catalog'], false))
      as definer_and_search_path_pinned,
    -- settlement is service-role only; member RPCs are authenticated-only; private helpers are nobody's
    not exists (select 1 from def where exposure = 'service'
                and (has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE')
                     or not has_function_privilege('service_role', oid, 'EXECUTE')))
      and not exists (select 1 from def where exposure = 'member'
                      and (has_function_privilege('anon', oid, 'EXECUTE') or not has_function_privilege('authenticated', oid, 'EXECUTE')))
      and not exists (select 1 from def where exposure = 'private'
                      and (has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE')))
      as execute_privileges_correct,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commerce_orders' and column_name = 'payment_mode')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'commerce_orders' and column_name = 'idempotency_key')
      as order_columns_exist,
    -- '*' can never be an eligible market (price fallback only, never sale authorization)
    exists (select 1 from pg_constraint c where c.conrelid = 'public.commerce_provider_markets'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) like '%[A-Z]{2}$%')
      and not exists (select 1 from public.commerce_provider_markets where market = '*')
      as star_market_never_eligible,
    (select relrowsecurity from pg_class where oid = 'public.commerce_provider_markets'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.commerce_checkout_testers'::regclass)
      and not exists (
        select 1 from unnest(array['commerce_provider_markets', 'commerce_checkout_testers']) t,
                      unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
        where has_table_privilege('authenticated', 'public.' || t, p) or has_table_privilege('anon', 'public.' || t, p))
      as new_tables_closed_to_clients,
    -- the gate checks eligibility before any price is resolved, and refuses live mode
    (select body from def where sig = 'tempa_private.commerce_checkout_gate(uuid, text)') ~ 'live_unavailable'
      and (select body from def where sig = 'tempa_private.commerce_checkout_gate(uuid, text)') ~ 'market_unsupported'
      and position('commerce_checkout_gate' in (select body from def where sig = 'public.commerce_create_credit_order(uuid, text, text)'))
          < position('commerce_resolve_pack_price' in (select body from def where sig = 'public.commerce_create_credit_order(uuid, text, text)'))
      and position('currency_unsupported' in (select body from def where sig = 'public.commerce_create_credit_order(uuid, text, text)'))
          < position('commerce_resolve_pack_price' in (select body from def where sig = 'public.commerce_create_credit_order(uuid, text, text)'))
      as eligibility_before_price,
    -- Credits move only through the ledger helper, with one key per order
    (select body from def where sig = 'public.commerce_settle_payment(text, text, text, text, bigint, text, text, text, text)')
      ~ 'commerce_append_ledger\(\s*v_order\.user_id, v_order\.credits_to_grant, ''credit_purchase'', ''order'', v_order\.id, ''order:'' \|\| v_order\.id::text\)'
      and not exists (select 1 from def where body ~* 'update public\.commerce_wallets|insert into public\.commerce_ledger_entries')
      as credits_only_via_ledger_helper,
    -- replayed provider events are recorded once and never reprocessed
    (select body from def where sig = 'public.commerce_settle_payment(text, text, text, text, bigint, text, text, text, text)')
      ~ 'on conflict \(provider, provider_event_id\) do nothing'
      and (select body from def where sig = 'public.commerce_settle_payment(text, text, text, text, bigint, text, text, text, text)') ~ 'for update'
      as settlement_replay_safe,
    -- nothing here can switch commerce on
    not exists (select 1 from def where body ~* 'update public\.commerce_settings|update public\.commerce_payment_providers|insert into public\.commerce_(provider_markets|checkout_testers)')
      as no_switch_writes,
    coalesce((select not (commerce_enabled or credit_spend_enabled or fiat_checkout_enabled or live_payments_enabled
                          or gifts_enabled or home_shelf_enabled)
              from public.commerce_settings where id = true), false) as all_commercial_switches_off,
    not exists (select 1 from public.commerce_payment_providers where live_mode_enabled) as live_mode_off,
    not exists (select 1 from public.commerce_payment_providers where checkout_enabled) as provider_checkout_off_right_after_migration,
    not exists (select 1 from public.commerce_provider_markets where enabled) as no_markets_right_after_migration,
    not exists (select 1 from public.commerce_checkout_testers) as no_testers_right_after_migration
)
select *,
  (all_functions_exist and definer_and_search_path_pinned and execute_privileges_correct and order_columns_exist
   and star_market_never_eligible and new_tables_closed_to_clients and eligibility_before_price
   and credits_only_via_ledger_helper and settlement_replay_safe and no_switch_writes
   and all_commercial_switches_off and live_mode_off) as overall_pass
from checks;
