-- ============================================================
-- TEMPA — TRANSLATION FOUNDATION
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor.
-- ============================================================
--
-- Provider-independent persistence for Tempa's machine-translation layer.
-- The application currently uses Azure Translator F0, but no provider secret
-- or provider-specific payload is stored here.
--
-- PRIVACY BOUNDARY:
--   * translation_cache is for PUBLIC member content only.
--   * Private Letters, private Postcard backs and Reveal Lines MUST use the
--     uncached server path and MUST NEVER be inserted into this table.
--   * The cache is service-role only: no anon/authenticated policy or grant.
--   * source text itself is not stored. source_fingerprint is SHA-256, used to
--     make stale/incorrect content_version values fail closed instead of
--     returning a translation of different words.
--
-- COST BOUNDARY:
-- reserve_translation_characters atomically reserves source characters before
-- an outbound provider call. The Next.js service defaults to 1.8M/month and
-- refuses an env-configured ceiling above Azure F0's 2M/month allowance.
-- Reservations are deliberately conservative and are not refunded on provider
-- failure; that can stop translation early, never late.
--
-- Convention follows the existing Tempa SQL checkpoints: one transaction,
-- explicit revoke/grant, RLS even on service-only tables, SECURITY DEFINER with
-- pg_catalog search_path, fully-qualified object names.

begin;

-- ============================================================
-- 1. PUBLIC-CONTENT TRANSLATION CACHE
-- ============================================================

create table public.translation_cache (
  id uuid primary key default gen_random_uuid(),

  -- Generic source reference. content_id is text rather than uuid so this
  -- foundation can also support stable non-UUID public keys later without a
  -- schema rewrite. Integrations must use the real canonical source id.
  content_type text not null,
  content_id text not null,
  field_name text not null,
  content_version text not null,

  -- SHA-256 hex of the exact visible source text sent for translation.
  source_fingerprint text not null,
  source_language text not null default 'auto',
  target_language text not null,

  provider text not null,
  provider_version text not null,

  translated_text text not null,
  detected_language text,
  source_character_count integer not null,

  created_at timestamptz not null default now(),

  constraint translation_cache_content_type_not_blank
    check (char_length(trim(content_type)) between 1 and 40),
  constraint translation_cache_content_id_not_blank
    check (char_length(trim(content_id)) between 1 and 64),
  constraint translation_cache_field_name_not_blank
    check (char_length(trim(field_name)) between 1 and 40),
  constraint translation_cache_content_version_not_blank
    check (char_length(trim(content_version)) between 1 and 128),
  constraint translation_cache_source_fingerprint_sha256
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint translation_cache_source_language_not_blank
    check (char_length(trim(source_language)) between 1 and 32),
  constraint translation_cache_target_language_not_blank
    check (char_length(trim(target_language)) between 1 and 32),
  constraint translation_cache_provider_not_blank
    check (char_length(trim(provider)) between 1 and 40),
  constraint translation_cache_provider_version_not_blank
    check (char_length(trim(provider_version)) between 1 and 40),
  constraint translation_cache_source_character_count_positive
    check (source_character_count > 0)
);

create unique index translation_cache_lookup_unique
  on public.translation_cache (
    content_type,
    content_id,
    field_name,
    content_version,
    source_fingerprint,
    source_language,
    target_language,
    provider,
    provider_version
  );

-- Makes source deletion/invalidation cheap: integrations can remove every
-- derived translation for a source without knowing target/provider/version.
create index translation_cache_source_idx
  on public.translation_cache (content_type, content_id);

alter table public.translation_cache enable row level security;

revoke all on public.translation_cache from public, anon, authenticated;
grant select, insert, update, delete on public.translation_cache to service_role;
-- Deliberately no RLS policy. Only service_role accesses this table.


-- ============================================================
-- 2. MONTHLY CHARACTER RESERVATIONS
-- ============================================================

create table public.translation_usage_monthly (
  month_start date primary key,
  reserved_characters bigint not null default 0,
  updated_at timestamptz not null default now(),

  constraint translation_usage_month_start_is_first
    check (extract(day from month_start) = 1),
  constraint translation_usage_reserved_nonnegative
    check (reserved_characters >= 0)
);

alter table public.translation_usage_monthly enable row level security;

revoke all on public.translation_usage_monthly from public, anon, authenticated;
grant select on public.translation_usage_monthly to service_role;
-- Writes happen only through reserve_translation_characters below.


-- ============================================================
-- 3. ATOMIC GLOBAL FREE-TIER GUARD
-- ============================================================
-- Two simultaneous requests must not both read the same old total and then
-- independently decide that there is room. The row lock serializes reservation
-- decisions for the current UTC month.

create or replace function public.reserve_translation_characters(
  p_characters integer,
  p_limit bigint
)
returns table (
  allowed boolean,
  reserved_total bigint
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  v_month_start date := date_trunc('month', now() at time zone 'UTC')::date;
  v_current bigint;
begin
  if p_characters is null or p_characters <= 0 then
    raise exception 'p_characters must be positive.';
  end if;

  if p_limit is null or p_limit <= 0 then
    raise exception 'p_limit must be positive.';
  end if;

  insert into public.translation_usage_monthly (month_start, reserved_characters)
  values (v_month_start, 0)
  on conflict (month_start) do nothing;

  select u.reserved_characters
    into v_current
    from public.translation_usage_monthly u
    where u.month_start = v_month_start
    for update;

  if v_current > p_limit - p_characters then
    return query select false, v_current;
    return;
  end if;

  update public.translation_usage_monthly
     set reserved_characters = reserved_characters + p_characters,
         updated_at = now()
   where month_start = v_month_start
   returning translation_usage_monthly.reserved_characters into v_current;

  return query select true, v_current;
end;
$$;

revoke all on function public.reserve_translation_characters(integer, bigint) from public;
grant execute on function public.reserve_translation_characters(integer, bigint) to service_role;

commit;
