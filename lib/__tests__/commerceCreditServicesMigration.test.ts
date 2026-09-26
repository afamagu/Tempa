// Commerce Checkpoint 2 — the SQL contract pinned against the tracked
// migration text (CI cannot run Postgres). Behaviour, including the
// multi-connection concurrency proof, was run on a genuine PostgreSQL 17
// server and on PGlite over the production-faithful fixture — see the PR.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const sql = read('2026-10-21-commerce-credit-services.sql')
const verify = read('2026-10-21-commerce-credit-services-verify.sql')
const code = (s: string) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
const body = code(sql)
const fn = (name: string) => {
  const start = body.indexOf(`create or replace function ${name}(`)
  expect(start).toBeGreaterThan(-1)
  return body.slice(start, body.indexOf('$function$;', start))
}

describe('2026-10-21 commerce credit services migration', () => {
  it('is one forward-only transaction, not yet executed; does not touch applied migrations or send RPCs', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
    expect(body).not.toMatch(/create or replace function public\.(write_letter|reply_to_letter|publish_dispatch|publish_official_dispatch|update_dispatch|close_my_account|current_account_status)\(/)
    expect(body).not.toMatch(/drop table|drop column|alter table public\.(letters|dispatches|letter_postcards|dispatch_postcards|postcard_catalog)\b/i)
    const replaced = [...body.matchAll(/create or replace function ([\w.]+)\(/g)].map((m) => m[1])
    expect(replaced.every((f) => f.startsWith('tempa_private.commerce_') || f.startsWith('public.commerce_') || f.startsWith('public.admin_'))).toBe(true)
  })

  it('never switches anything on', () => {
    expect(body).not.toMatch(/update public\.commerce_settings/i)
    expect(body).not.toMatch(/update public\.commerce_payment_providers/i)
    expect(body).not.toMatch(/insert into public\.commerce_(settings|payment_providers|credit_prices|products)\b/i)
  })

  it('bundles contain durable entitlements only', () => {
    expect(fn('tempa_private.commerce_bundle_items_guard')).toContain("where p.id = new.item_product_id and p.entitlement_model = 'durable'")
    expect(fn('tempa_private.commerce_bundle_quote')).toContain("p.entitlement_model <> 'durable'")
  })

  it('every spend path: authenticate + account state + switches, THEN lock the wallet, THEN idempotency', () => {
    const gate = fn('tempa_private.commerce_require_spender')
    expect(gate).toContain("if public.current_account_status() is distinct from 'active' then")
    expect(gate).toContain('if not coalesce(v_settings.commerce_enabled and v_settings.credit_spend_enabled, false) then')
    expect(gate).toContain("if p_gift and not coalesce(v_settings.gifts_enabled, false) then")
    for (const name of ['public.commerce_purchase_product', 'public.commerce_purchase_bundle', 'public.commerce_purchase_gift']) {
      const f = fn(name)
      const a = f.indexOf('tempa_private.commerce_require_spender(')
      const b = f.indexOf('tempa_private.commerce_lock_wallet(v_uid)')
      const c = f.indexOf('where user_id = v_uid and idempotency_key = v_key')
      expect(a).toBeGreaterThan(-1)
      expect(b).toBeGreaterThan(a)
      expect(c).toBeGreaterThan(b)
      expect(f).toContain("perform tempa_private.commerce_raise('idempotency_conflict')")
      expect(f).toContain("perform tempa_private.commerce_raise('insufficient_credits')")
    }
    expect(fn('tempa_private.commerce_lock_wallet')).toContain('select balance into v_balance from public.commerce_wallets where user_id = p_user_id for update;')
  })

  it('purchase inputs are ids + an idempotency key; the price is resolved server-side and fails closed', () => {
    expect(body).toContain('create or replace function public.commerce_purchase_product(p_product_id uuid, p_idempotency_key text)')
    expect(body).toContain('create or replace function public.commerce_purchase_bundle(p_bundle_product_id uuid, p_idempotency_key text)')
    const resolver = fn('tempa_private.commerce_resolve_credit_price')
    expect(resolver).toContain('if v_count <> 1 then')
    expect(resolver).toContain("perform tempa_private.commerce_raise('complimentary')")
    expect(resolver).toContain('cp.effective_from <= now() and (cp.effective_to is null or cp.effective_to > now())')
    expect(fn('public.commerce_purchase_product')).toContain("v_product.entitlement_model <> 'durable'")
    expect(fn('public.commerce_purchase_product')).toContain("'status', 'already_owned'")
  })

  it('bundle completion price = allocations of items not owned, never individual prices', () => {
    const quote = fn('tempa_private.commerce_bundle_quote')
    expect(quote).toContain('sum(i.allocation_credits) filter (where not tempa_private.commerce_owns(p_user_id, i.item_product_id))')
    expect(quote).not.toContain('commerce_credit_prices')
    const buy = fn('public.commerce_purchase_bundle')
    expect(buy).toContain("'status', 'all_owned'")
    expect(buy).toContain('where pi.purchase_id = v_purchase_id and not pi.already_owned;')
  })

  it('Gift primitive: gifts switch, established unblocked correspondence, recipient state + preference, no entitlement, hidden until delivery', () => {
    const g = fn('public.commerce_purchase_gift')
    expect(g).toContain('tempa_private.commerce_require_spender(true)')
    expect(g).toContain("v_corr.status <> 'active' or v_corr.established_at is null")
    expect(g).toContain('tempa_private.is_correspondence_blocked_pair(v_uid, v_recipient)')
    expect(g).toContain('gp.gifts_enabled from public.commerce_gift_preferences gp where gp.user_id = v_recipient')
    expect(g).not.toContain('insert into public.commerce_entitlements')
    expect(g).not.toMatch(/'delivered'/)
    expect(g).not.toMatch(/dedication/)
  })

  it('admin Credit operations: admin role, reason, audit, ledger helper only, never below zero; not switch-gated, no keyword accounting', () => {
    const op = fn('tempa_private.commerce_admin_credit_op')
    expect(op).toContain("if v_actor is null or not public.is_staff('admin') then")
    expect(op).toContain("perform tempa_private.commerce_raise('reason_required')")
    expect(op).not.toMatch(/commerce_settings|commerce_enabled/)
    expect(op).not.toMatch(/v_reason\s*~/)
    expect(op).not.toMatch(/refund|chargeback|dispute/i)
    expect(op).toContain("perform tempa_private.commerce_raise('adjustment_below_zero')")
    expect(op).toContain('insert into public.admin_audit_log (')
    expect(op).toContain("tempa_private.commerce_append_ledger(p_user_id, p_delta, p_entry_type, 'admin', null, v_key, v_reason, v_actor)")
    expect(op).not.toMatch(/update public\.commerce_wallets/)
    expect(fn('public.admin_grant_credits')).toContain("if p_kind not in ('promotional_grant', 'complimentary_grant') then")
  })

  it('premium Postcard enforcement: BEFORE triggers on both snapshot tables, actor from the parent row, no staff bypass', () => {
    const t = fn('tempa_private.commerce_enforce_postcard_ownership')
    expect(t).toContain('select l.sender_id into v_member from public.letters l where l.id = new.letter_id;')
    expect(t).toContain('select d.author_id into v_member from public.dispatches d where d.id = new.dispatch_id;')
    expect(t).not.toContain('auth.uid()')
    expect(t).not.toMatch(/is_staff|staff_roles/)
    expect(fn('tempa_private.commerce_postcard_send_allowed')).toContain('select p.is_complimentary or tempa_private.commerce_owns(p_member, p.id)')
    expect(fn('tempa_private.commerce_owns')).toContain("e.state = 'active'")
    for (const table of ['letter_postcards', 'dispatch_postcards']) {
      expect(body).toContain(`before insert or update of postcard_version_id on public.${table}\n  for each row execute function tempa_private.commerce_enforce_postcard_ownership();`)
    }
  })

  it('privileges: member RPCs to authenticated only; helpers private; ledger rows read only via the history RPC', () => {
    expect(body).toContain('revoke select on public.commerce_ledger_entries from authenticated;')
    expect(body).toContain("execute format('revoke all on function %s from public, anon', f);")
    expect(body).toContain("execute format('grant execute on function %s to authenticated', f);")
    for (const helper of ['commerce_require_spender(boolean)', 'commerce_lock_wallet(uuid)', 'commerce_resolve_credit_price(uuid)', 'commerce_admin_credit_op(uuid, bigint, text, text, text)', 'commerce_enforce_postcard_ownership()']) {
      expect(body).toContain(`revoke all on function tempa_private.${helper} from public, anon, authenticated;`)
    }
    expect(body).not.toMatch(/grant (insert|update|delete|all)[^;]* on public\.commerce_/i)
  })

  it('history never exposes internal ledger fields', () => {
    const h = fn('public.commerce_my_credit_history')
    expect(h).not.toMatch(/l\.(reason|actor_id|idempotency_key|source_id)\s*,/)
    expect(h).toContain('where l.user_id = auth.uid()')
    expect(h).toContain('order by l.created_at desc, l.id desc')
  })

  it('verifier is one read-only SELECT with the required checks', () => {
    const v = code(verify).replace(/'(?:[^']|'')*'/g, "''")
    expect(v).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b\s+(into|table|function|from|on|public|trigger)/i)
    expect((v.match(/;/g) ?? []).length).toBe(1)
    for (const col of ['all_functions_exist', 'definer_and_search_path_pinned', 'member_rpcs_authenticated_only', 'private_helpers_not_client_callable',
      'spend_paths_gated_and_serialised', 'spend_switches_and_account_state_required', 'price_resolution_fails_closed', 'bundle_items_durable_only',
      'postcard_send_trigger_on_both_tables', 'postcard_actor_from_parent_no_bypass', 'complimentary_passes_premium_needs_active_entitlement',
      'admin_ops_gated_audited_ledger_only', 'admin_ops_not_switch_gated_no_keyword_accounting', 'no_client_financial_writes', 'ledger_read_only_via_rpc', 'ledger_still_append_only',
      'wallet_matches_ledger', 'all_commercial_switches_off', 'providers_disabled', 'overall_pass']) {
      expect(verify).toContain(col)
    }
    expect(verify).not.toMatch(/count\(\*\) from public\.commerce_(purchases|ledger_entries)\) = 0/)
  })
})
