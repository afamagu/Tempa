-- Commerce Checkpoint 5 — fiat → Tempa Credits checkout, Flutterwave TEST MODE.
--
-- Forward-only. Enables NOTHING: every commerce_settings switch stays OFF,
-- Flutterwave keeps checkout and live mode disabled, no market is eligible
-- and no tester is listed. Turning test checkout on is an explicit owner
-- step (see docs/commerce-architecture.md, Checkpoint 5).
--
-- Governing rule: monetize preservation and expression, never access to
-- people. Nothing here is read by People discovery, introductions, Board
-- ranking, Mail Call or any correspondence gate.
--
-- What this adds
--   1. commerce_orders.payment_mode ('test' | 'live') and an idempotency key.
--   2. commerce_provider_markets — which exact market + currency each payment
--      provider may sell in. market '*' is NOT allowed here: the price-book
--      '*' row is a price fallback only and never authorizes a sale.
--   3. commerce_checkout_testers — members allowed to use TEST checkout while
--      member commerce is still OFF (pre-launch testing on the production
--      database without opening checkout to anyone else).
--   4. Checkout gate, in this order: active account → provider checkout on
--      and NOT live (Checkpoint 5 is test-only) → (commerce_enabled AND
--      fiat_checkout_enabled) OR listed tester → member market (profile
--      country) eligible → currency eligible for that market → only then the
--      exact published price: exact market row, else the '*' fallback row.
--   5. commerce_create_credit_order — server-authoritative order + payment
--      attempt; the client names a pack, a currency and an idempotency key,
--      never an amount, a Credit count or a price.
--   6. commerce_settle_payment — SERVICE ROLE ONLY, called by the server
--      after it has re-verified the transaction with the provider's API.
--      Provider events are recorded once (replay-safe); the order row is
--      locked; amount/currency must match exactly; one verified success →
--      exactly one credit_purchase ledger entry via commerce_append_ledger.
--   7. Member/admin reads: commerce_credit_pack_offers, commerce_my_order,
--      commerce_member_context (+ checkout_available), admin_commerce_orders
--      (+ mode, transaction id, events), admin_commerce_checkout_config.

begin;

-- ------------------------------------------------------------
-- 1. ORDERS — mode + idempotency (financial snapshot stays frozen)
-- ------------------------------------------------------------
alter table public.commerce_orders
  add column if not exists payment_mode text check (payment_mode is null or payment_mode in ('test', 'live'));
alter table public.commerce_orders
  add column if not exists idempotency_key text unique
    check (idempotency_key is null or (char_length(idempotency_key) between 8 and 200 and idempotency_key ~ '^[A-Za-z0-9:_-]+$'));

