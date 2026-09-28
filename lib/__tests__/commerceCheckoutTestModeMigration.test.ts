// Commerce Checkpoint 5 — fiat → Credits checkout (Flutterwave TEST MODE),
// pinned against the tracked migration text. Behaviour proven on PGlite and
// a genuine PostgreSQL 17 server over the production-faithful fixture,
// including webhook/return races on two connections (see the PR).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const sql = read('2026-10-26-commerce-checkout-test-mode.sql')
const verify = read('2026-10-26-commerce-checkout-test-mode-verify.sql')
const body = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
const fn = (name: string) => {
  const start = body.indexOf(`create or replace function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return body.slice(start, body.indexOf('$function$;', start))
}

describe('2026-10-26 commerce checkout (test mode)', () => {
  it('is one transaction and never edits an applied migration (forward-only: adds columns/tables/functions only)', () => {
    expect(body.trim().startsWith('begin;')).toBe(true)
    expect(body.trim().endsWith('commit;')).toBe(true)
    expect(body).not.toMatch(/drop table|drop column|alter table public\.commerce_ledger_entries|truncate/i)
  })

  it('enables nothing: no switch, provider, market or tester is written', () => {
    expect(body).not.toMatch(/update public\.commerce_settings|update public\.commerce_payment_providers/i)
    expect(body).not.toMatch(/insert into public\.commerce_(provider_markets|checkout_testers)/i)
    expect(body).toMatch(/enabled boolean not null default false/)
  })

  it("an eligible market is an exact country — '*' can never authorize a sale", () => {
    const table = body.slice(body.indexOf('create table if not exists public.commerce_provider_markets'), body.indexOf(');', body.indexOf('create table if not exists public.commerce_provider_markets')))
    expect(table).toContain("market text not null check (market ~ '^[A-Z]{2}$')")
    expect(table).not.toContain("'*'")
  })

  it('the gate runs account → provider → live refusal → switches/tester → market, and returns test mode', () => {
    const gate = fn('tempa_private.commerce_checkout_gate')
    const order = ['account_unavailable', "'checkout_disabled'", 'live_unavailable', 'commerce_checkout_testers', 'market_unsupported']
      .map((s) => gate.indexOf(s))
    expect(order.every((i) => i > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(gate).toContain("mode := 'test'")
    expect(gate).toContain('v_settings.commerce_enabled and v_settings.fiat_checkout_enabled')
  })

  it('order creation checks eligibility and currency BEFORE resolving any price; exact market beats the * fallback', () => {
    const create = fn('public.commerce_create_credit_order')
    expect(create.indexOf('commerce_checkout_gate')).toBeLessThan(create.indexOf('commerce_resolve_pack_price'))
    expect(create.indexOf('currency_unsupported')).toBeLessThan(create.indexOf('commerce_resolve_pack_price'))
    const resolve = fn('tempa_private.commerce_resolve_pack_price')
    expect(resolve).toContain("pb.market in (p_market, '*')")
    expect(resolve).toContain('order by (pb.market = p_market) desc')
    expect(resolve).toContain("p.product_type = 'credit_pack'")
    expect(resolve).toContain("p.lifecycle_state = 'published'")
  })

  it('the client never supplies an amount, Credits or a price; orders snapshot the price row and are idempotent', () => {
    expect(body).toMatch(/create or replace function public\.commerce_create_credit_order\(p_product_id uuid, p_currency text, p_idempotency_key text\)/)
    const create = fn('public.commerce_create_credit_order')
    expect(create).toContain('v_price.amount_minor')
    expect(create).toContain('v_product.credit_amount')
    expect(create).toContain('idempotency_conflict')
    expect(create).toContain('on conflict (idempotency_key) do nothing')
    expect(create).toContain('too_many_orders')
  })

  it('settlement is service-role only, replay-safe, locks the order, matches amount+currency exactly, and credits once via the ledger helper', () => {
    const settle = fn('public.commerce_settle_payment')
    expect(settle).toContain('on conflict (provider, provider_event_id) do nothing')
    expect(settle).toContain('for update')
    expect(settle).toContain('p_amount_minor is distinct from v_attempt.expected_amount_minor or p_currency is distinct from v_attempt.expected_currency')
    expect(settle).toMatch(/commerce_append_ledger\(\s*v_order\.user_id, v_order\.credits_to_grant, 'credit_purchase', 'order', v_order\.id, 'order:' \|\| v_order\.id::text\)/)
    expect(settle).not.toMatch(/update public\.commerce_wallets|insert into public\.commerce_ledger_entries/)
    expect(body).toContain('revoke all on function public.commerce_settle_payment(text, text, text, text, bigint, text, text, text, text) from public, anon, authenticated;')
    expect(body).toContain('grant execute on function public.commerce_settle_payment(text, text, text, text, bigint, text, text, text, text) to service_role;')
  })

  it('failed/cancelled never credit; a paid order is never credited again', () => {
    const settle = fn('public.commerce_settle_payment')
    const failed = settle.slice(settle.indexOf("elsif p_status in ('failed', 'cancelled')"), settle.indexOf('else', settle.indexOf("elsif p_status in ('failed', 'cancelled')") + 40))
    expect(failed).not.toContain('commerce_append_ledger')
    const paid = settle.slice(settle.indexOf("if v_order.state = 'paid' then"), settle.indexOf("elsif p_status = 'successful'"))
    expect(paid).not.toContain('commerce_append_ledger')
    expect(paid).toContain("v_outcome := 'duplicate'")
  })

  it('every function is SECURITY DEFINER with a pinned search_path; private helpers are nobody’s', () => {
    for (const name of ['tempa_private.commerce_checkout_gate', 'tempa_private.commerce_resolve_pack_price', 'public.commerce_credit_pack_offers',
      'public.commerce_my_order', 'public.commerce_member_context', 'public.commerce_create_credit_order', 'public.commerce_settle_payment',
      'public.admin_commerce_orders', 'public.admin_commerce_checkout_config']) {
      const f = fn(name)
      expect(f, name).toContain('security definer')
      expect(f, name).toContain("set search_path to 'pg_catalog'")
    }
    expect(body).toContain('revoke all on function tempa_private.commerce_checkout_gate(uuid, text) from public, anon, authenticated;')
    expect(body).toContain('revoke all on function tempa_private.commerce_resolve_pack_price(uuid, text, text) from public, anon, authenticated;')
  })

  it('member context keeps every existing key and adds checkout_available', () => {
    const ctx = fn('public.commerce_member_context')
    for (const key of ["'spend_enabled'", "'gifts_enabled'", "'checkout_enabled'", "'balance'", "'checkout_available'"]) expect(ctx).toContain(key)
  })

  it('admin reads stay admin-gated and expose no secrets', () => {
    for (const name of ['public.admin_commerce_orders', 'public.admin_commerce_checkout_config']) {
      expect(fn(name)).toContain('perform tempa_private.commerce_require_admin();')
      expect(fn(name)).not.toMatch(/payload_sha256|secret|FLWSECK/i)
    }
  })

  it('the verifier is read-only and separates structural guarantees from the right-after-migration state', () => {
    // Code only: comments and quoted literals (regex patterns it searches for) removed.
    const code = verify.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').replace(/'(?:[^']|'')*'/g, "''")
    expect(code.trim()).toMatch(/^with /)
    expect(code).not.toMatch(/\b(insert\s+into|update\s+\w+|delete\s+from|alter|create|drop|grant|revoke|truncate)\b/i)
    expect(code.trim().split(';').filter((s) => s.trim()).length).toBe(1)
    const overall = verify.slice(verify.lastIndexOf('select *,'))
    for (const c of ['execute_privileges_correct', 'star_market_never_eligible', 'eligibility_before_price', 'credits_only_via_ledger_helper', 'settlement_replay_safe', 'no_switch_writes', 'all_commercial_switches_off', 'live_mode_off']) {
      expect(overall, c).toContain(c)
    }
    expect(overall).not.toContain('no_testers_right_after_migration')
  })
})
