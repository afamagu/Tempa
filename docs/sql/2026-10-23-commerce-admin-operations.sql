-- ============================================================
-- TEMPA — COMMERCE ADMIN OPERATIONS (Checkpoint 4: Admin → Commerce)
-- STATUS: APPLIED TO PRODUCTION 2026-09-27. Verified with
-- 2026-10-23-commerce-admin-operations-verify.sql (read-only): one row,
-- every check true, overall_pass = true.
-- Do not edit: any change ships as a new forward-only migration.
-- Forward-only. Edits no applied migration and redefines no existing
-- function. Enables NOTHING: no commerce_settings or payment-provider
-- write exists anywhere in this file.
-- ============================================================
--
-- WHY SQL IS NEEDED: since 2026-10-22 members (and admins, who are also
-- `authenticated`) read only published rows and member-safe columns, and
-- no client role may write any commerce table. Admin → Commerce therefore
-- needs server-side operations: SECURITY DEFINER, `is_staff('admin')`
-- first (moderators refused — staff is not financial authority), every
-- material change recorded in admin_audit_log, no table-write grants.
--
-- Contents
--   0. Two small columns: internal cultural review (never granted to
--      members) and a member-readable display_order (e.g. Credit packs).
--   1. Helpers: admin gate, audit writer, slug, human-label rule,
--      product readiness checklist.
--   2. Admin reads (overview, catalogue, product detail, taxonomy,
--      collections, pricing, member Credits, entitlements, orders,
--      settings, commerce audit).
--   3. Catalogue: create product, update product, lifecycle (publish /
--      schedule / remove from sale / retire / draft) with readiness
--      enforced server-side, Gift/Keepsake versions.
--   4. Taxonomy + collections + merchandising order.
--   5. Pricing: Credit prices and fiat price books — draft, publish,
--      scheduled change, end, discard draft. Published amounts are never
--      edited (the 2026-10-20 guards stay the authority).
--   6. Bundles: draft versions, durable items + fixed allocations,
--      publish (freezes), retire.
--   7. Entitlements: explicit, reasoned, audited ADMIN GRANT (incl. the
--      official-use grant for official Dispatch artwork). No revoke and
--      no staff-wide bypass.
-- Credits reuse admin_grant_credits / admin_adjust_credits (2026-10-21).

begin;

-- ------------------------------------------------------------
-- 0. COLUMNS
-- ------------------------------------------------------------
alter table public.commerce_products
  add column if not exists cultural_review_state text not null default 'not_required'
    check (cultural_review_state in ('not_required', 'pending', 'approved', 'hold', 'rejected')),
  add column if not exists cultural_review_notes text
    check (cultural_review_notes is null or char_length(cultural_review_notes) <= 2000),
  add column if not exists display_order integer not null default 0;

-- display_order is catalogue presentation (members may read it); the
-- cultural review columns are internal and are deliberately NOT granted.
grant select (display_order) on public.commerce_products to authenticated;

-- ------------------------------------------------------------
-- 1. HELPERS
-- ------------------------------------------------------------
create or replace function tempa_private.commerce_require_admin()
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null or not public.is_staff('admin') then
    raise exception 'COMMERCE:not_authorized' using errcode = '42501';
  end if;
  return auth.uid();
end;
$function$;