-- ------------------------------------------------------------
-- 2. PROVIDER ELIGIBILITY (nothing enabled)
-- ------------------------------------------------------------
create table if not exists public.commerce_provider_markets (
  provider text not null references public.commerce_payment_providers(code),
  market text not null check (market ~ '^[A-Z]{2}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, market, currency)
);

-- ------------------------------------------------------------
-- 3. TEST-CHECKOUT ALLOWLIST (nobody listed)
-- ------------------------------------------------------------
create table if not exists public.commerce_checkout_testers (
  user_id uuid primary key references auth.users(id),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);

alter table public.commerce_provider_markets enable row level security;
alter table public.commerce_checkout_testers enable row level security;
revoke all on public.commerce_provider_markets from public, anon, authenticated;
revoke all on public.commerce_checkout_testers from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. CHECKOUT GATE
-- ------------------------------------------------------------
-- Returns (market, reason). reason is null only when the member may open a
-- TEST checkout with this provider. Never raises; callers decide.
create or replace function tempa_private.commerce_checkout_gate(p_user_id uuid, p_provider text)
returns table (market text, mode text, reason text)
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_settings public.commerce_settings;
  v_provider public.commerce_payment_providers;
  v_market text;
begin
  mode := 'test';
  if p_user_id is null then
    reason := 'not_authorized'; return next; return;
  end if;
  if public.current_account_status() is distinct from 'active' then
    reason := 'account_unavailable'; return next; return;
  end if;

  select * into v_provider from public.commerce_payment_providers where code = p_provider;
  if not found or not v_provider.checkout_enabled then
    reason := 'checkout_disabled'; return next; return;
  end if;
  -- Checkpoint 5 is TEST MODE only; live payments arrive at the launch gate.
  if v_provider.live_mode_enabled then
    reason := 'live_unavailable'; return next; return;
  end if;

  select * into v_settings from public.commerce_settings where id;
  if not (coalesce(v_settings.commerce_enabled and v_settings.fiat_checkout_enabled, false)
          or exists (select 1 from public.commerce_checkout_testers t where t.user_id = p_user_id)) then
    reason := 'checkout_disabled'; return next; return;
  end if;

  select upper(pr.country_code) into v_market from public.profiles pr where pr.id = p_user_id;
  if v_market is null or v_market !~ '^[A-Z]{2}$'
     or not exists (select 1 from public.commerce_provider_markets pm
                    where pm.provider = p_provider and pm.market = v_market and pm.enabled) then
    market := v_market; reason := 'market_unsupported'; return next; return;
  end if;

  market := v_market;
  reason := null;
  return next;
end;
$function$;

-- The price a Credit pack sells for in (market, currency): the published
-- row covering now for the exact market, else the '*' fallback row. Only
-- ever called AFTER the gate has established market + currency eligibility.
create or replace function tempa_private.commerce_resolve_pack_price(p_product_id uuid, p_market text, p_currency text)
returns public.commerce_price_books
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select pb.*
  from public.commerce_price_books pb
  join public.commerce_products p on p.id = pb.product_id
  where pb.product_id = p_product_id
    and p.product_type = 'credit_pack'
    and p.lifecycle_state = 'published'
    and (p.publish_at is null or p.publish_at <= now())
    and (p.unpublish_at is null or p.unpublish_at > now())
    and pb.state = 'published'
    and pb.currency = p_currency
    and pb.market in (p_market, '*')
    and pb.effective_from <= now()
    and (pb.effective_to is null or pb.effective_to > now())
  order by (pb.market = p_market) desc
  limit 1
$function$;

-- ------------------------------------------------------------
-- 5. MEMBER READS
-- ------------------------------------------------------------
create or replace function public.commerce_credit_pack_offers()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  v_gate record;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into v_gate from tempa_private.commerce_checkout_gate(v_uid, 'flutterwave');
  if v_gate.reason is not null then
    return jsonb_build_object('available', false, 'reason', v_gate.reason, 'mode', v_gate.mode, 'offers', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'available', true, 'reason', null, 'mode', v_gate.mode, 'market', v_gate.market,
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', p.id, 'title', p.title, 'credits', p.credit_amount,
               'currency', pm.currency, 'amount_minor', pb.amount_minor)
             order by p.credit_amount, pm.currency)
      from public.commerce_products p
      join public.commerce_provider_markets pm
        on pm.provider = 'flutterwave' and pm.market = v_gate.market and pm.enabled
      cross join lateral tempa_private.commerce_resolve_pack_price(p.id, v_gate.market, pm.currency) pb
      where p.product_type = 'credit_pack' and pb.id is not null), '[]'::jsonb));
end;
$function$;

