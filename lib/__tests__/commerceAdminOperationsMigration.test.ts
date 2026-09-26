// Commerce Checkpoint 4 — Admin → Commerce operations, pinned against the
// tracked migration text. Behaviour proven on PGlite and a genuine
// PostgreSQL 17 server over the production-faithful fixture (see the PR).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const sql = read('2026-10-23-commerce-admin-operations.sql')
const verify = read('2026-10-23-commerce-admin-operations-verify.sql')
const body = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
const fns = [...body.matchAll(/create or replace function ([\w.]+)\(/g)].map((m) => m[1])
const fn = (name: string) => {
  const start = body.indexOf(`create or replace function ${name}(`)
  expect(start).toBeGreaterThan(-1)
  return body.slice(start, body.indexOf('$function$;', start))
}

describe('2026-10-23 commerce admin operations', () => {
  it('one forward-only transaction, recorded as applied; no applied function redefined', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: APPLIED TO PRODUCTION 2026-09-27')
    expect(sql).not.toContain('NOT EXECUTED')
    expect(fns.every((f) => f.startsWith('public.admin_commerce_') || f.startsWith('tempa_private.commerce_'))).toBe(true)
    for (const applied of ['commerce_append_ledger', 'commerce_bundle_items_guard', 'commerce_price_row_guard', 'commerce_require_spender', 'commerce_purchase_product', 'admin_grant_credits', 'admin_adjust_credits']) {
      expect(fns.some((f) => f.endsWith(`.${applied}`))).toBe(false)
    }
  })

  it('enables nothing: no settings, provider, wallet or ledger writes', () => {
    expect(body).not.toMatch(/(update|insert into) public\.commerce_(settings|payment_providers|wallets|ledger_entries)\b/)
  })

  it('every public RPC is admin-gated first, SECURITY DEFINER with a pinned search_path', () => {
    for (const f of fns.filter((x) => x.startsWith('public.'))) {
      const b = fn(f)
      expect(b, f).toContain('security definer')
      expect(b, f).toContain("set search_path to 'pg_catalog'")
      expect(b, f).toContain('perform tempa_private.commerce_require_admin();')
    }
    expect(fn('tempa_private.commerce_require_admin')).toContain("not public.is_staff('admin')")
  })

  it('pure helpers stay invoker functions (no needless SECURITY DEFINER)', () => {
    for (const f of ['tempa_private.commerce_slugify', 'tempa_private.commerce_is_human_label']) {
      expect(fn(f)).not.toContain('security definer')
      expect(fn(f)).toContain('immutable')
      expect(fn(f)).toContain("set search_path to 'pg_catalog'")
    }
  })

  it('every mutation writes the admin audit log', () => {
    const reads = /admin_commerce_(overview|catalog|product|taxonomy|collections|pricing|member|entitlements|orders|audit)$/
    for (const f of fns.filter((x) => x.startsWith('public.') && !reads.test(x))) {
      expect(fn(f), f).toContain('perform tempa_private.commerce_audit(')
    }
  })

  it('publishing is readiness-gated; new products are drafts; review holds block publish', () => {
    expect(fn('public.admin_commerce_set_lifecycle')).toContain("if p_state = 'published' and not tempa_private.commerce_is_ready(p_product_id) then")
    expect(fn('public.admin_commerce_create_product')).toContain("'draft'")
    const r = fn('tempa_private.commerce_product_readiness')
    expect(r).toContain("p.rights_review_state in ('not_required', 'approved')")
    expect(r).toContain("p.cultural_review_state in ('not_required', 'approved')")
    expect(r).toContain("'key', 'price'")
    expect(fn('public.admin_commerce_update_product')).toContain("perform tempa_private.commerce_raise('unpublish_first')")
  })

  it('prices are never edited in place: new rows only, conflicts explained', () => {
    const set = fn('public.admin_commerce_set_price')
    expect(set).not.toMatch(/set credit_amount|set amount_minor/)
    expect(set).toContain("when exclusion_violation then perform tempa_private.commerce_raise('price_overlap')")
    expect(fn('public.admin_commerce_end_price')).not.toMatch(/set credit_amount|set amount_minor/)
  })

  it('taxonomy: a published term needs a human label', () => {
    expect(fn('public.admin_commerce_save_term')).toContain("perform tempa_private.commerce_raise('needs_human_label')")
    expect(fn('tempa_private.commerce_is_human_label')).toContain("!~ '^[A-Z]{2,3}$'")
  })

  it('entitlements: explicit reasoned admin_grant of durable products only; no revoke; no staff bypass', () => {
    const g = fn('public.admin_commerce_grant_entitlement')
    expect(g).toContain("perform tempa_private.commerce_raise('reason_required')")
    expect(g).toContain("p.entitlement_model <> 'durable'")
    expect(g).toContain("'admin_grant'")
    expect(g).toContain("p_purpose not in ('official_use', 'support', 'compensation', 'other')")
    expect(body).not.toMatch(/update public\.commerce_entitlements|delete from public\.commerce_entitlements/)
    expect(body).not.toMatch(/is_staff\([^)]*\)[^;]*commerce_owns|staff_roles[^;]*commerce_entitlements/)
  })

  it('internal review columns are added but never granted to members', () => {
    expect(body).toContain('add column if not exists cultural_review_state')
    expect(body).toContain('grant select (display_order) on public.commerce_products to authenticated;')
    expect(body).not.toMatch(/grant select \([^)]*(cultural|rights_review)/)
  })

  it('verifier is one read-only SELECT with the required checks', () => {
    const v = verify.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').replace(/'(?:[^']|'')*'/g, "''")
    expect(v).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b\s+(into|table|function|from|on|public|trigger)/i)
    expect((v.match(/;/g) ?? []).length).toBe(1)
    for (const col of ['all_functions_exist', 'definer_and_search_path_pinned', 'pure_helpers_invoker_immutable_pinned', 'every_rpc_admin_gated',
      'admin_gate_is_admin_role', 'client_privileges_correct', 'every_mutation_audited', 'no_switch_wallet_or_ledger_writes',
      'publish_requires_readiness', 'entitlement_grant_explicit', 'no_entitlement_revoke_or_delete', 'published_terms_need_human_labels',
      'review_fields_internal_only', 'no_client_table_writes', 'all_commercial_switches_off', 'providers_disabled', 'overall_pass']) {
      expect(verify).toContain(col)
    }
  })
})
