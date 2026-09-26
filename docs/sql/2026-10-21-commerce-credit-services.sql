-- ============================================================
-- TEMPA — COMMERCE CREDIT SERVICES (Checkpoint 2): server-authoritative
-- Credit reads, price resolution, durable-product and bundle purchases,
-- the Gift purchase primitive, audited admin Credit operations, and
-- premium Postcard ownership enforcement at the snapshot tables.
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- then run 2026-10-21-commerce-credit-services-verify.sql (read-only;
-- overall_pass must be true).
-- Forward-only. Builds on 2026-10-20-commerce-core.sql (applied); edits no
-- applied migration. Redefines exactly one existing function,
-- tempa_private.commerce_bundle_items_guard (durable-only bundles). Does
-- NOT rewrite write_letter, reply_to_letter, publish_dispatch or
-- publish_official_dispatch: premium ownership is enforced by BEFORE
-- triggers on the Postcard snapshot tables they already write.
-- Enables NOTHING: every commerce_settings switch stays OFF and every
-- payment provider stays disabled, so every spend path below refuses.
-- ============================================================
--
-- MEMBER ELIGIBILITY reuses the canonical rules: the caller's state is
-- public.current_account_status() (closure -> 'banned', open deactivation
-- -> 'suspended', else account_enforcement_state). Spending requires
-- 'active'. A commerce refusal is a COMMERCE-ONLY consequence: nothing here
-- is read by letters, discovery, introductions or any correspondence gate.
--
-- RESULTS: member RPCs return jsonb {"status": ...}. Refusals raise
-- 'COMMERCE:<code>' (whole transaction rolled back); the app maps codes to
-- member copy. The caller never supplies a price, balance or entitlement.
--
-- SERIALISATION: every spend first locks the member's wallet row, THEN
-- checks idempotency, ownership and balance — so concurrent requests for
-- one member run one at a time and a retried request always sees the
-- committed original.

begin;

-- ------------------------------------------------------------
-- 0. BUNDLES CONTAIN DURABLE ENTITLEMENTS ONLY (correction)
-- ------------------------------------------------------------
-- A Gift (gift_instance) is a relationship object, never something a
-- member "already owns" for completion pricing; Credit packs, bundles,
-- physical products and non-entitlement templates are not ownable items.
create or replace function tempa_private.commerce_bundle_items_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
declare
  v_version uuid := case when tg_op = 'DELETE' then old.bundle_version_id else new.bundle_version_id end;
  v_state text;
  v_bundle uuid;
begin
  select state, bundle_product_id into v_state, v_bundle from public.commerce_bundle_versions where id = v_version;
  if v_state is distinct from 'draft' then
    perform tempa_private.commerce_raise_frozen('A published bundle version''s items');
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.item_product_id = v_bundle or not exists (
      select 1 from public.commerce_products p
      where p.id = new.item_product_id and p.entitlement_model = 'durable'
    ) then
      raise exception 'A bundle may only contain durable products (for example premium Postcards).' using errcode = '22023';
    end if;
    return new;
  end if;
  return old;
end;
$function$;

-- ------------------------------------------------------------
-- 1. INTERNAL HELPERS
-- ------------------------------------------------------------
create or replace function tempa_private.commerce_raise(p_code text)
returns void
language plpgsql
set search_path to 'pg_catalog'
as $function$
begin
  raise exception 'COMMERCE:%', p_code using errcode = 'P0001';
end;
$function$;