create or replace function public.commerce_my_order(p_reference text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  o public.commerce_orders;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into o from public.commerce_orders where tempa_reference = p_reference and user_id = v_uid;
  if not found then
    return null;
  end if;
  return jsonb_build_object('reference', o.tempa_reference, 'state', o.state, 'product', o.product_title_snapshot,
    'credits', o.credits_to_grant, 'currency', o.currency, 'amount_minor', o.amount_minor, 'mode', o.payment_mode,
    'paid_at', o.paid_at,
    'balance', coalesce((select balance from public.commerce_wallets where user_id = v_uid), 0));
end;
$function$;

-- Same keys as 2026-10-22, plus checkout_available (gate passes for this
-- member, including a listed tester in test mode).
create or replace function public.commerce_member_context()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_settings public.commerce_settings;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into v_settings from public.commerce_settings where id;
  return jsonb_build_object(
    'spend_enabled', coalesce(v_settings.commerce_enabled and v_settings.credit_spend_enabled, false),
    'gifts_enabled', coalesce(v_settings.commerce_enabled and v_settings.credit_spend_enabled and v_settings.gifts_enabled, false),
    'checkout_enabled', coalesce(v_settings.commerce_enabled and v_settings.fiat_checkout_enabled, false),
    'checkout_available', (select g.reason is null from tempa_private.commerce_checkout_gate(auth.uid(), 'flutterwave') g),
    'balance', coalesce((select balance from public.commerce_wallets where user_id = auth.uid()), 0)
  );
end;
$function$;

-- ------------------------------------------------------------
-- 6. ORDER CREATION (member)
-- ------------------------------------------------------------
create or replace function public.commerce_create_credit_order(p_product_id uuid, p_currency text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  v_gate record;
  v_key text;
  v_currency text := upper(coalesce(p_currency, ''));
  v_existing public.commerce_orders;
  v_price public.commerce_price_books;
  v_product public.commerce_products;
  v_order public.commerce_orders;
  v_reference text;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  v_key := tempa_private.commerce_valid_key(p_idempotency_key);

  -- Replay of the same intent returns the original order (before any gate,
  -- so a retry after a switch change still resolves to what was created).
  select * into v_existing from public.commerce_orders where idempotency_key = v_key;
  if found then
    if v_existing.user_id = v_uid and v_existing.product_id = p_product_id and v_existing.currency = v_currency then
      return jsonb_build_object('order_id', v_existing.id, 'reference', v_existing.tempa_reference,
        'product', v_existing.product_title_snapshot, 'credits', v_existing.credits_to_grant,
        'currency', v_existing.currency, 'amount_minor', v_existing.amount_minor,
        'mode', v_existing.payment_mode, 'state', v_existing.state, 'replayed', true);
    end if;
    perform tempa_private.commerce_raise('idempotency_conflict');
  end if;

  select * into v_gate from tempa_private.commerce_checkout_gate(v_uid, 'flutterwave');
  if v_gate.reason is not null then
    perform tempa_private.commerce_raise(v_gate.reason);
  end if;

  if v_currency !~ '^[A-Z]{3}$' or not exists (
    select 1 from public.commerce_provider_markets pm
    where pm.provider = 'flutterwave' and pm.market = v_gate.market and pm.currency = v_currency and pm.enabled) then
    perform tempa_private.commerce_raise('currency_unsupported');
  end if;

  select * into v_product from public.commerce_products where id = p_product_id and product_type = 'credit_pack';
  if not found then
    perform tempa_private.commerce_raise('not_available');
  end if;

  v_price := tempa_private.commerce_resolve_pack_price(p_product_id, v_gate.market, v_currency);
  if v_price.id is null then
    perform tempa_private.commerce_raise('price_unavailable');
  end if;

  if (select count(*) from public.commerce_orders o
      where o.user_id = v_uid and o.state in ('created', 'pending') and o.created_at > now() - interval '24 hours') >= 10 then
    perform tempa_private.commerce_raise('too_many_orders');
  end if;

  v_reference := 'TEMPA-' || upper(replace(gen_random_uuid()::text, '-', ''));
  insert into public.commerce_orders (
    user_id, product_id, product_title_snapshot, price_book_id, market, currency, amount_minor,
    usd_reference_minor, credits_to_grant, tempa_reference, provider, state, payment_mode, idempotency_key
  ) values (
    v_uid, v_product.id, v_product.title, v_price.id, v_price.market, v_price.currency, v_price.amount_minor,
    v_price.usd_reference_minor, v_product.credit_amount, v_reference, 'flutterwave', 'created', v_gate.mode, v_key
  )
  on conflict (idempotency_key) do nothing
  returning * into v_order;

  if v_order.id is null then
    -- A concurrent request with the same key won; resolve to its order.
    return public.commerce_create_credit_order(p_product_id, p_currency, p_idempotency_key);
  end if;

  insert into public.commerce_payment_attempts (order_id, provider, provider_reference, expected_amount_minor, expected_currency)
  values (v_order.id, 'flutterwave', v_order.tempa_reference, v_order.amount_minor, v_order.currency);

  return jsonb_build_object('order_id', v_order.id, 'reference', v_order.tempa_reference,
    'product', v_order.product_title_snapshot, 'credits', v_order.credits_to_grant,
    'currency', v_order.currency, 'amount_minor', v_order.amount_minor,
    'mode', v_order.payment_mode, 'state', v_order.state, 'replayed', false);
end;
$function$;

-- ------------------------------------------------------------
-- 7. SETTLEMENT (service role only; provider-verified input)
-- ------------------------------------------------------------
-- p_status is the server's normalisation of the VERIFIED provider status:
-- 'successful' | 'failed' | 'cancelled' | 'pending'. p_amount_minor and
-- p_currency are the verified charged amount/currency. p_event_id makes
-- every delivery (webhook or return) replay-safe.
create or replace function public.commerce_settle_payment(
  p_provider text,
  p_reference text,
  p_transaction_id text,
  p_status text,
  p_amount_minor bigint,
  p_currency text,
  p_event_id text,
  p_event_type text,
  p_payload_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_event_id uuid;
  v_order public.commerce_orders;
  v_attempt public.commerce_payment_attempts;
  v_entry public.commerce_ledger_entries;
  v_outcome text;
  v_credited boolean := false;
begin
  if p_provider is null or p_reference is null or p_event_id is null or p_event_type is null
     or p_status not in ('successful', 'failed', 'cancelled', 'pending') then
    perform tempa_private.commerce_raise('invalid_request');
  end if;

  insert into public.commerce_payment_events (provider, provider_event_id, event_type, payload_sha256)
  values (p_provider, left(p_event_id, 200), left(p_event_type, 100), p_payload_sha256)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;
  if v_event_id is null then
    return jsonb_build_object('outcome', 'duplicate', 'credited', false,
      'order_state', (select state from public.commerce_orders where tempa_reference = p_reference));
  end if;

  select * into v_order from public.commerce_orders where tempa_reference = p_reference and provider = p_provider for update;
  if not found then
    update public.commerce_payment_events set outcome = 'rejected', processed_at = now() where id = v_event_id;
    return jsonb_build_object('outcome', 'rejected', 'credited', false, 'order_state', null);
  end if;
  select * into v_attempt from public.commerce_payment_attempts
    where order_id = v_order.id and provider = p_provider and provider_reference = p_reference for update;

  if v_order.state = 'paid' then
    v_outcome := 'duplicate';
    if p_status = 'successful' and p_transaction_id is distinct from v_attempt.provider_transaction_id then
      -- A second successful charge for an already-paid order: money to reconcile, never more Credits.
      update public.commerce_payment_attempts set reconciliation_state = 'needs_attention', updated_at = now() where id = v_attempt.id;
    end if;
  elsif p_status = 'successful' then
    if p_amount_minor is distinct from v_attempt.expected_amount_minor or p_currency is distinct from v_attempt.expected_currency then
      update public.commerce_payment_attempts
        set provider_status = left(p_status, 60), verification_state = 'mismatch', reconciliation_state = 'needs_attention',
            failure_reason = 'Verified amount or currency did not match the order.', updated_at = now()
        where id = v_attempt.id;
      v_outcome := 'rejected';
    elsif p_transaction_id is null or exists (
      select 1 from public.commerce_payment_attempts a
      where a.provider = p_provider and a.provider_transaction_id = p_transaction_id and a.id <> v_attempt.id) then
      update public.commerce_payment_attempts
        set reconciliation_state = 'needs_attention', failure_reason = 'Transaction id missing or already used by another order.', updated_at = now()
        where id = v_attempt.id;
      v_outcome := 'rejected';
    else
      v_entry := tempa_private.commerce_append_ledger(
        v_order.user_id, v_order.credits_to_grant, 'credit_purchase', 'order', v_order.id, 'order:' || v_order.id::text);
      update public.commerce_orders
        set state = 'paid', paid_at = now(), credit_ledger_entry_id = v_entry.id, updated_at = now()
        where id = v_order.id
        returning * into v_order;
      update public.commerce_payment_attempts
        set provider_transaction_id = left(p_transaction_id, 200), provider_status = left(p_status, 60),
            verification_state = 'verified', reconciliation_state = 'settled', failure_reason = null, updated_at = now()
        where id = v_attempt.id;
      v_outcome := 'applied';
      v_credited := true;
    end if;
  elsif p_status in ('failed', 'cancelled') then
    update public.commerce_orders
      set state = p_status, failed_at = coalesce(failed_at, now()), updated_at = now()
      where id = v_order.id and state in ('created', 'pending')
      returning * into v_order;
    update public.commerce_payment_attempts
      set provider_transaction_id = coalesce(provider_transaction_id, left(p_transaction_id, 200)),
          provider_status = left(p_status, 60), verification_state = 'failed', updated_at = now()
      where id = v_attempt.id and verification_state <> 'verified';
    v_outcome := 'applied';
    select * into v_order from public.commerce_orders where tempa_reference = p_reference;
  else
    update public.commerce_orders set state = 'pending', updated_at = now() where id = v_order.id and state = 'created'
      returning * into v_order;
    update public.commerce_payment_attempts set provider_status = left(p_status, 60), updated_at = now() where id = v_attempt.id;
    v_outcome := 'applied';
    select * into v_order from public.commerce_orders where tempa_reference = p_reference;
  end if;

  update public.commerce_payment_events set order_id = v_order.id, outcome = v_outcome, processed_at = now() where id = v_event_id;
  return jsonb_build_object('outcome', v_outcome, 'credited', v_credited, 'order_state', v_order.state);
end;
$function$;

-- ------------------------------------------------------------
-- 8. ADMIN READS (admin-only; no secrets exist in these tables)
-- ------------------------------------------------------------
create or replace function public.admin_commerce_orders(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  perform tempa_private.commerce_require_admin();
  return coalesce((select jsonb_agg(x order by (x->>'created_at') desc) from (
      select jsonb_build_object('id', o.id, 'reference', o.tempa_reference, 'member_id', o.user_id,
             'member', tempa_private.commerce_member_label(o.user_id), 'product', o.product_title_snapshot,
             'credits', o.credits_to_grant, 'market', o.market, 'currency', o.currency, 'amount_minor', o.amount_minor,
             'usd_reference_minor', o.usd_reference_minor, 'provider', o.provider, 'state', o.state,
             'mode', o.payment_mode, 'credited', o.credit_ledger_entry_id is not null,
             'created_at', o.created_at, 'paid_at', o.paid_at,
             'attempts', coalesce((select jsonb_agg(jsonb_build_object('reference', a.provider_reference, 'status', a.provider_status,
                            'transaction_id', a.provider_transaction_id,
                            'verification', a.verification_state, 'reconciliation', a.reconciliation_state,
                            'expected_amount_minor', a.expected_amount_minor, 'expected_currency', a.expected_currency,
                            'created_at', a.created_at) order by a.created_at)
                          from public.commerce_payment_attempts a where a.order_id = o.id), '[]'::jsonb),
             'events', coalesce((select jsonb_agg(jsonb_build_object('type', e.event_type, 'outcome', e.outcome,
                            'received_at', e.received_at) order by e.received_at)
                          from public.commerce_payment_events e where e.order_id = o.id), '[]'::jsonb)) as x
      from public.commerce_orders o order by o.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) y), '[]'::jsonb);
end;
$function$;

create or replace function public.admin_commerce_checkout_config()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  perform tempa_private.commerce_require_admin();
  return jsonb_build_object(
    'markets', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'market', market, 'currency', currency,
                           'enabled', enabled) order by provider, market, currency)
                         from public.commerce_provider_markets), '[]'::jsonb),
    'testers', coalesce((select jsonb_agg(jsonb_build_object('member', tempa_private.commerce_member_label(t.user_id),
                           'member_id', t.user_id, 'note', t.note, 'created_at', t.created_at) order by t.created_at)
                         from public.commerce_checkout_testers t), '[]'::jsonb),
    'unmatched_events', (select count(*) from public.commerce_payment_events where order_id is null),
    'needs_attention', (select count(*) from public.commerce_payment_attempts where reconciliation_state = 'needs_attention'));