create or replace function tempa_private.commerce_audit(
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_target_label text,
  p_reason text,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  insert into public.admin_audit_log (
    actor_id, actor_identifier_snapshot, action, target_type, target_id, target_identifier_snapshot, reason, metadata
  ) values (
    auth.uid(),
    coalesce((select pseudonym from public.profiles where id = auth.uid()), auth.uid()::text),
    p_action, p_target_type, p_target_id, p_target_label,
    nullif(trim(both from coalesce(p_reason, '')), ''),
    p_metadata
  );
end;
$function$;

create or replace function tempa_private.commerce_slugify(p_text text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $function$
  select left(trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g')), 100)
$function$;

-- A label members could see: not an internal code (MA, NG, USA) and not
-- merely the country code itself.
create or replace function tempa_private.commerce_is_human_label(p_label text, p_country_code text)
returns boolean
language sql
immutable
set search_path to 'pg_catalog'
as $function$
  select char_length(trim(both from coalesce(p_label, ''))) >= 2
     and trim(both from p_label) !~ '^[A-Z]{2,3}$'
     and (p_country_code is null or upper(trim(both from p_label)) <> upper(p_country_code))
$function$;

-- The publish checklist. Required items block publishing; the rest guide.
create or replace function tempa_private.commerce_product_readiness(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  p public.commerce_products;
  v jsonb := '[]'::jsonb;
  v_has_price boolean;
begin
  select * into p from public.commerce_products where id = p_product_id;
  if not found then
    return v;
  end if;

  v_has_price := exists (
    select 1 from public.commerce_credit_prices cp
    where cp.product_id = p.id and cp.state = 'published' and (cp.effective_to is null or cp.effective_to > now())
  );

  if p.product_type = 'postcard' then
    v := v || jsonb_build_object('key', 'artwork', 'label', 'Current artwork version', 'required', true,
      'ok', exists (select 1 from public.postcard_versions pv where pv.postcard_key = p.postcard_key and pv.is_current
                    and char_length(trim(both from pv.front_image_path)) > 0));
    v := v || jsonb_build_object('key', 'sendable', 'label', 'Active for sending (otherwise members can’t see it)', 'required', false,
      'ok', exists (select 1 from public.postcard_catalog c where c.key = p.postcard_key and c.is_active));
  elsif p.product_type in ('gift', 'keepsake_template') then
    v := v || jsonb_build_object('key', 'artwork', 'label', 'Current artwork version', 'required', true,
      'ok', exists (select 1 from public.commerce_product_versions pv where pv.product_id = p.id and pv.is_current));
  elsif p.product_type = 'credit_pack' then
    v := v || jsonb_build_object('key', 'pack_price', 'label', 'A published local price (price book)', 'required', true,
      'ok', exists (select 1 from public.commerce_price_books pb where pb.product_id = p.id and pb.state = 'published'
                    and (pb.effective_to is null or pb.effective_to > now())));
  elsif p.product_type = 'bundle' then
    v := v || jsonb_build_object('key', 'bundle_version', 'label', 'A published bundle version with items', 'required', true,
      'ok', exists (select 1 from public.commerce_bundle_versions bv where bv.bundle_product_id = p.id and bv.state = 'published'
                    and (bv.effective_to is null or bv.effective_to > now())
                    and exists (select 1 from public.commerce_bundle_version_items i where i.bundle_version_id = bv.id)));
  else
    v := v || jsonb_build_object('key', 'supported', 'label', 'This product type can’t be sold yet', 'required', true, 'ok', false);
  end if;

  if p.product_type in ('postcard', 'gift', 'keepsake_template') and not p.is_complimentary and p.entitlement_model <> 'none' then
    v := v || jsonb_build_object('key', 'price', 'label', 'A published Credit price (current or scheduled)', 'required', true, 'ok', v_has_price);
  end if;
  v := v || jsonb_build_object('key', 'rights', 'label', 'Rights review cleared', 'required', true,
    'ok', p.rights_review_state in ('not_required', 'approved'));
  v := v || jsonb_build_object('key', 'cultural', 'label', 'Cultural review cleared', 'required', true,
    'ok', p.cultural_review_state in ('not_required', 'approved'));
  if not p.is_complimentary and p.product_type <> 'credit_pack' then
    v := v || jsonb_build_object('key', 'description', 'label', 'Short description', 'required', false,
      'ok', char_length(trim(both from coalesce(p.short_description, ''))) > 0);
  end if;
  return v;
end;
$function$;

create or replace function tempa_private.commerce_is_ready(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select not exists (
    select 1 from jsonb_array_elements(tempa_private.commerce_product_readiness(p_product_id)) c
    where (c->>'required')::boolean and not (c->>'ok')::boolean
  )
$function$;

create or replace function tempa_private.commerce_member_label(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  select coalesce((select pseudonym from public.profiles where id = p_user_id),
                  case when exists (select 1 from public.account_closures c where c.user_id = p_user_id) then 'Closed account' end,
                  'Member')
$function$;

-- ------------------------------------------------------------
-- 2. ADMIN READS
-- ------------------------------------------------------------
create or replace function public.admin_commerce_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  s public.commerce_settings;
begin
  perform tempa_private.commerce_require_admin();
  select * into s from public.commerce_settings where id;
  return jsonb_build_object(
    'switches', jsonb_build_object(
      'commerce_enabled', coalesce(s.commerce_enabled, false), 'credit_spend_enabled', coalesce(s.credit_spend_enabled, false),
      'fiat_checkout_enabled', coalesce(s.fiat_checkout_enabled, false), 'live_payments_enabled', coalesce(s.live_payments_enabled, false),
      'gifts_enabled', coalesce(s.gifts_enabled, false), 'home_shelf_enabled', coalesce(s.home_shelf_enabled, false)),
    'providers', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'display_name', display_name,
                             'checkout_enabled', checkout_enabled, 'live_mode_enabled', live_mode_enabled) order by code)
                           from public.commerce_payment_providers), '[]'::jsonb),
    'products', coalesce((select jsonb_object_agg(k, n) from (
        select lifecycle_state as k, count(*) as n from public.commerce_products group by lifecycle_state) x), '{}'::jsonb),
    'by_type', coalesce((select jsonb_object_agg(k, n) from (
        select product_type as k, count(*) as n from public.commerce_products group by product_type) x), '{}'::jsonb),
    'complimentary', (select count(*) from public.commerce_products where is_complimentary),
    'paid', (select count(*) from public.commerce_products where not is_complimentary),
    'missing_price', (select count(*) from public.commerce_products p
                      where p.product_type in ('postcard', 'gift', 'keepsake_template') and not p.is_complimentary
                        and p.entitlement_model <> 'none' and p.lifecycle_state in ('draft', 'published')
                        and not exists (select 1 from public.commerce_credit_prices cp where cp.product_id = p.id and cp.state = 'published'
                                        and (cp.effective_to is null or cp.effective_to > now()))),
    'missing_artwork', (select count(*) from public.commerce_products p
                        where (p.product_type = 'postcard' and not exists (select 1 from public.postcard_versions pv where pv.postcard_key = p.postcard_key and pv.is_current))
                           or (p.product_type in ('gift', 'keepsake_template') and not exists (select 1 from public.commerce_product_versions pv where pv.product_id = p.id and pv.is_current))),
    'review_pending', (select count(*) from public.commerce_products where rights_review_state in ('pending', 'rejected')
                       or cultural_review_state in ('pending', 'hold', 'rejected')),
    'published_not_ready', (select count(*) from public.commerce_products p where p.lifecycle_state = 'published'
                            and not tempa_private.commerce_is_ready(p.id)),
    'code_only_place_terms', (select count(*) from public.commerce_taxonomy_terms t where t.facet = 'place'
                              and not tempa_private.commerce_is_human_label(t.label, t.country_code)),
    'credits_outstanding', coalesce((select sum(balance) from public.commerce_wallets where balance > 0), 0),
    'credits_negative', coalesce((select sum(balance) from public.commerce_wallets where balance < 0), 0),
    'wallets', (select count(*) from public.commerce_wallets),
    'orders', (select count(*) from public.commerce_orders),
    'recent_credit_ops', coalesce((select jsonb_agg(r order by (r->>'created_at') desc) from (
        select jsonb_build_object('created_at', a.created_at, 'actor', a.actor_identifier_snapshot, 'action', a.action,
                                  'member', a.target_identifier_snapshot, 'member_id', a.target_id, 'reason', a.reason,
                                  'delta', a.metadata->'delta', 'balance', a.metadata->'balance_after') as r
        from public.admin_audit_log a
        where a.action in ('commerce_credit_grant', 'commerce_credit_adjustment')
        order by a.created_at desc limit 8) x), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.admin_commerce_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  perform tempa_private.commerce_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'product_type', p.product_type, 'title', p.title,
      'lifecycle_state', p.lifecycle_state, 'publish_at', p.publish_at, 'unpublish_at', p.unpublish_at,
      'is_complimentary', p.is_complimentary, 'postcard_key', p.postcard_key, 'credit_amount', p.credit_amount,
      'display_order', p.display_order,
      'catalog_active', (select c.is_active from public.postcard_catalog c where c.key = p.postcard_key),
      'thumbnail', coalesce(
        (select pv.front_image_path from public.postcard_versions pv where pv.postcard_key = p.postcard_key and pv.is_current limit 1),
        (select coalesce(v.thumbnail_path, v.image_path) from public.commerce_product_versions v where v.product_id = p.id and v.is_current limit 1)),
      'price', (select cp.credit_amount from public.commerce_credit_prices cp where cp.product_id = p.id and cp.state = 'published'
                and cp.effective_from <= now() and (cp.effective_to is null or cp.effective_to > now()) limit 1),
      'ready', tempa_private.commerce_is_ready(p.id),
      'review_flag', p.rights_review_state in ('pending', 'rejected') or p.cultural_review_state in ('pending', 'hold', 'rejected'),
      'terms', (select count(*) from public.commerce_product_terms pt where pt.product_id = p.id),
      'owners', (select count(*) from public.commerce_entitlements e where e.product_id = p.id and e.state = 'active'),
      'updated_at', p.updated_at
    ) order by p.display_order, lower(p.title))
    from public.commerce_products p
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.admin_commerce_product(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
declare
  p public.commerce_products;
begin
  perform tempa_private.commerce_require_admin();
  select * into p from public.commerce_products where id = p_product_id;
  if not found then
    perform tempa_private.commerce_raise('not_found');
  end if;
  return jsonb_build_object(
    'product', to_jsonb(p) - 'created_by',
    'catalog', (select jsonb_build_object('key', c.key, 'is_active', c.is_active, 'country_code', c.country_code)
                from public.postcard_catalog c where c.key = p.postcard_key),
    'postcard_versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version_number', v.version_number, 'title', v.title,
                                     'image', v.front_image_path, 'motion', v.motion_src, 'is_current', v.is_current, 'created_at', v.created_at,
                                     'times_sent', (select count(*) from public.letter_postcards lp where lp.postcard_version_id = v.id)
                                                   + (select count(*) from public.dispatch_postcards dp where dp.postcard_version_id = v.id))
                                     order by v.version_number desc)
                                   from public.postcard_versions v where v.postcard_key = p.postcard_key), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version_number', v.version_number, 'title', v.title,
                            'image', v.image_path, 'thumbnail', v.thumbnail_path, 'motion', v.motion_path, 'is_current', v.is_current,
                            'created_at', v.created_at,
                            'in_use', exists (select 1 from public.commerce_gift_instances g where g.product_version_id = v.id))
                            order by v.version_number desc)
                          from public.commerce_product_versions v where v.product_id = p.id), '[]'::jsonb),
    'credit_prices', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'credit_amount', cp.credit_amount,
                                 'effective_from', cp.effective_from, 'effective_to', cp.effective_to, 'state', cp.state,
                                 'purchases', (select count(*) from public.commerce_purchases pu where pu.credit_price_id = cp.id))
                                 order by cp.effective_from desc)
                               from public.commerce_credit_prices cp where cp.product_id = p.id), '[]'::jsonb),
    'price_books', coalesce((select jsonb_agg(jsonb_build_object('id', pb.id, 'market', pb.market, 'currency', pb.currency,
                               'amount_minor', pb.amount_minor, 'usd_reference_minor', pb.usd_reference_minor,
                               'effective_from', pb.effective_from, 'effective_to', pb.effective_to, 'state', pb.state)
                               order by pb.market, pb.currency, pb.effective_from desc)
                             from public.commerce_price_books pb where pb.product_id = p.id), '[]'::jsonb),
    'terms', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'facet', t.facet, 'label', t.label, 'state', t.state) order by t.facet, t.label)
                       from public.commerce_product_terms pt join public.commerce_taxonomy_terms t on t.id = pt.term_id
                       where pt.product_id = p.id), '[]'::jsonb),
    'collections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'state', c.state))
                             from public.commerce_collection_products cp join public.commerce_collections c on c.id = cp.collection_id
                             where cp.product_id = p.id), '[]'::jsonb),
    'bundle_versions', coalesce((select jsonb_agg(jsonb_build_object('id', bv.id, 'version_number', bv.version_number, 'state', bv.state,
                                   'effective_from', bv.effective_from, 'effective_to', bv.effective_to,
                                   'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', i.item_product_id, 'title', ip.title,
                                                        'product_type', ip.product_type, 'allocation_credits', i.allocation_credits) order by i.display_order, ip.title)
                                                      from public.commerce_bundle_version_items i join public.commerce_products ip on ip.id = i.item_product_id
                                                      where i.bundle_version_id = bv.id), '[]'::jsonb))
                                   order by bv.version_number desc)
                                 from public.commerce_bundle_versions bv where bv.bundle_product_id = p.id), '[]'::jsonb),
    'readiness', tempa_private.commerce_product_readiness(p.id),
    'owners', (select count(*) from public.commerce_entitlements e where e.product_id = p.id and e.state = 'active'),
    'purchases', (select count(*) from public.commerce_purchases pu where pu.product_id = p.id)
  );
