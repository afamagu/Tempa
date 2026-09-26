-- ============================================================
-- TEMPA — COMMERCE CORE (Checkpoint 1): catalogue, taxonomy, prices,
-- price books, Credits wallet + immutable ledger, purchases,
-- entitlements, bundles, Gift instances, fiat orders, payment attempts
-- and payment events.
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- then run 2026-10-20-commerce-core-verify.sql (read-only;
-- overall_pass must be true).
-- Forward-only and additive: creates new tables/functions/triggers only;
-- edits no historical migration and redefines no existing function.
-- Enables NO money movement: there is no purchase or checkout RPC yet
-- (Checkpoint 2 / 5), commerce_settings starts with every commercial
-- switch OFF, and no client role can write any commerce table.
-- ============================================================
--
-- GOVERNING RULE: monetize preservation and expression, never access to
-- people. Nothing here is read by People discovery, introductions,
-- Board ranking, Mail Call or any correspondence gate.
--
-- MONEY: Credits and fiat amounts are BIGINT integers (fiat in ISO 4217
-- minor units). No floating point anywhere. USD is the canonical base
-- currency: every fiat price row and order carries usd_reference_minor.
-- Local prices come from explicit, effective-dated price books — never
-- from a live exchange rate.
--
-- LEDGER: commerce_ledger_entries is append-only (a trigger rejects every
-- UPDATE/DELETE, for every role). The wallet balance is a transactional
-- cache maintained ONLY by tempa_private.commerce_append_ledger(), which
-- locks the wallet row, applies the signed delta, records balance_after
-- and honours an idempotency key. There is no "edit balance" primitive.
--
-- ACCOUNT LIFECYCLE: every member reference in commerce tables points at
-- auth.users (retained permanently on closure — see 2026-10-16) with NO
-- ON DELETE action, never at public.profiles (deleted on closure). So
-- close_my_account() never touches or is blocked by commerce rows, and
-- financial records survive closure for accounting/legal retention. Gift
-- instances survive a sender's closure; the recipient keeps them.
--
-- EXISTING POSTCARDS: every postcard_catalog row gets a Complimentary
-- 'postcard' product (published if active), and a trigger keeps new
-- Postcards covered. Sending behaviour is therefore unchanged. Premium
-- ownership enforcement is added in Checkpoint 2.

begin;