end;
$function$;

-- ------------------------------------------------------------
-- 9. PRIVILEGES
-- ------------------------------------------------------------
revoke all on function tempa_private.commerce_checkout_gate(uuid, text) from public, anon, authenticated;
revoke all on function tempa_private.commerce_resolve_pack_price(uuid, text, text) from public, anon, authenticated;

revoke all on function public.commerce_credit_pack_offers() from public, anon;
grant execute on function public.commerce_credit_pack_offers() to authenticated;
revoke all on function public.commerce_my_order(text) from public, anon;
grant execute on function public.commerce_my_order(text) to authenticated;
revoke all on function public.commerce_member_context() from public, anon;
grant execute on function public.commerce_member_context() to authenticated;
revoke all on function public.commerce_create_credit_order(uuid, text, text) from public, anon;
grant execute on function public.commerce_create_credit_order(uuid, text, text) to authenticated;

-- Settlement: never a client. Only the server (service role) after it has
-- verified the transaction with the provider.
revoke all on function public.commerce_settle_payment(text, text, text, text, bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.commerce_settle_payment(text, text, text, text, bigint, text, text, text, text) to service_role;

revoke all on function public.admin_commerce_orders(integer) from public, anon;
grant execute on function public.admin_commerce_orders(integer) to authenticated;
revoke all on function public.admin_commerce_checkout_config() from public, anon;
grant execute on function public.admin_commerce_checkout_config() to authenticated;

commit;
