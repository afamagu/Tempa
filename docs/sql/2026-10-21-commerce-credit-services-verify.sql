-- ============================================================
-- TEMPA — COMMERCE CREDIT SERVICES — VERIFIER (READ-ONLY)
-- Pairs with docs/sql/2026-10-21-commerce-credit-services.sql.
-- One SELECT; changes nothing. Expect exactly one row with every column
-- true and overall_pass = true. The switch/provider columns are part of
-- overall_pass for THIS gate (Checkpoint 2 must leave everything OFF);
-- they are expected to change only at a later, explicit launch gate.
-- ============================================================

with fns(sig, is_member_rpc) as (
  values
    ('public.commerce_my_credit_balance()', true),
    ('public.commerce_my_credit_history(integer, timestamptz, uuid)', true),
    ('public.commerce_my_entitlements()', true),
    ('public.commerce_product_offer(uuid)', true),
    ('public.commerce_bundle_offer(uuid)', true),
    ('public.commerce_purchase_product(uuid, text)', true),
    ('public.commerce_purchase_bundle(uuid, text)', true),
    ('public.commerce_purchase_gift(uuid, uuid, text)', true),
    ('public.admin_grant_credits(uuid, bigint, text, text, text)', true),
    ('public.admin_adjust_credits(uuid, bigint, text, text)', true),
    ('tempa_private.commerce_require_spender(boolean)', false),
    ('tempa_private.commerce_lock_wallet(uuid)', false),
    ('tempa_private.commerce_resolve_credit_price(uuid)', false),
    ('tempa_private.commerce_owns(uuid, uuid)', false),
    ('tempa_private.commerce_bundle_quote(uuid, uuid)', false),
    ('tempa_private.commerce_admin_credit_op(uuid, bigint, text, text, text)', false),
    ('tempa_private.commerce_postcard_send_allowed(uuid, text)', false),
    ('tempa_private.commerce_enforce_postcard_ownership()', false),
    ('tempa_private.commerce_append_ledger(uuid, bigint, text, text, uuid, text, text, uuid)', false)
),
def(name, body) as (
  select f.sig, coalesce(pg_get_functiondef(to_regprocedure(f.sig)), '') from fns f
),
spend(sig) as (
  values ('public.commerce_purchase_product(uuid, text)'), ('public.commerce_purchase_bundle(uuid, text)'),
         ('public.commerce_purchase_gift(uuid, uuid, text)')
),
fin(t) as (
  values ('commerce_wallets'), ('commerce_ledger_entries'), ('commerce_purchases'), ('commerce_purchase_items'),
         ('commerce_entitlements'), ('commerce_gift_instances'), ('commerce_orders'), ('commerce_payment_providers'),
         ('commerce_settings'), ('commerce_credit_prices'), ('commerce_bundle_versions'), ('commerce_bundle_version_items')
),
checks as (
  select
    (select count(*) from fns where to_regprocedure(sig) is not null) = (select count(*) from fns) as all_functions_exist,
    not exists (
      select 1 from fns f join pg_proc p on p.oid = to_regprocedure(f.sig)
      where f.sig not like '%enforce_postcard_ownership%'
        and not (p.prosecdef and 'search_path=pg_catalog' = any(p.proconfig))
    ) and coalesce((select 'search_path=pg_catalog' = any(p.proconfig) and p.prosecdef from pg_proc p
                    where p.oid = to_regprocedure('tempa_private.commerce_enforce_postcard_ownership()')), false)
      as definer_and_search_path_pinned,
    not exists (
      select 1 from fns f
      where f.is_member_rpc and (not has_function_privilege('authenticated', to_regprocedure(f.sig), 'execute')
                                 or has_function_privilege('anon', to_regprocedure(f.sig), 'execute'))
    ) as member_rpcs_authenticated_only,
    not exists (
      select 1 from fns f, unnest(array['anon', 'authenticated']) r(role)
      where not f.is_member_rpc and has_function_privilege(r.role, to_regprocedure(f.sig), 'execute')
    ) as private_helpers_not_client_callable,
    -- spend paths: switch-gated, wallet locked before anything else, price resolved server-side
    not exists (
      select 1 from spend s join def d on d.name = s.sig
      where d.body !~ 'tempa_private\.commerce_require_spender\('
         or d.body !~ 'tempa_private\.commerce_lock_wallet\(v_uid\)'
         or position('commerce_require_spender' in d.body) > position('commerce_lock_wallet' in d.body)
         or position('commerce_lock_wallet' in d.body) > position('idempotency_key = v_key' in d.body)
    ) as spend_paths_gated_and_serialised,
    (select body from def where name = 'tempa_private.commerce_require_spender(boolean)')
      ~ 'commerce_enabled and v_settings\.credit_spend_enabled'
      and (select body from def where name = 'tempa_private.commerce_require_spender(boolean)') ~ 'gifts_enabled'
      and (select body from def where name = 'tempa_private.commerce_require_spender(boolean)') ~ 'current_account_status\(\) is distinct from ''active'''
      as spend_switches_and_account_state_required,
    (select body from def where name = 'tempa_private.commerce_resolve_credit_price(uuid)') ~ 'v_count <> 1'
      and (select body from def where name = 'tempa_private.commerce_resolve_credit_price(uuid)') ~ 'is_complimentary'
      as price_resolution_fails_closed,
    -- bundles hold durable entitlements only, and no existing bundle item breaks that
    coalesce(pg_get_functiondef(to_regprocedure('tempa_private.commerce_bundle_items_guard()')), '') ~ 'entitlement_model = ''durable'''
      and not exists (
        select 1 from public.commerce_bundle_version_items i join public.commerce_products p on p.id = i.item_product_id
        where p.entitlement_model <> 'durable'
      ) as bundle_items_durable_only,
    -- premium Postcard ownership enforced on BOTH snapshot tables, actor from the parent row
    (select count(*) from pg_trigger t
     where not t.tgisinternal and t.tgenabled <> 'D'
       and t.tgfoid = to_regprocedure('tempa_private.commerce_enforce_postcard_ownership()')
       and t.tgrelid in ('public.letter_postcards'::regclass, 'public.dispatch_postcards'::regclass)
       and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4) = 2 as postcard_send_trigger_on_both_tables,
    (select body from def where name = 'tempa_private.commerce_enforce_postcard_ownership()') ~ 'select l\.sender_id into v_member from public\.letters'
      and (select body from def where name = 'tempa_private.commerce_enforce_postcard_ownership()') ~ 'select d\.author_id into v_member from public\.dispatches'
      and (select body from def where name = 'tempa_private.commerce_enforce_postcard_ownership()') !~ 'auth\.uid\(\)'
      and (select body from def where name = 'tempa_private.commerce_enforce_postcard_ownership()') !~* 'is_staff'
      as postcard_actor_from_parent_no_bypass,
    (select body from def where name = 'tempa_private.commerce_postcard_send_allowed(uuid, text)') ~ 'p\.is_complimentary or tempa_private\.commerce_owns'
      and (select body from def where name = 'tempa_private.commerce_owns(uuid, uuid)') ~ 'e\.state = ''active'''
      as complimentary_passes_premium_needs_active_entitlement,
    not exists (
      select 1 from public.postcard_catalog c
      where not exists (select 1 from public.commerce_products p where p.postcard_key = c.key)
    ) as every_postcard_has_product,
    -- admin Credit operations: admin role, reason, audit, ledger helper only
    (select body from def where name = 'tempa_private.commerce_admin_credit_op(uuid, bigint, text, text, text)') ~ 'is_staff\(''admin''\)'
      and (select body from def where name = 'tempa_private.commerce_admin_credit_op(uuid, bigint, text, text, text)') ~ 'reason_required'
      and (select body from def where name = 'tempa_private.commerce_admin_credit_op(uuid, bigint, text, text, text)') ~ 'insert into public\.admin_audit_log'
      and (select body from def where name = 'tempa_private.commerce_admin_credit_op(uuid, bigint, text, text, text)') ~ 'tempa_private\.commerce_append_ledger\('
      and (select body from def where name = 'tempa_private.commerce_admin_credit_op(uuid, bigint, text, text, text)') !~* 'update public\.commerce_wallets'
      as admin_ops_gated_audited_ledger_only,
    -- clients still cannot write anything financial; ledger read only via the history RPC
    not exists (
      select 1 from fin, unnest(array['anon', 'authenticated']) r(role), unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(priv)
      where has_table_privilege(r.role, 'public.' || fin.t, p.priv)
    ) as no_client_financial_writes,
    not has_table_privilege('authenticated', 'public.commerce_ledger_entries', 'SELECT')
      and not has_table_privilege('anon', 'public.commerce_ledger_entries', 'SELECT') as ledger_read_only_via_rpc,
    -- ledger integrity unchanged
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.commerce_ledger_entries'::regclass
            and t.tgname = 'commerce_ledger_append_only' and t.tgenabled <> 'D')
      and exists (select 1 from pg_trigger t where t.tgrelid = 'public.commerce_ledger_entries'::regclass
                  and t.tgname = 'commerce_ledger_no_truncate' and t.tgenabled <> 'D') as ledger_still_append_only,
    not exists (
      select 1 from public.commerce_wallets w
      where w.balance <> coalesce((select sum(l.delta) from public.commerce_ledger_entries l where l.user_id = w.user_id), 0)
    ) as wallet_matches_ledger,
    -- nothing is switched on
    coalesce((select not (commerce_enabled or credit_spend_enabled or fiat_checkout_enabled or live_payments_enabled
                          or gifts_enabled or home_shelf_enabled)
              from public.commerce_settings where id = true), false) as all_commercial_switches_off,
    not exists (select 1 from public.commerce_payment_providers where checkout_enabled or live_mode_enabled)
      and exists (select 1 from public.commerce_payment_providers where code = 'flutterwave' and not checkout_enabled and not live_mode_enabled)
      as providers_disabled
)
select *,
  (all_functions_exist and definer_and_search_path_pinned and member_rpcs_authenticated_only
   and private_helpers_not_client_callable and spend_paths_gated_and_serialised
   and spend_switches_and_account_state_required and price_resolution_fails_closed and bundle_items_durable_only
   and postcard_send_trigger_on_both_tables and postcard_actor_from_parent_no_bypass
   and complimentary_passes_premium_needs_active_entitlement and every_postcard_has_product
   and admin_ops_gated_audited_ledger_only and no_client_financial_writes and ledger_read_only_via_rpc
   and ledger_still_append_only and wallet_matches_ledger and all_commercial_switches_off and providers_disabled) as overall_pass
from checks;