-- The caller may spend only when commerce and Credit spending are ON and
-- their canonical account status is 'active'.
create or replace function tempa_private.commerce_require_spender(p_gift boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  v_settings public.commerce_settings;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if public.current_account_status() is distinct from 'active' then
    perform tempa_private.commerce_raise('account_unavailable');
  end if;
  select * into v_settings from public.commerce_settings where id;
  if not coalesce(v_settings.commerce_enabled and v_settings.credit_spend_enabled, false) then
    perform tempa_private.commerce_raise('commerce_disabled');
  end if;
  if p_gift and not coalesce(v_settings.gifts_enabled, false) then
    perform tempa_private.commerce_raise('gifts_disabled');
  end if;
  return v_uid;
end;
$function$;

-- Locks (creating if needed) the member's wallet row for this transaction
-- and returns the locked balance.
create or replace function tempa_private.commerce_lock_wallet(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_balance bigint;
begin
  insert into public.commerce_wallets (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select balance into v_balance from public.commerce_wallets where user_id = p_user_id for update;
  return v_balance;
end;
$function$;

create or replace function tempa_private.commerce_valid_key(p_key text)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog'
as $function$
begin
  if p_key is null or char_length(p_key) not between 8 and 200 or p_key !~ '^[A-Za-z0-9:_-]+$' then
    perform tempa_private.commerce_raise('invalid_request');
  end if;
  return p_key;
end;
$function$;

-- A product is on sale now: published and inside its publish window.
create or replace function tempa_private.commerce_product_on_sale(p public.commerce_products)
returns boolean
language sql
stable
set search_path to 'pg_catalog'
as $function$
  select p.lifecycle_state = 'published'
     and (p.publish_at is null or p.publish_at <= now())
     and (p.unpublish_at is null or p.unpublish_at > now())
$function$;

-- THE authoritative Credit price for a product right now. Fails closed
-- unless the product is a sellable, non-Complimentary Credit-priced product
-- with exactly one published price whose window contains now().
create or replace function tempa_private.commerce_resolve_credit_price(p_product_id uuid)
returns public.commerce_credit_prices
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_product public.commerce_products;
  v_price public.commerce_credit_prices;
  v_count integer;
begin
  select * into v_product from public.commerce_products where id = p_product_id;
  if not found or v_product.product_type not in ('postcard', 'gift', 'keepsake_template')
     or not tempa_private.commerce_product_on_sale(v_product) then
    perform tempa_private.commerce_raise('not_available');
  end if;
  if v_product.is_complimentary then
    perform tempa_private.commerce_raise('complimentary');
  end if;
  if v_product.product_type = 'postcard' and not exists (
    select 1 from public.postcard_catalog c where c.key = v_product.postcard_key and c.is_active
  ) then
    perform tempa_private.commerce_raise('not_available');
  end if;

  select count(*) into v_count from public.commerce_credit_prices cp
  where cp.product_id = p_product_id and cp.state = 'published'
    and cp.effective_from <= now() and (cp.effective_to is null or cp.effective_to > now());
  if v_count <> 1 then
    perform tempa_private.commerce_raise('price_unavailable');
  end if;
  select * into v_price from public.commerce_credit_prices cp
  where cp.product_id = p_product_id and cp.state = 'published'
    and cp.effective_from <= now() and (cp.effective_to is null or cp.effective_to > now());
  return v_price;
end;
$function$;

create or replace function tempa_private.commerce_owns(p_user_id uuid, p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select exists (
    select 1 from public.commerce_entitlements e
    where e.user_id = p_user_id and e.product_id = p_product_id and e.state = 'active'
  )
$function$;

-- Result of an already-recorded purchase (idempotent replay).
create or replace function tempa_private.commerce_purchase_result(p_purchase public.commerce_purchases, p_replayed boolean)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select jsonb_build_object(
    'status', 'completed',
    'replayed', p_replayed,
    'purchase_id', p_purchase.id,
    'product_id', p_purchase.product_id,
    'credits_charged', p_purchase.credits_charged,
    'balance', (select balance from public.commerce_wallets where user_id = p_purchase.user_id),
    'gift_id', (select g.id from public.commerce_gift_instances g where g.purchase_id = p_purchase.id)
  )
$function$;

-- ------------------------------------------------------------
-- 2. BALANCE, HISTORY, OWNERSHIP, OFFERS (member reads)
-- ------------------------------------------------------------
-- Balance: 0 for a member with no wallet yet. Never browser-authoritative.
create or replace function public.commerce_my_credit_balance()
returns bigint
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  return coalesce((select balance from public.commerce_wallets where user_id = auth.uid()), 0);
end;
$function$;

-- History: own entries only, newest first, keyset-paginated (pass the last
-- row's occurred_at + id to get the next page). Member-facing categories;
-- never the admin reason, actor, provider data or idempotency keys.
create or replace function public.commerce_my_credit_history(
  p_limit integer default 20,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  occurred_at timestamptz,
  category text,
  credits bigint,
  balance_after bigint,
  item_title text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  return query
  select
    l.id,
    l.created_at,
    case l.entry_type
      when 'credit_purchase' then 'bought'
      when 'product_spend' then 'spent'
      when 'bundle_spend' then 'spent'
      when 'gift_spend' then 'spent_on_gift'
      when 'product_credit_refund' then 'returned'
      when 'purchase_refund_removal' then 'removed_after_refund'
      when 'chargeback_removal' then 'removed_after_dispute'
      when 'chargeback_restoration' then 'restored_after_dispute'
      when 'promotional_grant' then 'from_tempa'
      when 'complimentary_grant' then 'from_tempa'
      when 'opening_balance' then 'from_tempa'
      else 'adjustment'
    end,
    l.delta,
    l.balance_after,
    case when l.source_type = 'purchase' then (select p.product_title_snapshot from public.commerce_purchases p where p.id = l.source_id)
         when l.source_type = 'order' then (select o.product_title_snapshot from public.commerce_orders o where o.id = l.source_id)
    end
  from public.commerce_ledger_entries l
  where l.user_id = auth.uid()
    and (p_before_at is null or (l.created_at, l.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by l.created_at desc, l.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$function$;

-- Ownership ("restore" = re-read the server record): active entitlements
-- only. Revoked entitlements never count; a product leaving sale does not
-- remove an owner's entitlement.
create or replace function public.commerce_my_entitlements()
returns table (
  product_id uuid,
  product_type text,
  title text,
  postcard_key text,
  source_type text,
  granted_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  return query
  select e.product_id, p.product_type, p.title, p.postcard_key, e.source_type, e.granted_at
  from public.commerce_entitlements e
  join public.commerce_products p on p.id = e.product_id
  where e.user_id = auth.uid() and e.state = 'active'
  order by e.granted_at desc;
end;
$function$;

-- What the member would pay for one product right now (display only; a
-- purchase re-resolves the price itself). Never raises for "not for sale".
create or replace function public.commerce_product_offer(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_price public.commerce_credit_prices;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if tempa_private.commerce_owns(auth.uid(), p_product_id) then
    return jsonb_build_object('status', 'owned', 'product_id', p_product_id);
  end if;
  begin
    v_price := tempa_private.commerce_resolve_credit_price(p_product_id);
  exception when others then
    if sqlerrm like 'COMMERCE:%' then
      return jsonb_build_object('status', 'unavailable', 'product_id', p_product_id, 'reason', substr(sqlerrm, 10));
    end if;
    raise;
  end;
  return jsonb_build_object('status', 'available', 'product_id', p_product_id, 'credits', v_price.credit_amount);
end;
$function$;

-- What a bundle would cost THIS member now: the sum of the current
-- version's allocations for items they do not own.
create or replace function tempa_private.commerce_bundle_quote(p_user_id uuid, p_bundle_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_product public.commerce_products;
  v_version public.commerce_bundle_versions;
  v_count integer;
  v_full bigint;
  v_completion bigint;
  v_missing integer;
begin
  select * into v_product from public.commerce_products where id = p_bundle_product_id;
  if not found or v_product.product_type <> 'bundle' or not tempa_private.commerce_product_on_sale(v_product) then
    perform tempa_private.commerce_raise('not_available');
  end if;
  select count(*) into v_count from public.commerce_bundle_versions v
  where v.bundle_product_id = p_bundle_product_id and v.state = 'published'
    and v.effective_from <= now() and (v.effective_to is null or v.effective_to > now());
  if v_count <> 1 then
    perform tempa_private.commerce_raise('price_unavailable');
  end if;
  select * into v_version from public.commerce_bundle_versions v
  where v.bundle_product_id = p_bundle_product_id and v.state = 'published'
    and v.effective_from <= now() and (v.effective_to is null or v.effective_to > now());
  if not exists (select 1 from public.commerce_bundle_version_items i where i.bundle_version_id = v_version.id)
     or exists (
       select 1 from public.commerce_bundle_version_items i join public.commerce_products p on p.id = i.item_product_id
       where i.bundle_version_id = v_version.id and p.entitlement_model <> 'durable'
     ) then
    perform tempa_private.commerce_raise('price_unavailable');
  end if;
  select coalesce(sum(i.allocation_credits), 0),
         coalesce(sum(i.allocation_credits) filter (where not tempa_private.commerce_owns(p_user_id, i.item_product_id)), 0),
         count(*) filter (where not tempa_private.commerce_owns(p_user_id, i.item_product_id))
    into v_full, v_completion, v_missing
  from public.commerce_bundle_version_items i where i.bundle_version_id = v_version.id;
  return jsonb_build_object('bundle_version_id', v_version.id, 'full_credits', v_full,
                            'completion_credits', v_completion, 'missing_items', v_missing);
end;
$function$;

create or replace function public.commerce_bundle_offer(p_bundle_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_quote jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  begin
    v_quote := tempa_private.commerce_bundle_quote(auth.uid(), p_bundle_product_id);
  exception when others then
    if sqlerrm like 'COMMERCE:%' then
      return jsonb_build_object('status', 'unavailable', 'product_id', p_bundle_product_id, 'reason', substr(sqlerrm, 10));
    end if;
    raise;
  end;
  return jsonb_build_object(
    'status', case when (v_quote->>'missing_items')::integer = 0 then 'all_owned' else 'available' end,
    'product_id', p_bundle_product_id,
    'credits', (v_quote->>'completion_credits')::bigint,
    'full_credits', (v_quote->>'full_credits')::bigint);
end;
$function$;

-- ------------------------------------------------------------
-- 3. PURCHASE A DURABLE PRODUCT (premium Postcard, durable Keepsake)
-- ------------------------------------------------------------
create or replace function public.commerce_purchase_product(p_product_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid;
  v_key text := tempa_private.commerce_valid_key(p_idempotency_key);
  v_balance bigint;
  v_existing public.commerce_purchases;
  v_product public.commerce_products;
  v_price public.commerce_credit_prices;
  v_purchase_id uuid := gen_random_uuid();
  v_entry public.commerce_ledger_entries;
  v_purchase public.commerce_purchases;
begin
  v_uid := tempa_private.commerce_require_spender();
  v_balance := tempa_private.commerce_lock_wallet(v_uid);

  select * into v_existing from public.commerce_purchases where user_id = v_uid and idempotency_key = v_key;
  if found then
    if v_existing.product_id <> p_product_id or v_existing.product_type_snapshot = 'bundle'
       or v_existing.product_type_snapshot = 'gift' then
      perform tempa_private.commerce_raise('idempotency_conflict');
    end if;
    return tempa_private.commerce_purchase_result(v_existing, true);
  end if;

  select * into v_product from public.commerce_products where id = p_product_id for share;
  if not found or v_product.entitlement_model <> 'durable' then
    perform tempa_private.commerce_raise('not_available');
  end if;
  if v_product.is_complimentary then
    perform tempa_private.commerce_raise('complimentary');
  end if;
  if tempa_private.commerce_owns(v_uid, p_product_id) then
    return jsonb_build_object('status', 'already_owned', 'product_id', p_product_id, 'credits_charged', 0,
                              'balance', v_balance);
  end if;
  v_price := tempa_private.commerce_resolve_credit_price(p_product_id);
  if v_balance < v_price.credit_amount then
    perform tempa_private.commerce_raise('insufficient_credits');
  end if;

  v_entry := tempa_private.commerce_append_ledger(
    v_uid, -v_price.credit_amount, 'product_spend', 'purchase', v_purchase_id, 'purchase:' || v_purchase_id::text);
  insert into public.commerce_purchases (
    id, user_id, product_id, product_type_snapshot, product_title_snapshot, credit_price_id,
    credits_charged, ledger_entry_id, idempotency_key
  ) values (
    v_purchase_id, v_uid, p_product_id, v_product.product_type, v_product.title, v_price.id,
    v_price.credit_amount, v_entry.id, v_key
  ) returning * into v_purchase;
  insert into public.commerce_purchase_items (purchase_id, product_id, product_title_snapshot, credit_value_snapshot, already_owned)
  values (v_purchase_id, p_product_id, v_product.title, v_price.credit_amount, false);
  insert into public.commerce_entitlements (user_id, product_id, source_type, source_id)
  values (v_uid, p_product_id, 'purchase', v_purchase_id);

  return tempa_private.commerce_purchase_result(v_purchase, false);
end;
$function$;

-- ------------------------------------------------------------
-- 4. PURCHASE A BUNDLE (fixed version allocations; completion pricing)
-- ------------------------------------------------------------
create or replace function public.commerce_purchase_bundle(p_bundle_product_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid;
  v_key text := tempa_private.commerce_valid_key(p_idempotency_key);
  v_balance bigint;
  v_existing public.commerce_purchases;
  v_product public.commerce_products;
  v_quote jsonb;
  v_version_id uuid;
  v_charge bigint;
  v_purchase_id uuid := gen_random_uuid();
  v_entry public.commerce_ledger_entries;
  v_purchase public.commerce_purchases;
begin
  v_uid := tempa_private.commerce_require_spender();
  v_balance := tempa_private.commerce_lock_wallet(v_uid);

  select * into v_existing from public.commerce_purchases where user_id = v_uid and idempotency_key = v_key;
  if found then
    if v_existing.product_id <> p_bundle_product_id or v_existing.product_type_snapshot <> 'bundle' then
      perform tempa_private.commerce_raise('idempotency_conflict');
    end if;
    return tempa_private.commerce_purchase_result(v_existing, true);
  end if;

  select * into v_product from public.commerce_products where id = p_bundle_product_id for share;
  v_quote := tempa_private.commerce_bundle_quote(v_uid, p_bundle_product_id);
  v_version_id := (v_quote->>'bundle_version_id')::uuid;
  v_charge := (v_quote->>'completion_credits')::bigint;
  if (v_quote->>'missing_items')::integer = 0 then
    return jsonb_build_object('status', 'all_owned', 'product_id', p_bundle_product_id, 'credits_charged', 0,
                              'balance', v_balance);
  end if;
  if v_balance < v_charge then
    perform tempa_private.commerce_raise('insufficient_credits');
  end if;

  v_entry := tempa_private.commerce_append_ledger(
    v_uid, -v_charge, 'bundle_spend', 'purchase', v_purchase_id, 'purchase:' || v_purchase_id::text);
  insert into public.commerce_purchases (
    id, user_id, product_id, product_type_snapshot, product_title_snapshot, bundle_version_id,
    credits_charged, ledger_entry_id, idempotency_key
  ) values (
    v_purchase_id, v_uid, p_bundle_product_id, 'bundle', v_product.title, v_version_id,
    v_charge, v_entry.id, v_key
  ) returning * into v_purchase;
  insert into public.commerce_purchase_items (purchase_id, product_id, product_title_snapshot, credit_value_snapshot, already_owned)
  select v_purchase_id, i.item_product_id, p.title, i.allocation_credits, tempa_private.commerce_owns(v_uid, i.item_product_id)
  from public.commerce_bundle_version_items i
  join public.commerce_products p on p.id = i.item_product_id
  where i.bundle_version_id = v_version_id;
  insert into public.commerce_entitlements (user_id, product_id, source_type, source_id)
  select v_uid, pi.product_id, 'bundle', v_purchase_id
  from public.commerce_purchase_items pi
  where pi.purchase_id = v_purchase_id and not pi.already_owned;

  return tempa_private.commerce_purchase_result(v_purchase, false);
end;
$function$;

-- ------------------------------------------------------------
-- 5. GIFT PURCHASE PRIMITIVE (backend only; no dedication yet)
-- ------------------------------------------------------------
-- Creates ONE pending Gift instance inside an established correspondence
-- and charges the sender once. The recipient gains no entitlement; the Gift
-- stays invisible to them until delivery (Checkpoint 7). A dedication is
-- member-written content and arrives with Safety wiring in Checkpoint 7.
create or replace function public.commerce_purchase_gift(
  p_gift_product_id uuid,
  p_correspondence_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid;
  v_key text := tempa_private.commerce_valid_key(p_idempotency_key);
  v_balance bigint;
  v_existing public.commerce_purchases;
  v_product public.commerce_products;
  v_version_id uuid;
  v_corr public.correspondences;
  v_recipient uuid;
  v_price public.commerce_credit_prices;
  v_charge bigint := 0;
  v_pseudonym text;
  v_purchase_id uuid := gen_random_uuid();
  v_entry public.commerce_ledger_entries;
  v_purchase public.commerce_purchases;
begin
  v_uid := tempa_private.commerce_require_spender(true);
  v_balance := tempa_private.commerce_lock_wallet(v_uid);

  select * into v_existing from public.commerce_purchases where user_id = v_uid and idempotency_key = v_key;
  if found then
    if v_existing.product_id <> p_gift_product_id or v_existing.product_type_snapshot <> 'gift' or not exists (
      select 1 from public.commerce_gift_instances g where g.purchase_id = v_existing.id and g.correspondence_id = p_correspondence_id
    ) then
      perform tempa_private.commerce_raise('idempotency_conflict');
    end if;
    return tempa_private.commerce_purchase_result(v_existing, true);
  end if;

  select * into v_product from public.commerce_products where id = p_gift_product_id for share;
  if not found or v_product.product_type <> 'gift' or v_product.entitlement_model <> 'gift_instance'
     or not tempa_private.commerce_product_on_sale(v_product) then
    perform tempa_private.commerce_raise('not_available');
  end if;
  select id into v_version_id from public.commerce_product_versions where product_id = p_gift_product_id and is_current;
  if v_version_id is null then
    perform tempa_private.commerce_raise('not_available');
  end if;

  -- An established correspondence between two members who are not blocked.
  select * into v_corr from public.correspondences where id = p_correspondence_id;
  if not found or v_uid not in (v_corr.participant_low, v_corr.participant_high)
     or v_corr.status <> 'active' or v_corr.established_at is null then
    perform tempa_private.commerce_raise('correspondence_unavailable');
  end if;
  v_recipient := case when v_uid = v_corr.participant_low then v_corr.participant_high else v_corr.participant_low end;
  if v_recipient = v_uid or tempa_private.is_correspondence_blocked_pair(v_uid, v_recipient) then
    perform tempa_private.commerce_raise('correspondence_unavailable');
  end if;
  -- The recipient must be a current member who accepts Gifts.
  if exists (select 1 from public.account_closures c where c.user_id = v_recipient)
     or exists (select 1 from public.account_deactivations d where d.user_id = v_recipient and d.reactivated_at is null)
     or coalesce((select s.status from public.account_enforcement_state s where s.user_id = v_recipient), 'active') <> 'active'
     or not coalesce((select gp.gifts_enabled from public.commerce_gift_preferences gp where gp.user_id = v_recipient), true) then
    perform tempa_private.commerce_raise('recipient_unavailable');
  end if;

  if not v_product.is_complimentary then
    v_price := tempa_private.commerce_resolve_credit_price(p_gift_product_id);
    v_charge := v_price.credit_amount;
  end if;
  if v_balance < v_charge then
    perform tempa_private.commerce_raise('insufficient_credits');
  end if;
  select pseudonym into v_pseudonym from public.profiles where id = v_uid;
  if v_pseudonym is null then
    perform tempa_private.commerce_raise('account_unavailable');
  end if;

  if v_charge > 0 then
    v_entry := tempa_private.commerce_append_ledger(
      v_uid, -v_charge, 'gift_spend', 'purchase', v_purchase_id, 'purchase:' || v_purchase_id::text);
  end if;
  insert into public.commerce_purchases (
    id, user_id, product_id, product_type_snapshot, product_title_snapshot, credit_price_id,
    credits_charged, ledger_entry_id, idempotency_key
  ) values (
    v_purchase_id, v_uid, p_gift_product_id, 'gift', v_product.title, v_price.id,
    v_charge, v_entry.id, v_key
  ) returning * into v_purchase;
  insert into public.commerce_purchase_items (purchase_id, product_id, product_title_snapshot, credit_value_snapshot, already_owned)
  values (v_purchase_id, p_gift_product_id, v_product.title, v_charge, false);
  insert into public.commerce_gift_instances (
    product_id, product_version_id, sender_id, recipient_id, correspondence_id, purchase_id, sender_pseudonym_snapshot
  ) values (
    p_gift_product_id, v_version_id, v_uid, v_recipient, p_correspondence_id, v_purchase_id, v_pseudonym
  );

  return tempa_private.commerce_purchase_result(v_purchase, false);
end;
$function$;

-- ------------------------------------------------------------
-- 6. AUDITED ADMIN CREDIT OPERATIONS (admin role only)
-- ------------------------------------------------------------
-- Grants and corrections go through the ledger helper and leave an
-- admin_audit_log row. They never touch refund/chargeback accounting
-- (Checkpoint 6 has dedicated operations for those), never link to an
-- order/purchase/payment, and never take a balance below zero.
create or replace function tempa_private.commerce_admin_credit_op(
  p_user_id uuid,
  p_delta bigint,
  p_entry_type text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_actor uuid := auth.uid();
  v_reason text := trim(both from coalesce(p_reason, ''));
  v_key text := 'admin:' || tempa_private.commerce_valid_key(p_idempotency_key);
  v_replay boolean;
  v_balance bigint;
  v_entry public.commerce_ledger_entries;
begin
  if v_actor is null or not public.is_staff('admin') then
    raise exception 'COMMERCE:not_authorized' using errcode = '42501';
  end if;
  if not coalesce((select commerce_enabled from public.commerce_settings where id), false) then
    perform tempa_private.commerce_raise('commerce_disabled');
  end if;
  if char_length(v_reason) not between 1 and 500 then
    perform tempa_private.commerce_raise('reason_required');
  end if;
  if v_reason ~* '(refund|chargeback|charge-back|dispute)' then
    perform tempa_private.commerce_raise('use_refund_operation');
  end if;
  if p_delta is null or p_delta = 0 or (p_entry_type <> 'admin_adjustment' and p_delta < 0) then
    perform tempa_private.commerce_raise('invalid_request');
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    perform tempa_private.commerce_raise('member_unavailable');
  end if;
  if p_entry_type <> 'admin_adjustment' and exists (select 1 from public.account_closures c where c.user_id = p_user_id) then
    perform tempa_private.commerce_raise('member_unavailable');
  end if;

  v_balance := tempa_private.commerce_lock_wallet(p_user_id);
  v_replay := exists (select 1 from public.commerce_ledger_entries where idempotency_key = v_key);
  if not v_replay and v_balance + p_delta < 0 then
    perform tempa_private.commerce_raise('adjustment_below_zero');
  end if;
  v_entry := tempa_private.commerce_append_ledger(p_user_id, p_delta, p_entry_type, 'admin', null, v_key, v_reason, v_actor);

  if not v_replay then
    insert into public.admin_audit_log (
      actor_id, actor_identifier_snapshot, action, target_type, target_id, target_identifier_snapshot, reason, metadata
    ) values (
      v_actor,
      coalesce((select pseudonym from public.profiles where id = v_actor), v_actor::text),
      case when p_entry_type = 'admin_adjustment' then 'commerce_credit_adjustment' else 'commerce_credit_grant' end,
      'commerce_wallet', p_user_id,
      coalesce((select pseudonym from public.profiles where id = p_user_id), p_user_id::text),
      v_reason,
      jsonb_build_object('entry_type', p_entry_type, 'delta', v_entry.delta, 'balance_after', v_entry.balance_after,
                         'ledger_entry_id', v_entry.id)
    );
  end if;

  return jsonb_build_object('status', 'completed', 'replayed', v_replay, 'ledger_entry_id', v_entry.id,
                            'delta', v_entry.delta, 'balance', v_entry.balance_after);
end;
$function$;

create or replace function public.admin_grant_credits(
  p_user_id uuid,
  p_amount bigint,
  p_kind text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if p_kind not in ('promotional_grant', 'complimentary_grant') then
    perform tempa_private.commerce_raise('invalid_request');
  end if;
  return tempa_private.commerce_admin_credit_op(p_user_id, p_amount, p_kind, p_reason, p_idempotency_key);
end;
$function$;

create or replace function public.admin_adjust_credits(
  p_user_id uuid,
  p_delta bigint,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  return tempa_private.commerce_admin_credit_op(p_user_id, p_delta, 'admin_adjustment', p_reason, p_idempotency_key);
end;
$function$;

-- ------------------------------------------------------------
-- 7. PREMIUM POSTCARD SEND ENFORCEMENT (additive DB boundary)
-- ------------------------------------------------------------
-- Before a Postcard snapshot row is written, the member responsible is
-- read from the parent Letter (sender_id) or Dispatch (author_id) — never
-- from auth.uid() — and a premium Postcard requires that member's ACTIVE
-- entitlement. Complimentary Postcards pass exactly as before. The
-- existing postcard_catalog.is_active gate in the RPCs is unchanged.
-- Received Keepsakes and revoked entitlements never count; a product
-- leaving sale never removes an owner's right. No staff bypass. Already
-- written rows are never touched (INSERT, and UPDATE of the artwork only).
create or replace function tempa_private.commerce_postcard_send_allowed(p_member uuid, p_postcard_key text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select coalesce((
    select p.is_complimentary or tempa_private.commerce_owns(p_member, p.id)
    from public.commerce_products p
    where p.postcard_key = p_postcard_key and p.product_type = 'postcard'
  ), false)
$function$;

create or replace function tempa_private.commerce_enforce_postcard_ownership()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_member uuid;
  v_key text;
begin
  if tg_op = 'UPDATE' and new.postcard_version_id is not distinct from old.postcard_version_id then
    return new;
  end if;
  if tg_table_name = 'letter_postcards' then
    select l.sender_id into v_member from public.letters l where l.id = new.letter_id;
  else
    select d.author_id into v_member from public.dispatches d where d.id = new.dispatch_id;
  end if;
  select v.postcard_key into v_key from public.postcard_versions v where v.id = new.postcard_version_id;
  if v_member is null or v_key is null or not tempa_private.commerce_postcard_send_allowed(v_member, v_key) then
    raise exception 'This Postcard is not in your collection.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists letter_postcards_commerce_ownership on public.letter_postcards;
create trigger letter_postcards_commerce_ownership
  before insert or update of postcard_version_id on public.letter_postcards
  for each row execute function tempa_private.commerce_enforce_postcard_ownership();
drop trigger if exists dispatch_postcards_commerce_ownership on public.dispatch_postcards;
create trigger dispatch_postcards_commerce_ownership
  before insert or update of postcard_version_id on public.dispatch_postcards
  for each row execute function tempa_private.commerce_enforce_postcard_ownership();

-- ------------------------------------------------------------
-- 8. PRIVILEGES
-- ------------------------------------------------------------
-- Ledger rows carry admin reasons, actors, source ids and idempotency
-- keys: members read their history only through commerce_my_credit_history.
revoke select on public.commerce_ledger_entries from authenticated;

revoke all on function tempa_private.commerce_raise(text) from public, anon, authenticated;
revoke all on function tempa_private.commerce_require_spender(boolean) from public, anon, authenticated;
revoke all on function tempa_private.commerce_lock_wallet(uuid) from public, anon, authenticated;
revoke all on function tempa_private.commerce_valid_key(text) from public, anon, authenticated;
revoke all on function tempa_private.commerce_product_on_sale(public.commerce_products) from public, anon, authenticated;
revoke all on function tempa_private.commerce_resolve_credit_price(uuid) from public, anon, authenticated;
revoke all on function tempa_private.commerce_owns(uuid, uuid) from public, anon, authenticated;
revoke all on function tempa_private.commerce_purchase_result(public.commerce_purchases, boolean) from public, anon, authenticated;
revoke all on function tempa_private.commerce_bundle_quote(uuid, uuid) from public, anon, authenticated;
revoke all on function tempa_private.commerce_admin_credit_op(uuid, bigint, text, text, text) from public, anon, authenticated;
revoke all on function tempa_private.commerce_postcard_send_allowed(uuid, text) from public, anon, authenticated;
revoke all on function tempa_private.commerce_enforce_postcard_ownership() from public, anon, authenticated;
revoke all on function tempa_private.commerce_bundle_items_guard() from public, anon, authenticated;

do $grants$
declare
  f text;
begin
  foreach f in array array[
    'public.commerce_my_credit_balance()',
    'public.commerce_my_credit_history(integer, timestamptz, uuid)',
    'public.commerce_my_entitlements()',
    'public.commerce_product_offer(uuid)',
    'public.commerce_bundle_offer(uuid)',
    'public.commerce_purchase_product(uuid, text)',
    'public.commerce_purchase_bundle(uuid, text)',
    'public.commerce_purchase_gift(uuid, uuid, text)',
    'public.admin_grant_credits(uuid, bigint, text, text, text)',
    'public.admin_adjust_credits(uuid, bigint, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$grants$;

commit;