end;
$function$;

create or replace function public.admin_commerce_taxonomy()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  perform tempa_private.commerce_require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'facet', t.facet, 'slug', t.slug, 'label', t.label, 'country_code', t.country_code,
      'aliases', t.aliases, 'display_order', t.display_order, 'state', t.state,
      'human_label', tempa_private.commerce_is_human_label(t.label, t.country_code),
      'products', (select count(*) from public.commerce_product_terms pt where pt.term_id = t.id))
    order by t.facet, t.display_order, lower(t.label))
    from public.commerce_taxonomy_terms t), '[]'::jsonb);
end;
$function$;

create or replace function public.admin_commerce_collections()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  perform tempa_private.commerce_require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'title', c.title, 'description', c.description, 'state', c.state,
      'publish_at', c.publish_at, 'is_featured', c.is_featured, 'display_order', c.display_order,
      'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'product_type', p.product_type,
                              'lifecycle_state', p.lifecycle_state) order by cp.display_order, p.title)
                            from public.commerce_collection_products cp join public.commerce_products p on p.id = cp.product_id
                            where cp.collection_id = c.id), '[]'::jsonb))
    order by c.display_order, lower(c.title))
    from public.commerce_collections c), '[]'::jsonb);
end;
$function$;

create or replace function public.admin_commerce_pricing()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  perform tempa_private.commerce_require_admin();
  return jsonb_build_object(
    'credit_prices', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'product_id', p.id, 'title', p.title,
                         'product_type', p.product_type, 'credit_amount', cp.credit_amount, 'effective_from', cp.effective_from,
                         'effective_to', cp.effective_to, 'state', cp.state) order by lower(p.title), cp.effective_from desc)
                       from public.commerce_credit_prices cp join public.commerce_products p on p.id = cp.product_id), '[]'::jsonb),
    'price_books', coalesce((select jsonb_agg(jsonb_build_object('id', pb.id, 'product_id', p.id, 'title', p.title,
                         'credit_amount', p.credit_amount, 'market', pb.market, 'currency', pb.currency, 'amount_minor', pb.amount_minor,
                         'usd_reference_minor', pb.usd_reference_minor, 'effective_from', pb.effective_from,
                         'effective_to', pb.effective_to, 'state', pb.state) order by p.display_order, pb.market, pb.currency, pb.effective_from desc)
                       from public.commerce_price_books pb join public.commerce_products p on p.id = pb.product_id), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.admin_commerce_member(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  perform tempa_private.commerce_require_admin();
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    perform tempa_private.commerce_raise('member_unavailable');
  end if;
  return jsonb_build_object(
    'member', jsonb_build_object('id', p_user_id, 'label', tempa_private.commerce_member_label(p_user_id),
                                 'closed', exists (select 1 from public.account_closures c where c.user_id = p_user_id)),
    'balance', coalesce((select balance from public.commerce_wallets where user_id = p_user_id), 0),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'created_at', l.created_at, 'entry_type', l.entry_type,
                          'delta', l.delta, 'balance_after', l.balance_after, 'reason', l.reason,
                          'actor', case when l.actor_id is null then null else tempa_private.commerce_member_label(l.actor_id) end,
                          'item', case when l.source_type = 'purchase' then (select pu.product_title_snapshot from public.commerce_purchases pu where pu.id = l.source_id) end)
                          order by l.created_at desc, l.id desc)
                        from (select * from public.commerce_ledger_entries where user_id = p_user_id order by created_at desc limit 100) l), '[]'::jsonb),
    'entitlements', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'product_id', e.product_id, 'title', p.title,
                                'product_type', p.product_type, 'source_type', e.source_type, 'state', e.state,
                                'granted_at', e.granted_at, 'revoked_at', e.revoked_at) order by e.granted_at desc)
                              from public.commerce_entitlements e join public.commerce_products p on p.id = e.product_id
                              where e.user_id = p_user_id), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.admin_commerce_entitlements(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  perform tempa_private.commerce_require_admin();
  return jsonb_build_object(
    'entitlements', coalesce((select jsonb_agg(x order by (x->>'granted_at') desc) from (
        select jsonb_build_object('id', e.id, 'member_id', e.user_id, 'member', tempa_private.commerce_member_label(e.user_id),
               'product_id', e.product_id, 'title', p.title, 'product_type', p.product_type, 'source_type', e.source_type,
               'state', e.state, 'granted_at', e.granted_at) as x
        from public.commerce_entitlements e join public.commerce_products p on p.id = e.product_id
        order by e.granted_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) y), '[]'::jsonb),
    'gifts', jsonb_build_object(
      'pending', (select count(*) from public.commerce_gift_instances where state = 'pending_delivery'),
      'delivered', (select count(*) from public.commerce_gift_instances where state = 'delivered'),
      'cancelled', (select count(*) from public.commerce_gift_instances where state = 'cancelled'))
  );
end;
$function$;

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
             'created_at', o.created_at, 'paid_at', o.paid_at,
             'attempts', coalesce((select jsonb_agg(jsonb_build_object('reference', a.provider_reference, 'status', a.provider_status,
                            'verification', a.verification_state, 'reconciliation', a.reconciliation_state,
                            'expected_amount_minor', a.expected_amount_minor, 'expected_currency', a.expected_currency,
                            'created_at', a.created_at) order by a.created_at)
                          from public.commerce_payment_attempts a where a.order_id = o.id), '[]'::jsonb)) as x
      from public.commerce_orders o order by o.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) y), '[]'::jsonb);
