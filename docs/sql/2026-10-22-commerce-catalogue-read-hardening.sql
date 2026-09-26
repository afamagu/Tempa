-- ============================================================
-- TEMPA — COMMERCE CATALOGUE READ HARDENING (Checkpoint 3)
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- then run 2026-10-22-commerce-catalogue-read-hardening-verify.sql
-- (read-only; overall_pass must be true).
-- Forward-only, privileges + one read-only function. No table, row,
-- policy or setting changes; enables nothing.
-- ============================================================
--
-- WHY: Checkpoint 1 granted members table-wide SELECT on the catalogue.
-- RLS limits WHICH rows they see (published only), but not WHICH COLUMNS:
-- for any published product a member could read internal fields through
-- the API — rights_review_state / rights_review_notes, admin metadata,
-- created_by (an admin's user id) — and on their own purchases the
-- idempotency key and internal ledger/price links. The marketplace needs
-- none of those. This replaces the table-wide grants with column grants
-- limited to what a member-facing catalogue reads. RLS is unchanged.
--
-- The marketplace also needs to know, without spending, whether unlocking
-- with Credits is open. commerce_member_context() returns the caller's
-- balance and the member-facing switch states only (never who changed
-- them or when).
--
-- The app selects explicit columns everywhere, so it works identically
-- before and after this migration.

begin;

revoke select on public.commerce_products from authenticated;
grant select (id, slug, product_type, title, short_description, story_description, lifecycle_state, publish_at,
              unpublish_at, is_complimentary, entitlement_model, postcard_key, credit_amount, preview_policy)
  on public.commerce_products to authenticated;

revoke select on public.commerce_product_versions from authenticated;
grant select (id, product_id, version_number, title, image_path, thumbnail_path, motion_path, motion_duration_seconds,
              is_current)
  on public.commerce_product_versions to authenticated;

revoke select on public.commerce_credit_prices from authenticated;
grant select (id, product_id, credit_amount, effective_from, effective_to, state)
  on public.commerce_credit_prices to authenticated;

revoke select on public.commerce_collections from authenticated;
grant select (id, slug, title, description, state, publish_at, is_featured, display_order)
  on public.commerce_collections to authenticated;

revoke select on public.commerce_bundle_versions from authenticated;
grant select (id, bundle_product_id, version_number, state, effective_from, effective_to)
  on public.commerce_bundle_versions to authenticated;

revoke select on public.commerce_purchases from authenticated;
grant select (id, user_id, product_id, product_type_snapshot, product_title_snapshot, bundle_version_id,
              credits_charged, state, created_at)
  on public.commerce_purchases to authenticated;

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
    'balance', coalesce((select balance from public.commerce_wallets where user_id = auth.uid()), 0)
  );
end;
$function$;

revoke all on function public.commerce_member_context() from public, anon;
grant execute on function public.commerce_member_context() to authenticated;

commit;