-- ------------------------------------------------------------
-- 0. SETTINGS (singleton; every commercial switch OFF)
-- ------------------------------------------------------------
create table if not exists public.commerce_settings (
  id boolean primary key default true check (id),
  commerce_enabled boolean not null default false,
  credit_spend_enabled boolean not null default false,
  fiat_checkout_enabled boolean not null default false,
  live_payments_enabled boolean not null default false,
  gifts_enabled boolean not null default false,
  home_shelf_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.commerce_settings (id) values (true) on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 1. CATALOGUE
-- ------------------------------------------------------------
create table if not exists public.commerce_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  product_type text not null check (product_type in ('postcard', 'gift', 'keepsake_template', 'credit_pack', 'bundle', 'physical')),
  title text not null check (char_length(trim(title)) between 1 and 140),
  short_description text check (short_description is null or char_length(short_description) <= 280),
  story_description text check (story_description is null or char_length(story_description) <= 4000),
  lifecycle_state text not null default 'draft' check (lifecycle_state in ('draft', 'scheduled', 'published', 'inactive', 'retired')),
  publish_at timestamptz,
  unpublish_at timestamptz,
  is_complimentary boolean not null default false,
  -- how owning/using it works: durable sending right, one-off given
  -- instance, Credits grant, bundle of durable rights, or nothing yet
  entitlement_model text not null check (entitlement_model in ('durable', 'gift_instance', 'credits', 'bundle', 'none')),
  postcard_key text unique references public.postcard_catalog(key),
  credit_amount bigint check (credit_amount is null or credit_amount > 0),
  preview_policy text not null default 'still_only' check (preview_policy in ('still_only', 'controlled_full', 'controlled_teaser', 'none')),
  rights_review_state text not null default 'not_required' check (rights_review_state in ('not_required', 'pending', 'approved', 'rejected')),
  rights_review_notes text check (rights_review_notes is null or char_length(rights_review_notes) <= 2000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_products_type_shape check (
    (product_type = 'postcard' and postcard_key is not null and entitlement_model = 'durable' and credit_amount is null)
    or (product_type = 'gift' and postcard_key is null and entitlement_model = 'gift_instance' and credit_amount is null)
    or (product_type = 'keepsake_template' and postcard_key is null and entitlement_model in ('gift_instance', 'durable', 'none') and credit_amount is null)
    or (product_type = 'credit_pack' and postcard_key is null and entitlement_model = 'credits' and credit_amount is not null and not is_complimentary)
    or (product_type = 'bundle' and postcard_key is null and entitlement_model = 'bundle' and credit_amount is null)
    or (product_type = 'physical' and postcard_key is null and entitlement_model = 'none' and credit_amount is null and not is_complimentary)
  ),
  constraint commerce_products_schedule_order check (unpublish_at is null or publish_at is null or unpublish_at > publish_at)
);
create index if not exists commerce_products_type_state_idx on public.commerce_products (product_type, lifecycle_state);

-- Versioned artwork for non-Postcard products (Postcards keep using the
-- frozen public.postcard_versions). A sent/received Gift snapshots one.
create table if not exists public.commerce_product_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.commerce_products(id),
  version_number integer not null check (version_number >= 1),
  title text not null check (char_length(trim(title)) between 1 and 140),
  image_path text not null check (char_length(image_path) between 1 and 512),
  thumbnail_path text check (thumbnail_path is null or char_length(thumbnail_path) <= 512),
  motion_path text check (motion_path is null or char_length(motion_path) <= 512),
  motion_duration_seconds numeric(6, 2) check (motion_duration_seconds is null or motion_duration_seconds > 0),
  is_current boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (product_id, version_number)
);
create unique index if not exists commerce_product_versions_one_current on public.commerce_product_versions (product_id) where is_current;

-- ------------------------------------------------------------
-- 2. TAXONOMY + COLLECTIONS (many-to-many; country is one facet)
-- ------------------------------------------------------------
create table if not exists public.commerce_taxonomy_terms (
  id uuid primary key default gen_random_uuid(),
  facet text not null check (facet in ('place', 'mood', 'occasion', 'world', 'story', 'tag')),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  label text not null check (char_length(trim(label)) between 1 and 80),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  aliases text[] not null default '{}',
  display_order integer not null default 0,
  state text not null default 'draft' check (state in ('draft', 'published', 'inactive')),
  created_at timestamptz not null default now(),
  unique (facet, slug)
);

create table if not exists public.commerce_product_terms (
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  term_id uuid not null references public.commerce_taxonomy_terms(id) on delete cascade,
  display_order integer not null default 0,
  primary key (product_id, term_id)
);
create index if not exists commerce_product_terms_term_idx on public.commerce_product_terms (term_id);