end;
$function$;

create or replace function public.admin_commerce_audit(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog'
as $function$
begin
  perform tempa_private.commerce_require_admin();
  return coalesce((select jsonb_agg(x order by (x->>'created_at') desc) from (
      select jsonb_build_object('id', a.id, 'created_at', a.created_at, 'actor', a.actor_identifier_snapshot,
             'action', a.action, 'target_type', a.target_type, 'target', a.target_identifier_snapshot,
             'target_id', a.target_id, 'reason', a.reason, 'metadata', a.metadata) as x
      from public.admin_audit_log a
      where a.action like 'commerce\_%'
      order by a.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) y), '[]'::jsonb);
end;
$function$;

-- ------------------------------------------------------------
-- 3. CATALOGUE
-- ------------------------------------------------------------
-- Postcard products are created by the catalogue trigger (Content →
-- Postcards) as DRAFT Complimentary; other types are created here, always
-- as drafts.
create or replace function public.admin_commerce_create_product(
  p_product_type text,
  p_title text,
  p_is_complimentary boolean default false,
  p_credit_amount bigint default null,
  p_entitlement_model text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_model text;
  v_base text;
  v_slug text;
  v_id uuid;
begin
  perform tempa_private.commerce_require_admin();
  if p_product_type not in ('gift', 'keepsake_template', 'credit_pack', 'bundle')
     or char_length(trim(both from coalesce(p_title, ''))) not between 1 and 140 then
    perform tempa_private.commerce_raise('invalid_request');
  end if;
  v_model := case p_product_type
    when 'gift' then 'gift_instance'
    when 'credit_pack' then 'credits'
    when 'bundle' then 'bundle'
    else coalesce(p_entitlement_model, 'durable') end;
  v_base := (case p_product_type when 'gift' then 'gift-' when 'keepsake_template' then 'keepsake-'
             when 'credit_pack' then 'credits-' else 'bundle-' end) || coalesce(nullif(tempa_private.commerce_slugify(p_title), ''), 'item');
  v_slug := v_base;
  if exists (select 1 from public.commerce_products where slug = v_slug) then
    v_slug := v_base || '-' || left(md5(gen_random_uuid()::text), 6);
  end if;
  begin
    insert into public.commerce_products (slug, product_type, title, lifecycle_state, is_complimentary, entitlement_model,
                                          credit_amount, created_by)
    values (v_slug, p_product_type, trim(both from p_title), 'draft',
            case when p_product_type in ('credit_pack', 'bundle') then false else coalesce(p_is_complimentary, false) end,
            v_model, case when p_product_type = 'credit_pack' then p_credit_amount end, auth.uid())
    returning id into v_id;
  exception when check_violation then
    perform tempa_private.commerce_raise('invalid_request');
  end;
  perform tempa_private.commerce_audit('commerce_product_create', 'commerce_product', v_id, trim(both from p_title), null,
    jsonb_build_object('product_type', p_product_type, 'slug', v_slug));
  return v_id;
end;
$function$;

-- Edits a product's presentation and review fields. Commercial identity
-- (Complimentary vs paid, Credits granted by a pack) changes only while
-- the product is not published.
create or replace function public.admin_commerce_update_product(p_product_id uuid, p_patch jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  p public.commerce_products;
  k text;
  v_changed text[] := '{}';
  v_allowed text[] := array['title', 'short_description', 'story_description', 'preview_policy', 'is_complimentary',
                            'credit_amount', 'display_order', 'rights_review_state', 'rights_review_notes',
                            'cultural_review_state', 'cultural_review_notes'];
begin
  perform tempa_private.commerce_require_admin();
  select * into p from public.commerce_products where id = p_product_id for update;
  if not found then
    perform tempa_private.commerce_raise('not_found');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform tempa_private.commerce_raise('invalid_request');
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not k = any (v_allowed) then
      perform tempa_private.commerce_raise('invalid_request');
    end if;
    if to_jsonb(p) -> k is distinct from p_patch -> k then
      v_changed := v_changed || k;
    end if;
  end loop;
  if cardinality(v_changed) = 0 then
    return jsonb_build_object('status', 'unchanged');
  end if;
  if ('is_complimentary' = any (v_changed) or 'credit_amount' = any (v_changed)) and p.lifecycle_state = 'published' then
    perform tempa_private.commerce_raise('unpublish_first');
  end if;

  begin
    update public.commerce_products set
      title = case when p_patch ? 'title' then trim(both from p_patch->>'title') else title end,
      short_description = case when p_patch ? 'short_description' then nullif(trim(both from coalesce(p_patch->>'short_description', '')), '') else short_description end,
      story_description = case when p_patch ? 'story_description' then nullif(trim(both from coalesce(p_patch->>'story_description', '')), '') else story_description end,
      preview_policy = case when p_patch ? 'preview_policy' then p_patch->>'preview_policy' else preview_policy end,
      is_complimentary = case when p_patch ? 'is_complimentary' then (p_patch->>'is_complimentary')::boolean else is_complimentary end,
      credit_amount = case when p_patch ? 'credit_amount' then (p_patch->>'credit_amount')::bigint else credit_amount end,
      display_order = case when p_patch ? 'display_order' then (p_patch->>'display_order')::integer else display_order end,
      rights_review_state = case when p_patch ? 'rights_review_state' then p_patch->>'rights_review_state' else rights_review_state end,
      rights_review_notes = case when p_patch ? 'rights_review_notes' then nullif(trim(both from coalesce(p_patch->>'rights_review_notes', '')), '') else rights_review_notes end,
      cultural_review_state = case when p_patch ? 'cultural_review_state' then p_patch->>'cultural_review_state' else cultural_review_state end,
      cultural_review_notes = case when p_patch ? 'cultural_review_notes' then nullif(trim(both from coalesce(p_patch->>'cultural_review_notes', '')), '') else cultural_review_notes end,
      updated_at = now()
    where id = p_product_id;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    perform tempa_private.commerce_raise('invalid_request');
  end;

  -- A published product that is no longer ready (e.g. review put on hold) leaves sale at once.
  if p.lifecycle_state = 'published' and not tempa_private.commerce_is_ready(p_product_id) then
    update public.commerce_products set lifecycle_state = 'inactive', updated_at = now() where id = p_product_id;
    v_changed := v_changed || 'lifecycle_state';
  end if;

  perform tempa_private.commerce_audit('commerce_product_update', 'commerce_product', p_product_id, p.title, p_reason,
    jsonb_build_object('fields', to_jsonb(v_changed),
                       'before', (select jsonb_object_agg(f, to_jsonb(p) -> f) from unnest(v_changed) f
                                  where f not in ('rights_review_notes', 'cultural_review_notes', 'story_description', 'short_description', 'lifecycle_state')),
                       'after', (select jsonb_object_agg(f, to_jsonb(u) -> f) from public.commerce_products u, unnest(v_changed) f
                                 where u.id = p_product_id and f not in ('rights_review_notes', 'cultural_review_notes', 'story_description', 'short_description'))));
  return jsonb_build_object('status', 'updated', 'fields', to_jsonb(v_changed),
                            'lifecycle_state', (select lifecycle_state from public.commerce_products where id = p_product_id));
end;
$function$;

-- publish (optionally scheduled via p_publish_at / p_unpublish_at),
-- inactive ("remove from sale"), retired, draft. Publishing is refused
-- server-side unless every required readiness item passes. Existing
-- owners always keep their entitlements.
create or replace function public.admin_commerce_set_lifecycle(
  p_product_id uuid,
  p_state text,
  p_reason text default null,
  p_publish_at timestamptz default null,
  p_unpublish_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  p public.commerce_products;
begin
  perform tempa_private.commerce_require_admin();
  select * into p from public.commerce_products where id = p_product_id for update;
  if not found then
    perform tempa_private.commerce_raise('not_found');
  end if;
  if p_state not in ('published', 'inactive', 'retired', 'draft') then
    perform tempa_private.commerce_raise('invalid_request');
  end if;
  if p_state = 'published' and not tempa_private.commerce_is_ready(p_product_id) then
    perform tempa_private.commerce_raise('not_ready');
  end if;
  if p_state = 'draft' and p.lifecycle_state = 'published' then
    perform tempa_private.commerce_raise('remove_from_sale_first');
  end if;
  if p_unpublish_at is not null and p_unpublish_at <= coalesce(p_publish_at, now()) then
    perform tempa_private.commerce_raise('invalid_request');
  end if;

  update public.commerce_products set
    lifecycle_state = p_state,
    publish_at = case when p_state = 'published' then p_publish_at else publish_at end,
    unpublish_at = case when p_state = 'published' then p_unpublish_at else unpublish_at end,
    updated_at = now()
  where id = p_product_id;

  perform tempa_private.commerce_audit(
    case p_state when 'published' then 'commerce_product_publish' when 'inactive' then 'commerce_product_remove_from_sale'
                 when 'retired' then 'commerce_product_retire' else 'commerce_product_to_draft' end,
    'commerce_product', p_product_id, p.title, p_reason,
    jsonb_build_object('from', p.lifecycle_state, 'to', p_state, 'publish_at', p_publish_at, 'unpublish_at', p_unpublish_at));
  return jsonb_build_object('status', 'updated', 'lifecycle_state', p_state);
end;
$function$;

-- Gift / Keepsake artwork versions. A new version becomes current; old
-- versions are immutable (2026-10-20 trigger) and stay for history.
create or replace function public.admin_commerce_add_version(
  p_product_id uuid,
  p_title text,
  p_image_path text,
  p_thumbnail_path text default null,
  p_motion_path text default null,
  p_motion_duration_seconds numeric default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  p public.commerce_products;
  v_id uuid;
begin
  perform tempa_private.commerce_require_admin();
  select * into p from public.commerce_products where id = p_product_id for update;
  if not found or p.product_type not in ('gift', 'keepsake_template') then
    perform tempa_private.commerce_raise('invalid_request');
  end if;
  update public.commerce_product_versions set is_current = false where product_id = p_product_id and is_current;
  begin
    insert into public.commerce_product_versions (product_id, version_number, title, image_path, thumbnail_path, motion_path,
                                                  motion_duration_seconds, is_current, created_by)
    values (p_product_id, coalesce((select max(version_number) from public.commerce_product_versions where product_id = p_product_id), 0) + 1,
            trim(both from coalesce(nullif(p_title, ''), p.title)), trim(both from p_image_path), nullif(trim(both from coalesce(p_thumbnail_path, '')), ''),
            nullif(trim(both from coalesce(p_motion_path, '')), ''), p_motion_duration_seconds, true, auth.uid())
    returning id into v_id;
  exception when check_violation or not_null_violation then
    perform tempa_private.commerce_raise('invalid_request');
  end;
  perform tempa_private.commerce_audit('commerce_version_add', 'commerce_product', p_product_id, p.title, p_reason,
    jsonb_build_object('version_id', v_id));
  return v_id;
end;
$function$;

create or replace function public.admin_commerce_set_current_version(p_version_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v public.commerce_product_versions;
begin
  perform tempa_private.commerce_require_admin();
  select * into v from public.commerce_product_versions where id = p_version_id;
  if not found then
    perform tempa_private.commerce_raise('not_found');
  end if;
  perform 1 from public.commerce_products where id = v.product_id for update;
  update public.commerce_product_versions set is_current = false where product_id = v.product_id and is_current and id <> p_version_id;
  update public.commerce_product_versions set is_current = true where id = p_version_id;
  perform tempa_private.commerce_audit('commerce_version_set_current', 'commerce_product', v.product_id,
    (select title from public.commerce_products where id = v.product_id), p_reason,
    jsonb_build_object('version_id', p_version_id, 'version_number', v.version_number));
end;
$function$;

-- ------------------------------------------------------------
-- 4. TAXONOMY, COLLECTIONS, MERCHANDISING
-- ------------------------------------------------------------
create or replace function public.admin_commerce_save_term(
  p_id uuid,
  p_facet text,
  p_label text,
  p_state text,
  p_aliases text[] default '{}',
  p_country_code text default null,
  p_display_order integer default 0,
  p_slug text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_old public.commerce_taxonomy_terms;
  v_id uuid := p_id;
  v_label text := trim(both from coalesce(p_label, ''));
  v_aliases text[];
begin
  perform tempa_private.commerce_require_admin();
  v_aliases := coalesce((select array_agg(distinct trim(both from a)) from unnest(coalesce(p_aliases, '{}')) a
                         where char_length(trim(both from a)) between 1 and 60), '{}');
  if p_state = 'published' and not tempa_private.commerce_is_human_label(v_label, upper(nullif(trim(both from coalesce(p_country_code, '')), ''))) then
    perform tempa_private.commerce_raise('needs_human_label');
  end if;
  begin
    if p_id is null then
      insert into public.commerce_taxonomy_terms (facet, slug, label, country_code, aliases, display_order, state)
      values (p_facet, coalesce(nullif(p_slug, ''), nullif(tempa_private.commerce_slugify(v_label), '')), v_label,
              upper(nullif(trim(both from coalesce(p_country_code, '')), '')), v_aliases, coalesce(p_display_order, 0), p_state)
      returning id into v_id;
    else
      select * into v_old from public.commerce_taxonomy_terms where id = p_id for update;
      if not found then
        perform tempa_private.commerce_raise('not_found');
      end if;
      update public.commerce_taxonomy_terms set
        label = v_label, country_code = upper(nullif(trim(both from coalesce(p_country_code, '')), '')),
        aliases = v_aliases, display_order = coalesce(p_display_order, 0), state = p_state
      where id = p_id;
    end if;
  exception
    when unique_violation then perform tempa_private.commerce_raise('duplicate');
    when check_violation or not_null_violation then perform tempa_private.commerce_raise('invalid_request');
  end;
  if p_id is null or v_old.state is distinct from p_state or v_old.label is distinct from v_label then
    perform tempa_private.commerce_audit('commerce_term_save', 'commerce_term', v_id, v_label, null,
      jsonb_build_object('facet', p_facet, 'state_from', v_old.state, 'state_to', p_state, 'label_from', v_old.label));
  end if;
  return v_id;
end;
$function$;

create or replace function public.admin_commerce_set_product_terms(p_product_id uuid, p_term_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_before uuid[];
begin
  perform tempa_private.commerce_require_admin();
  if not exists (select 1 from public.commerce_products where id = p_product_id) then
    perform tempa_private.commerce_raise('not_found');
  end if;
  select coalesce(array_agg(term_id order by term_id), '{}') into v_before from public.commerce_product_terms where product_id = p_product_id;
  delete from public.commerce_product_terms where product_id = p_product_id;
  insert into public.commerce_product_terms (product_id, term_id, display_order)
  select p_product_id, t, ord::integer from unnest(coalesce(p_term_ids, '{}')) with ordinality as x(t, ord)
  on conflict do nothing;
  perform tempa_private.commerce_audit('commerce_product_terms', 'commerce_product', p_product_id,
    (select title from public.commerce_products where id = p_product_id), null,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(coalesce(p_term_ids, '{}'))));
end;
$function$;

create or replace function public.admin_commerce_save_collection(
  p_id uuid,
  p_title text,
  p_state text,
  p_description text default null,
  p_is_featured boolean default false,
  p_display_order integer default 0,
  p_publish_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_old public.commerce_collections;
  v_id uuid := p_id;
  v_slug text;
begin
  perform tempa_private.commerce_require_admin();
  begin
    if p_id is null then
      v_slug := coalesce(nullif(tempa_private.commerce_slugify(p_title), ''), 'collection');
      if exists (select 1 from public.commerce_collections where slug = v_slug) then
        v_slug := v_slug || '-' || left(md5(gen_random_uuid()::text), 6);
      end if;
      insert into public.commerce_collections (slug, title, description, state, publish_at, is_featured, display_order, created_by)
      values (v_slug, trim(both from p_title), nullif(trim(both from coalesce(p_description, '')), ''), p_state, p_publish_at,
              coalesce(p_is_featured, false), coalesce(p_display_order, 0), auth.uid())
      returning id into v_id;
    else
      select * into v_old from public.commerce_collections where id = p_id for update;
      if not found then
        perform tempa_private.commerce_raise('not_found');
      end if;
      update public.commerce_collections set
        title = trim(both from p_title), description = nullif(trim(both from coalesce(p_description, '')), ''),
        state = p_state, publish_at = p_publish_at, is_featured = coalesce(p_is_featured, false),
        display_order = coalesce(p_display_order, 0), updated_at = now()
      where id = p_id;
    end if;
  exception when check_violation or not_null_violation then
    perform tempa_private.commerce_raise('invalid_request');
  end;
  perform tempa_private.commerce_audit('commerce_collection_save', 'commerce_collection', v_id, trim(both from p_title), null,
    jsonb_build_object('state_from', v_old.state, 'state_to', p_state, 'featured_from', v_old.is_featured, 'featured_to', p_is_featured,
                       'publish_at', p_publish_at));
  return v_id;
end;
$function$;

create or replace function public.admin_commerce_set_collection_products(p_collection_id uuid, p_product_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  perform tempa_private.commerce_require_admin();
  if not exists (select 1 from public.commerce_collections where id = p_collection_id) then
    perform tempa_private.commerce_raise('not_found');
  end if;
  delete from public.commerce_collection_products where collection_id = p_collection_id;
  insert into public.commerce_collection_products (collection_id, product_id, display_order)
  select p_collection_id, x, ord::integer from unnest(coalesce(p_product_ids, '{}')) with ordinality as t(x, ord)
  on conflict do nothing;
  perform tempa_private.commerce_audit('commerce_collection_products', 'commerce_collection', p_collection_id,
    (select title from public.commerce_collections where id = p_collection_id), null,
    jsonb_build_object('products', to_jsonb(coalesce(p_product_ids, '{}'))));
end;
$function$;

-- Merchandising: the order collections (and so the Featured shelf) appear in.
create or replace function public.admin_commerce_reorder_collections(p_collection_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  perform tempa_private.commerce_require_admin();
  update public.commerce_collections c set display_order = x.ord::integer, updated_at = now()
  from unnest(coalesce(p_collection_ids, '{}')) with ordinality as x(id, ord)
  where c.id = x.id;
  perform tempa_private.commerce_audit('commerce_merchandising_order', 'commerce_collection', null, 'Collection order', null,
    jsonb_build_object('order', to_jsonb(coalesce(p_collection_ids, '{}'))));
end;
$function$;

-- ------------------------------------------------------------
-- 5. PRICING (p_kind: 'credit' = commerce_credit_prices, 'book' = commerce_price_books)
-- ------------------------------------------------------------
-- New price. As a draft it simply waits. Published, it takes effect at
-- p_effective_from (default now): the open published window it replaces
-- is closed at that instant, so there is never a gap or an overlap. A
-- scheduled future row blocks another change until it is ended/discarded.
create or replace function public.admin_commerce_set_price(
  p_kind text,
  p_product_id uuid,
  p_amount bigint,
  p_effective_from timestamptz default null,
  p_as_draft boolean default false,
  p_reason text default null,
  p_market text default '*',
  p_currency text default null,
  p_usd_reference_minor bigint default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_from timestamptz := coalesce(p_effective_from, now());
  v_id uuid;
  v_title text;
  v_market text := coalesce(nullif(upper(trim(both from coalesce(p_market, ''))), ''), '*');
begin
  perform tempa_private.commerce_require_admin();
  select title into v_title from public.commerce_products where id = p_product_id for update;
  if v_title is null or p_amount is null or p_amount <= 0 or p_kind not in ('credit', 'book') then
    perform tempa_private.commerce_raise('invalid_request');
  end if;
  begin
    if p_kind = 'credit' then
      if not p_as_draft then
        update public.commerce_credit_prices set effective_to = v_from
        where product_id = p_product_id and state = 'published' and effective_from < v_from
          and (effective_to is null or effective_to > v_from);
      end if;
      insert into public.commerce_credit_prices (product_id, credit_amount, effective_from, state, created_by)
      values (p_product_id, p_amount, v_from, case when p_as_draft then 'draft' else 'published' end, auth.uid())
      returning id into v_id;
    else
      if not p_as_draft then
        update public.commerce_price_books set effective_to = v_from
        where product_id = p_product_id and state = 'published' and market = v_market and currency = upper(p_currency)
          and effective_from < v_from and (effective_to is null or effective_to > v_from);
      end if;
      insert into public.commerce_price_books (product_id, currency, market, amount_minor, usd_reference_minor,
                                               effective_from, state, created_by)
      values (p_product_id, upper(p_currency), v_market, p_amount,
              coalesce(p_usd_reference_minor, case when upper(p_currency) = 'USD' then p_amount end),
              v_from, case when p_as_draft then 'draft' else 'published' end, auth.uid())
      returning id into v_id;
    end if;
  exception
    when exclusion_violation then perform tempa_private.commerce_raise('price_overlap');
    when insufficient_privilege then perform tempa_private.commerce_raise('price_frozen');
    when check_violation or not_null_violation or invalid_parameter_value then perform tempa_private.commerce_raise('invalid_price');
  end;
  perform tempa_private.commerce_audit(case when p_as_draft then 'commerce_price_draft' else 'commerce_price_publish' end,
    'commerce_product', p_product_id, v_title, p_reason,
    jsonb_build_object('kind', p_kind, 'price_id', v_id, 'amount', p_amount, 'effective_from', v_from,
                       'market', case when p_kind = 'book' then v_market end, 'currency', upper(p_currency),
                       'usd_reference_minor', p_usd_reference_minor));
  return v_id;
end;
$function$;

-- Publishes a draft, closing the open published window it replaces.
create or replace function public.admin_commerce_publish_price(p_kind text, p_price_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_product uuid;
  v_from timestamptz;
  v_market text;
  v_currency text;
  v_amount bigint;
begin
  perform tempa_private.commerce_require_admin();
  if p_kind = 'credit' then
    select product_id, effective_from, credit_amount into v_product, v_from, v_amount
    from public.commerce_credit_prices where id = p_price_id and state = 'draft';
  elsif p_kind = 'book' then
    select product_id, effective_from, market, currency, amount_minor into v_product, v_from, v_market, v_currency, v_amount
    from public.commerce_price_books where id = p_price_id and state = 'draft';
  end if;
  if v_product is null then
    perform tempa_private.commerce_raise('not_found');
  end if;
  perform 1 from public.commerce_products where id = v_product for update;
  v_from := greatest(v_from, now());
  begin
    if p_kind = 'credit' then
      update public.commerce_credit_prices set effective_to = v_from
      where product_id = v_product and state = 'published' and effective_from < v_from and (effective_to is null or effective_to > v_from);
      update public.commerce_credit_prices set state = 'published', effective_from = v_from where id = p_price_id;
    else
      update public.commerce_price_books set effective_to = v_from
      where product_id = v_product and state = 'published' and market = v_market and currency = v_currency
        and effective_from < v_from and (effective_to is null or effective_to > v_from);
      update public.commerce_price_books set state = 'published', effective_from = v_from where id = p_price_id;
    end if;
  exception
    when exclusion_violation then perform tempa_private.commerce_raise('price_overlap');
    when insufficient_privilege then perform tempa_private.commerce_raise('price_frozen');
  end;
  perform tempa_private.commerce_audit('commerce_price_publish', 'commerce_product', v_product,
    (select title from public.commerce_products where id = v_product), p_reason,
    jsonb_build_object('kind', p_kind, 'price_id', p_price_id, 'amount', v_amount, 'effective_from', v_from, 'market', v_market, 'currency', v_currency));
end;
$function$;

-- Ends a published price at p_effective_to (default now) — or retires a
-- scheduled one that has not started. Never edits the amount.
create or replace function public.admin_commerce_end_price(p_kind text, p_price_id uuid, p_effective_to timestamptz default null, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_product uuid;
  v_from timestamptz;
  v_to timestamptz := coalesce(p_effective_to, now());
begin
  perform tempa_private.commerce_require_admin();
  if p_kind = 'credit' then
    select product_id, effective_from into v_product, v_from from public.commerce_credit_prices where id = p_price_id and state = 'published';
  elsif p_kind = 'book' then
    select product_id, effective_from into v_product, v_from from public.commerce_price_books where id = p_price_id and state = 'published';
  end if;
  if v_product is null then
    perform tempa_private.commerce_raise('not_found');
  end if;
  begin
    if v_from >= v_to then
      if p_kind = 'credit' then
        update public.commerce_credit_prices set state = 'retired' where id = p_price_id;
      else
        update public.commerce_price_books set state = 'retired' where id = p_price_id;
      end if;
    elsif p_kind = 'credit' then
      update public.commerce_credit_prices set effective_to = v_to where id = p_price_id and (effective_to is null or effective_to > v_to);
    else
      update public.commerce_price_books set effective_to = v_to where id = p_price_id and (effective_to is null or effective_to > v_to);
    end if;
  exception when insufficient_privilege then
    perform tempa_private.commerce_raise('price_frozen');
  end;
  perform tempa_private.commerce_audit('commerce_price_end', 'commerce_product', v_product,
    (select title from public.commerce_products where id = v_product), p_reason,
    jsonb_build_object('kind', p_kind, 'price_id', p_price_id, 'effective_to', v_to));
end;
$function$;

create or replace function public.admin_commerce_discard_draft_price(p_kind text, p_price_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_product uuid;
begin
  perform tempa_private.commerce_require_admin();
  if p_kind = 'credit' then
    delete from public.commerce_credit_prices where id = p_price_id and state = 'draft' returning product_id into v_product;
  elsif p_kind = 'book' then
    delete from public.commerce_price_books where id = p_price_id and state = 'draft' returning product_id into v_product;
  end if;
  if v_product is null then
    perform tempa_private.commerce_raise('not_found');
  end if;
  perform tempa_private.commerce_audit('commerce_price_discard_draft', 'commerce_product', v_product,
    (select title from public.commerce_products where id = v_product), null, jsonb_build_object('kind', p_kind, 'price_id', p_price_id));
end;
$function$;

-- ------------------------------------------------------------
-- 6. BUNDLES
-- ------------------------------------------------------------
-- p_items: [{"product_id": "...", "allocation_credits": 40}, ...] in display order.
create or replace function public.admin_commerce_save_bundle_draft(
  p_bundle_product_id uuid,
  p_version_id uuid,
  p_items jsonb,
  p_effective_from timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_id uuid := p_version_id;
begin
  perform tempa_private.commerce_require_admin();
  if not exists (select 1 from public.commerce_products where id = p_bundle_product_id and product_type = 'bundle') then
    perform tempa_private.commerce_raise('invalid_request');
  end if;
  perform 1 from public.commerce_products where id = p_bundle_product_id for update;
  begin
    if v_id is null then
      insert into public.commerce_bundle_versions (bundle_product_id, version_number, effective_from, created_by)
      values (p_bundle_product_id,
              coalesce((select max(version_number) from public.commerce_bundle_versions where bundle_product_id = p_bundle_product_id), 0) + 1,
              coalesce(p_effective_from, now()), auth.uid())
      returning id into v_id;
    else
      if not exists (select 1 from public.commerce_bundle_versions where id = v_id and bundle_product_id = p_bundle_product_id and state = 'draft') then
        perform tempa_private.commerce_raise('bundle_frozen');
      end if;
      update public.commerce_bundle_versions set effective_from = coalesce(p_effective_from, effective_from) where id = v_id;
      delete from public.commerce_bundle_version_items where bundle_version_id = v_id;
    end if;
    insert into public.commerce_bundle_version_items (bundle_version_id, item_product_id, allocation_credits, display_order)
    select v_id, (e.value->>'product_id')::uuid, (e.value->>'allocation_credits')::bigint, e.ordinality::integer
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality e;
  exception
    when invalid_parameter_value then perform tempa_private.commerce_raise('bundle_items_durable_only');
    when insufficient_privilege then perform tempa_private.commerce_raise('bundle_frozen');
    when check_violation or not_null_violation or invalid_text_representation or unique_violation or foreign_key_violation then
      perform tempa_private.commerce_raise('invalid_request');
  end;
  perform tempa_private.commerce_audit('commerce_bundle_draft_save', 'commerce_product', p_bundle_product_id,
    (select title from public.commerce_products where id = p_bundle_product_id), null,
    jsonb_build_object('version_id', v_id, 'items', p_items));
  return v_id;
end;
$function$;

-- Publishing freezes the version (2026-10-20 guards) and replaces the
-- currently open published version from the same instant.
create or replace function public.admin_commerce_publish_bundle_version(p_version_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v public.commerce_bundle_versions;
  v_from timestamptz;
begin
  perform tempa_private.commerce_require_admin();
  select * into v from public.commerce_bundle_versions where id = p_version_id and state = 'draft';
  if not found then
    perform tempa_private.commerce_raise('not_found');
  end if;
  if not exists (select 1 from public.commerce_bundle_version_items where bundle_version_id = p_version_id) then
    perform tempa_private.commerce_raise('bundle_empty');
  end if;
  perform 1 from public.commerce_products where id = v.bundle_product_id for update;
  v_from := greatest(v.effective_from, now());
  begin
    update public.commerce_bundle_versions set effective_to = v_from
    where bundle_product_id = v.bundle_product_id and state = 'published' and effective_from < v_from
      and (effective_to is null or effective_to > v_from);
    update public.commerce_bundle_versions set effective_from = v_from where id = p_version_id;
    update public.commerce_bundle_versions set state = 'published' where id = p_version_id;
  exception
    when exclusion_violation then perform tempa_private.commerce_raise('price_overlap');
    when insufficient_privilege then perform tempa_private.commerce_raise('bundle_frozen');
  end;
  perform tempa_private.commerce_audit('commerce_bundle_publish', 'commerce_product', v.bundle_product_id,
    (select title from public.commerce_products where id = v.bundle_product_id), p_reason,
    jsonb_build_object('version_id', p_version_id, 'version_number', v.version_number, 'effective_from', v_from,
                       'total_credits', (select sum(allocation_credits) from public.commerce_bundle_version_items where bundle_version_id = p_version_id)));
end;
$function$;

create or replace function public.admin_commerce_retire_bundle_version(p_version_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v public.commerce_bundle_versions;
begin
  perform tempa_private.commerce_require_admin();
  select * into v from public.commerce_bundle_versions where id = p_version_id;
  if not found then
    perform tempa_private.commerce_raise('not_found');
  end if;
  if v.state = 'draft' then
    delete from public.commerce_bundle_version_items where bundle_version_id = p_version_id;
    delete from public.commerce_bundle_versions where id = p_version_id;
  else
    update public.commerce_bundle_versions set state = 'retired' where id = p_version_id and state = 'published';
  end if;
  perform tempa_private.commerce_audit('commerce_bundle_retire', 'commerce_product', v.bundle_product_id,
    (select title from public.commerce_products where id = v.bundle_product_id), p_reason,
    jsonb_build_object('version_id', p_version_id, 'was', v.state));
end;
$function$;

-- ------------------------------------------------------------
-- 7. ENTITLEMENTS — explicit, reasoned, audited admin grant
-- ------------------------------------------------------------
-- The ONLY way staff gain a premium Postcard: an admin grants it to a
-- named account with a purpose and reason (e.g. 'official_use' so an
-- official Dispatch may carry premium artwork). No money moves. There is
-- no staff-wide bypass; the Checkpoint-2 send trigger is unchanged.
create or replace function public.admin_commerce_grant_entitlement(
  p_user_id uuid,
  p_product_id uuid,
  p_purpose text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  p public.commerce_products;
  v_reason text := trim(both from coalesce(p_reason, ''));
  v_id uuid;
begin
  perform tempa_private.commerce_require_admin();
  if char_length(v_reason) not between 1 and 500 then
    perform tempa_private.commerce_raise('reason_required');
  end if;
  if p_purpose not in ('official_use', 'support', 'compensation', 'other') then
    perform tempa_private.commerce_raise('invalid_request');
  end if;
  select * into p from public.commerce_products where id = p_product_id;
  if not found or p.entitlement_model <> 'durable' then
    perform tempa_private.commerce_raise('not_grantable');
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id)
     or exists (select 1 from public.account_closures c where c.user_id = p_user_id) then
    perform tempa_private.commerce_raise('member_unavailable');
  end if;
  select id into v_id from public.commerce_entitlements where user_id = p_user_id and product_id = p_product_id and state = 'active';
  if v_id is not null then
    return jsonb_build_object('status', 'already_owned', 'entitlement_id', v_id);
  end if;
  insert into public.commerce_entitlements (user_id, product_id, source_type, source_id)
  values (p_user_id, p_product_id, 'admin_grant', null)
  returning id into v_id;
  perform tempa_private.commerce_audit('commerce_entitlement_grant', 'commerce_entitlement', v_id,
    tempa_private.commerce_member_label(p_user_id), v_reason,
    jsonb_build_object('member_id', p_user_id, 'product_id', p_product_id, 'product', p.title, 'purpose', p_purpose));
  return jsonb_build_object('status', 'granted', 'entitlement_id', v_id);
end;
$function$;

-- ------------------------------------------------------------
-- 8. PRIVILEGES
-- ------------------------------------------------------------
do $grants$
declare
  f text;
begin
  foreach f in array array[
    'tempa_private.commerce_require_admin()',
    'tempa_private.commerce_audit(text, text, uuid, text, text, jsonb)',
    'tempa_private.commerce_slugify(text)',
    'tempa_private.commerce_is_human_label(text, text)',
    'tempa_private.commerce_product_readiness(uuid)',
    'tempa_private.commerce_is_ready(uuid)',
    'tempa_private.commerce_member_label(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.admin_commerce_overview()',
    'public.admin_commerce_catalog()',
    'public.admin_commerce_product(uuid)',
    'public.admin_commerce_taxonomy()',
    'public.admin_commerce_collections()',
    'public.admin_commerce_pricing()',
    'public.admin_commerce_member(uuid)',
    'public.admin_commerce_entitlements(integer)',
    'public.admin_commerce_orders(integer)',
    'public.admin_commerce_audit(integer)',
    'public.admin_commerce_create_product(text, text, boolean, bigint, text)',
    'public.admin_commerce_update_product(uuid, jsonb, text)',
    'public.admin_commerce_set_lifecycle(uuid, text, text, timestamptz, timestamptz)',
    'public.admin_commerce_add_version(uuid, text, text, text, text, numeric, text)',
    'public.admin_commerce_set_current_version(uuid, text)',
    'public.admin_commerce_save_term(uuid, text, text, text, text[], text, integer, text)',
    'public.admin_commerce_set_product_terms(uuid, uuid[])',
    'public.admin_commerce_save_collection(uuid, text, text, text, boolean, integer, timestamptz)',
    'public.admin_commerce_set_collection_products(uuid, uuid[])',
    'public.admin_commerce_reorder_collections(uuid[])',
    'public.admin_commerce_set_price(text, uuid, bigint, timestamptz, boolean, text, text, text, bigint)',
    'public.admin_commerce_publish_price(text, uuid, text)',
    'public.admin_commerce_end_price(text, uuid, timestamptz, text)',
    'public.admin_commerce_discard_draft_price(text, uuid)',
    'public.admin_commerce_save_bundle_draft(uuid, uuid, jsonb, timestamptz)',
    'public.admin_commerce_publish_bundle_version(uuid, text)',
    'public.admin_commerce_retire_bundle_version(uuid, text)',
    'public.admin_commerce_grant_entitlement(uuid, uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$grants$;

commit;
