-- Phase 2: additive Bachs provider support. Sandbox checkout remains disabled.
-- Preserve the existing three-argument Flutterwave RPC for backwards compatibility.
begin;
insert into public.commerce_payment_providers(code, display_name, checkout_enabled, live_mode_enabled)
values ('bachs', 'Bachs', false, false)
on conflict (code) do nothing;

-- Explicit provider parameter prevents ambiguous routing; replay cannot switch providers.
create or replace function public.commerce_create_credit_order_for_provider(p_product_id uuid, p_currency text, p_idempotency_key text, p_provider text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_uid uuid := auth.uid();
  v_provider text := lower(coalesce(p_provider, ''));
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
  if v_provider not in ('bachs', v_provider) then
    perform tempa_private.commerce_raise('invalid_request');
  end if;
  v_key := tempa_private.commerce_valid_key(p_idempotency_key);

  -- Replay of the same intent returns the original order (before any gate,
  -- so a retry after a switch change still resolves to what was created).
  select * into v_existing from public.commerce_orders where idempotency_key = v_key;
  if found then
    if v_existing.user_id = v_uid and v_existing.product_id = p_product_id and v_existing.currency = v_currency and v_existing.provider = v_provider then
      return jsonb_build_object('order_id', v_existing.id, 'reference', v_existing.tempa_reference,
        'product', v_existing.product_title_snapshot, 'credits', v_existing.credits_to_grant,
        'currency', v_existing.currency, 'amount_minor', v_existing.amount_minor,
        'mode', v_existing.payment_mode, 'state', v_existing.state, 'replayed', true, 'provider', v_existing.provider);
    end if;
    perform tempa_private.commerce_raise('idempotency_conflict');
  end if;

  select * into v_gate from tempa_private.commerce_checkout_gate(v_uid, v_provider);
  if v_gate.reason is not null then
    perform tempa_private.commerce_raise(v_gate.reason);
  end if;

  if v_currency !~ '^[A-Z]{3}$' or not exists (
    select 1 from public.commerce_provider_markets pm
    where pm.provider = v_provider and pm.market = v_gate.market and pm.currency = v_currency and pm.enabled) then
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
    v_price.usd_reference_minor, v_product.credit_amount, v_reference, v_provider, 'created', v_gate.mode, v_key
  )
  on conflict (idempotency_key) do nothing
  returning * into v_order;

  if v_order.id is null then
    -- A concurrent request with the same key won; resolve to its order.
    return public.commerce_create_credit_order_for_provider(p_product_id, p_currency, p_idempotency_key, p_provider);
  end if;

  insert into public.commerce_payment_attempts (order_id, provider, provider_reference, expected_amount_minor, expected_currency)
  values (v_order.id, v_provider, v_order.tempa_reference, v_order.amount_minor, v_order.currency);

  return jsonb_build_object('order_id', v_order.id, 'reference', v_order.tempa_reference,
    'product', v_order.product_title_snapshot, 'credits', v_order.credits_to_grant,
    'currency', v_order.currency, 'amount_minor', v_order.amount_minor,
    'mode', v_order.payment_mode, 'state', v_order.state, 'replayed', false, 'provider', v_order.provider);
end;
$function$;

revoke all on function public.commerce_create_credit_order_for_provider(uuid,text,text,text) from public, anon;
grant execute on function public.commerce_create_credit_order_for_provider(uuid,text,text,text) to authenticated;
commit;