create table if not exists public.commerce_collections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  title text not null check (char_length(trim(title)) between 1 and 140),
  description text check (description is null or char_length(description) <= 2000),
  state text not null default 'draft' check (state in ('draft', 'scheduled', 'published', 'inactive')),
  publish_at timestamptz,
  is_featured boolean not null default false,
  display_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_collection_products (
  collection_id uuid not null references public.commerce_collections(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  display_order integer not null default 0,
  primary key (collection_id, product_id)
);
create index if not exists commerce_collection_products_product_idx on public.commerce_collection_products (product_id);

-- Current bundle membership (what a bundle grants TODAY). Purchases
-- snapshot their own items, so a later edit never changes history.
create table if not exists public.commerce_bundle_items (
  bundle_product_id uuid not null references public.commerce_products(id),
  item_product_id uuid not null references public.commerce_products(id),
  display_order integer not null default 0,
  primary key (bundle_product_id, item_product_id),
  check (bundle_product_id <> item_product_id)
);

-- ------------------------------------------------------------
-- 3. PRICES (effective-dated; never rewritten once used)
-- ------------------------------------------------------------
-- Credit price of a digital product. Complimentary products need none.
create table if not exists public.commerce_credit_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.commerce_products(id),
  credit_amount bigint not null check (credit_amount > 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  state text not null default 'draft' check (state in ('draft', 'published', 'retired')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index if not exists commerce_credit_prices_lookup_idx on public.commerce_credit_prices (product_id, state, effective_from desc);

-- Local fiat price of a Credit pack (or future fiat product).
create table if not exists public.commerce_price_books (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.commerce_products(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  usd_reference_minor bigint not null check (usd_reference_minor > 0),
  market_country_codes text[] check (market_country_codes is null or cardinality(market_country_codes) > 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  state text not null default 'draft' check (state in ('draft', 'published', 'retired')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  check (currency <> 'USD' or amount_minor = usd_reference_minor)
);
create index if not exists commerce_price_books_lookup_idx on public.commerce_price_books (product_id, currency, state, effective_from desc);

-- ------------------------------------------------------------
-- 4. CREDITS — wallet (cache) + append-only ledger (authority)
-- ------------------------------------------------------------
create table if not exists public.commerce_wallets (
  user_id uuid primary key references auth.users(id),
  balance bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  delta bigint not null check (delta <> 0),
  balance_after bigint not null,
  entry_type text not null check (entry_type in (
    'credit_purchase', 'promotional_grant', 'complimentary_grant', 'product_spend', 'bundle_spend',
    'gift_spend', 'refund_reversal', 'chargeback_reversal', 'admin_adjustment', 'opening_balance')),
  source_type text not null check (source_type in ('order', 'purchase', 'payment_adjustment', 'admin', 'migration')),
  source_id uuid,
  idempotency_key text unique check (idempotency_key is null or char_length(idempotency_key) between 8 and 200),
  reason text check (reason is null or char_length(reason) <= 500),
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint commerce_ledger_sign check (
    (entry_type in ('credit_purchase', 'promotional_grant', 'complimentary_grant', 'opening_balance') and delta > 0)
    or (entry_type in ('product_spend', 'bundle_spend', 'gift_spend', 'refund_reversal', 'chargeback_reversal') and delta < 0)
    or entry_type = 'admin_adjustment'
  ),
  constraint commerce_ledger_admin_reason check (
    entry_type not in ('admin_adjustment', 'promotional_grant', 'complimentary_grant') or (reason is not null and actor_id is not null)
  )
);
create index if not exists commerce_ledger_user_idx on public.commerce_ledger_entries (user_id, created_at desc);

create or replace function tempa_private.commerce_ledger_is_append_only()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
begin
  raise exception 'Commerce ledger entries are immutable; record a compensating entry instead.'
    using errcode = '42501';
end;
$function$;

drop trigger if exists commerce_ledger_append_only on public.commerce_ledger_entries;
create trigger commerce_ledger_append_only
  before update or delete on public.commerce_ledger_entries
  for each row execute function tempa_private.commerce_ledger_is_append_only();
drop trigger if exists commerce_ledger_no_truncate on public.commerce_ledger_entries;
create trigger commerce_ledger_no_truncate
  before truncate on public.commerce_ledger_entries
  for each statement execute function tempa_private.commerce_ledger_is_append_only();

-- The ONLY way Credits move. Server-side callers (SECURITY DEFINER RPCs
-- in later checkpoints) pass a signed delta. Locks the wallet row so
-- concurrent spends serialise; a reused idempotency key returns the
-- original entry without moving Credits again. p_allow_negative is only
-- for reversals (refund/chargeback) — spends can never overdraw.
create or replace function tempa_private.commerce_append_ledger(
  p_user_id uuid,
  p_delta bigint,
  p_entry_type text,
  p_source_type text,
  p_source_id uuid,
  p_idempotency_key text,
  p_reason text default null,
  p_actor_id uuid default null,
  p_allow_negative boolean default false
)
returns public.commerce_ledger_entries
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_existing public.commerce_ledger_entries;
  v_balance bigint;
  v_entry public.commerce_ledger_entries;
begin
  if p_user_id is null or p_delta is null or p_delta = 0 then
    raise exception 'A member and a non-zero amount are required.' using errcode = '22023';
  end if;

  insert into public.commerce_wallets (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select balance into v_balance from public.commerce_wallets where user_id = p_user_id for update;

  if p_idempotency_key is not null then
    select * into v_existing from public.commerce_ledger_entries where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.user_id <> p_user_id or v_existing.delta <> p_delta or v_existing.entry_type <> p_entry_type then
        raise exception 'Idempotency key reused for a different ledger movement.' using errcode = '22023';
      end if;
      return v_existing;
    end if;
  end if;

  if v_balance + p_delta < 0 and not p_allow_negative then
    raise exception 'Not enough Credits.' using errcode = 'P0001';
  end if;

  insert into public.commerce_ledger_entries (
    user_id, delta, balance_after, entry_type, source_type, source_id, idempotency_key, reason, actor_id
  ) values (
    p_user_id, p_delta, v_balance + p_delta, p_entry_type, p_source_type, p_source_id, p_idempotency_key, p_reason, p_actor_id
  )
  returning * into v_entry;

  update public.commerce_wallets set balance = v_entry.balance_after, updated_at = now() where user_id = p_user_id;
  return v_entry;
end;
$function$;

-- ------------------------------------------------------------
-- 5. PURCHASES (Credit spends) + ENTITLEMENTS
-- ------------------------------------------------------------
create table if not exists public.commerce_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  product_id uuid not null references public.commerce_products(id),
  product_type_snapshot text not null,
  product_title_snapshot text not null,
  credit_price_id uuid references public.commerce_credit_prices(id),
  credits_charged bigint not null check (credits_charged >= 0),
  ledger_entry_id uuid references public.commerce_ledger_entries(id),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  state text not null default 'completed' check (state in ('completed', 'reversed')),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check ((credits_charged = 0) = (ledger_entry_id is null))
);
create index if not exists commerce_purchases_user_idx on public.commerce_purchases (user_id, created_at desc);

-- What a purchase contained at the moment it was made (bundles: every
-- item, including ones already owned and therefore not re-granted).
create table if not exists public.commerce_purchase_items (
  purchase_id uuid not null references public.commerce_purchases(id),
  product_id uuid not null references public.commerce_products(id),
  product_title_snapshot text not null,
  credit_value_snapshot bigint not null check (credit_value_snapshot >= 0),
  already_owned boolean not null default false,
  primary key (purchase_id, product_id)
);

create table if not exists public.commerce_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  product_id uuid not null references public.commerce_products(id),
  source_type text not null check (source_type in ('purchase', 'bundle', 'promotional_grant', 'admin_grant')),
  source_id uuid,
  state text not null default 'active' check (state in ('active', 'revoked')),
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 500),
  revoked_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((state = 'revoked') = (revoked_at is not null and revoked_reason is not null))
);
create unique index if not exists commerce_entitlements_one_active on public.commerce_entitlements (user_id, product_id) where state = 'active';

-- ------------------------------------------------------------
-- 6. GIFT INSTANCES (a relationship object, never currency)
-- ------------------------------------------------------------
create table if not exists public.commerce_gift_instances (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.commerce_products(id),
  product_version_id uuid not null references public.commerce_product_versions(id),
  sender_id uuid not null references auth.users(id),
  recipient_id uuid not null references auth.users(id),
  correspondence_id uuid not null references public.correspondences(id),
  letter_id uuid references public.letters(id) on delete set null,
  purchase_id uuid references public.commerce_purchases(id),
  dedication text check (dedication is null or char_length(trim(dedication)) between 1 and 200),
  sender_pseudonym_snapshot text not null,
  state text not null default 'pending_delivery' check (state in ('pending_delivery', 'delivered', 'cancelled')),
  delivered_at timestamptz,
  cancelled_at timestamptz,
  recipient_removed_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id),
  check ((state = 'delivered') = (delivered_at is not null)),
  check ((state = 'cancelled') = (cancelled_at is not null))
);
create index if not exists commerce_gift_instances_recipient_idx on public.commerce_gift_instances (recipient_id, state);
create index if not exists commerce_gift_instances_sender_idx on public.commerce_gift_instances (sender_id);

create table if not exists public.commerce_gift_preferences (
  user_id uuid primary key references auth.users(id),
  gifts_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 7. FIAT ORDERS, PAYMENT ATTEMPTS, PROVIDER EVENTS, ADJUSTMENTS
-- ------------------------------------------------------------
create table if not exists public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  product_id uuid not null references public.commerce_products(id),
  product_title_snapshot text not null,
  price_book_id uuid not null references public.commerce_price_books(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  usd_reference_minor bigint not null check (usd_reference_minor > 0),
  credits_to_grant bigint not null check (credits_to_grant > 0),
  tempa_reference text not null unique check (char_length(tempa_reference) between 8 and 100),
  provider text not null check (provider in ('flutterwave')),
  state text not null default 'created' check (state in (
    'created', 'pending', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded', 'charged_back')),
  terms_version text,
  credit_ledger_entry_id uuid references public.commerce_ledger_entries(id),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists commerce_orders_user_idx on public.commerce_orders (user_id, created_at desc);
create index if not exists commerce_orders_open_idx on public.commerce_orders (state, created_at) where state in ('created', 'pending');

create table if not exists public.commerce_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id),
  provider text not null check (provider in ('flutterwave')),
  provider_reference text not null check (char_length(provider_reference) between 1 and 200),
  provider_transaction_id text check (provider_transaction_id is null or char_length(provider_transaction_id) <= 200),
  expected_amount_minor bigint not null check (expected_amount_minor > 0),
  expected_currency text not null check (expected_currency ~ '^[A-Z]{3}$'),
  provider_status text,
  verification_state text not null default 'unverified' check (verification_state in ('unverified', 'verified', 'mismatch', 'failed')),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  reconciliation_state text not null default 'open' check (reconciliation_state in ('open', 'settled', 'needs_attention')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference)
);
create unique index if not exists commerce_payment_attempts_provider_txn on public.commerce_payment_attempts (provider, provider_transaction_id) where provider_transaction_id is not null;

-- Webhook/event replay protection. Stores identity + a digest, never the
-- raw payload (card data must never land here).
create table if not exists public.commerce_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('flutterwave')),
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 200),
  event_type text not null check (char_length(event_type) <= 100),
  order_id uuid references public.commerce_orders(id),
  payload_sha256 text check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text check (outcome is null or outcome in ('applied', 'duplicate', 'ignored', 'rejected', 'error')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create table if not exists public.commerce_payment_adjustments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id),
  kind text not null check (kind in ('refund', 'chargeback', 'chargeback_won')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  usd_reference_minor bigint not null check (usd_reference_minor > 0),
  credits_reversed bigint not null default 0 check (credits_reversed >= 0),
  ledger_entry_id uuid references public.commerce_ledger_entries(id),
  provider_reference text not null check (char_length(provider_reference) between 1 and 200),
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (order_id, kind, provider_reference)
);

-- ------------------------------------------------------------
-- 8. PRIVILEGES — clients never write; members read only their own rows
-- ------------------------------------------------------------
do $grants$
declare
  t text;
begin
  foreach t in array array[
    'commerce_settings', 'commerce_products', 'commerce_product_versions', 'commerce_taxonomy_terms',
    'commerce_product_terms', 'commerce_collections', 'commerce_collection_products', 'commerce_bundle_items',
    'commerce_credit_prices', 'commerce_price_books', 'commerce_wallets', 'commerce_ledger_entries',
    'commerce_purchases', 'commerce_purchase_items', 'commerce_entitlements', 'commerce_gift_instances',
    'commerce_gift_preferences', 'commerce_orders', 'commerce_payment_attempts', 'commerce_payment_events',
    'commerce_payment_adjustments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end
$grants$;

-- Published catalogue is readable by signed-in members (never anon).
grant select on public.commerce_products, public.commerce_product_versions, public.commerce_taxonomy_terms,
  public.commerce_product_terms, public.commerce_collections, public.commerce_collection_products,
  public.commerce_bundle_items, public.commerce_credit_prices to authenticated;

drop policy if exists commerce_products_select_published on public.commerce_products;
create policy commerce_products_select_published on public.commerce_products for select to authenticated
  using (lifecycle_state = 'published' and (publish_at is null or publish_at <= now()) and (unpublish_at is null or unpublish_at > now()));
drop policy if exists commerce_product_versions_select_published on public.commerce_product_versions;
create policy commerce_product_versions_select_published on public.commerce_product_versions for select to authenticated
  using (exists (select 1 from public.commerce_products p where p.id = product_id));
drop policy if exists commerce_taxonomy_terms_select_published on public.commerce_taxonomy_terms;
create policy commerce_taxonomy_terms_select_published on public.commerce_taxonomy_terms for select to authenticated
  using (state = 'published');
drop policy if exists commerce_product_terms_select_visible on public.commerce_product_terms;
create policy commerce_product_terms_select_visible on public.commerce_product_terms for select to authenticated
  using (exists (select 1 from public.commerce_products p where p.id = product_id));
drop policy if exists commerce_collections_select_published on public.commerce_collections;
create policy commerce_collections_select_published on public.commerce_collections for select to authenticated
  using (state = 'published' and (publish_at is null or publish_at <= now()));
drop policy if exists commerce_collection_products_select_visible on public.commerce_collection_products;
create policy commerce_collection_products_select_visible on public.commerce_collection_products for select to authenticated
  using (exists (select 1 from public.commerce_collections c where c.id = collection_id)
         and exists (select 1 from public.commerce_products p where p.id = product_id));
drop policy if exists commerce_bundle_items_select_visible on public.commerce_bundle_items;
create policy commerce_bundle_items_select_visible on public.commerce_bundle_items for select to authenticated
  using (exists (select 1 from public.commerce_products p where p.id = bundle_product_id));
drop policy if exists commerce_credit_prices_select_published on public.commerce_credit_prices;
create policy commerce_credit_prices_select_published on public.commerce_credit_prices for select to authenticated
  using (state = 'published' and exists (select 1 from public.commerce_products p where p.id = product_id));

-- Own financial rows, read-only.
grant select on public.commerce_wallets, public.commerce_ledger_entries, public.commerce_purchases,
  public.commerce_purchase_items, public.commerce_entitlements, public.commerce_orders,
  public.commerce_gift_preferences, public.commerce_gift_instances to authenticated;

drop policy if exists commerce_wallets_select_own on public.commerce_wallets;
create policy commerce_wallets_select_own on public.commerce_wallets for select to authenticated using (user_id = auth.uid());
drop policy if exists commerce_ledger_select_own on public.commerce_ledger_entries;
create policy commerce_ledger_select_own on public.commerce_ledger_entries for select to authenticated using (user_id = auth.uid());
drop policy if exists commerce_purchases_select_own on public.commerce_purchases;
create policy commerce_purchases_select_own on public.commerce_purchases for select to authenticated using (user_id = auth.uid());
drop policy if exists commerce_purchase_items_select_own on public.commerce_purchase_items;
create policy commerce_purchase_items_select_own on public.commerce_purchase_items for select to authenticated
  using (exists (select 1 from public.commerce_purchases p where p.id = purchase_id and p.user_id = auth.uid()));
drop policy if exists commerce_entitlements_select_own on public.commerce_entitlements;
create policy commerce_entitlements_select_own on public.commerce_entitlements for select to authenticated using (user_id = auth.uid());
drop policy if exists commerce_orders_select_own on public.commerce_orders;
create policy commerce_orders_select_own on public.commerce_orders for select to authenticated using (user_id = auth.uid());
drop policy if exists commerce_gift_preferences_select_own on public.commerce_gift_preferences;
create policy commerce_gift_preferences_select_own on public.commerce_gift_preferences for select to authenticated using (user_id = auth.uid());
-- A Gift is visible to its sender, and to its recipient only once delivered.
drop policy if exists commerce_gift_instances_select_party on public.commerce_gift_instances;
create policy commerce_gift_instances_select_party on public.commerce_gift_instances for select to authenticated
  using (sender_id = auth.uid() or (recipient_id = auth.uid() and state = 'delivered'));

revoke all on function tempa_private.commerce_append_ledger(uuid, bigint, text, text, uuid, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function tempa_private.commerce_ledger_is_append_only() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 9. EXISTING POSTCARDS -> Complimentary products (sending unchanged)
-- ------------------------------------------------------------
create or replace function tempa_private.commerce_postcard_slug(p_key text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $function$
  select 'postcard-' || trim(both '-' from regexp_replace(lower(regexp_replace(p_key, '([a-z0-9])([A-Z])', '\1-\2', 'g')), '[^a-z0-9]+', '-', 'g'))
$function$;

insert into public.commerce_products (slug, product_type, title, lifecycle_state, is_complimentary, entitlement_model, postcard_key)
select tempa_private.commerce_postcard_slug(c.key), 'postcard', c.title,
       case when c.is_active then 'published' else 'inactive' end, true, 'durable', c.key
from public.postcard_catalog c
where not exists (select 1 from public.commerce_products p where p.postcard_key = c.key)
on conflict (slug) do nothing;

-- Two keys that normalise to the same slug: the second gets a stable suffix.
insert into public.commerce_products (slug, product_type, title, lifecycle_state, is_complimentary, entitlement_model, postcard_key)
select tempa_private.commerce_postcard_slug(c.key) || '-' || left(md5(c.key), 6), 'postcard', c.title,
       case when c.is_active then 'published' else 'inactive' end, true, 'durable', c.key
from public.postcard_catalog c
where not exists (select 1 from public.commerce_products p where p.postcard_key = c.key);

-- Existing country codes become Place facets (published, labelled by code
-- until an admin gives them a human name).
insert into public.commerce_taxonomy_terms (facet, slug, label, country_code, state)
select distinct 'place', lower(c.country_code), c.country_code, c.country_code, 'published'
from public.postcard_catalog c
where c.country_code ~ '^[A-Z]{2}$'
on conflict (facet, slug) do nothing;

insert into public.commerce_product_terms (product_id, term_id)
select p.id, t.id
from public.commerce_products p
join public.postcard_catalog c on c.key = p.postcard_key
join public.commerce_taxonomy_terms t on t.facet = 'place' and t.slug = lower(c.country_code)
on conflict do nothing;

-- New Postcards added through Admin stay covered: a Complimentary product
-- mirroring the Postcard's active state is created automatically (an
-- admin can later price it — Checkpoint 4). Sendability itself stays on
-- postcard_catalog.is_active; the product only governs sale/listing.
create or replace function tempa_private.commerce_postcard_product_for_new_catalog_row()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  insert into public.commerce_products (slug, product_type, title, lifecycle_state, is_complimentary, entitlement_model, postcard_key)
  values (tempa_private.commerce_postcard_slug(new.key), 'postcard', new.title,
          case when new.is_active then 'published' else 'inactive' end, true, 'durable', new.key)
  on conflict do nothing;
  if not exists (select 1 from public.commerce_products where postcard_key = new.key) then
    insert into public.commerce_products (slug, product_type, title, lifecycle_state, is_complimentary, entitlement_model, postcard_key)
    values (tempa_private.commerce_postcard_slug(new.key) || '-' || left(md5(new.key), 6), 'postcard', new.title,
            case when new.is_active then 'published' else 'inactive' end, true, 'durable', new.key);
  end if;
  return new;
end;
$function$;
revoke all on function tempa_private.commerce_postcard_product_for_new_catalog_row() from public, anon, authenticated;

drop trigger if exists postcard_catalog_commerce_product on public.postcard_catalog;
create trigger postcard_catalog_commerce_product
  after insert on public.postcard_catalog
  for each row execute function tempa_private.commerce_postcard_product_for_new_catalog_row();

commit;
