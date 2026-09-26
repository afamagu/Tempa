// Commerce Checkpoint 3 — catalogue read hardening. Pinned against the
// tracked migration text; behaviour proven on PGlite and a genuine
// PostgreSQL 17 server over the production-faithful fixture (see the PR).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const sql = read('2026-10-22-commerce-catalogue-read-hardening.sql')
const verify = read('2026-10-22-commerce-catalogue-read-hardening-verify.sql')
const body = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

describe('2026-10-22 commerce catalogue read hardening', () => {
  it('is one forward-only transaction, not yet executed; privileges + one read-only function only', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
    expect(body).not.toMatch(/create table|alter table|drop |create policy|insert into|update public\.|delete from/i)
    expect([...body.matchAll(/create or replace function ([\w.]+)\(/g)].map((m) => m[1])).toEqual(['public.commerce_member_context'])
  })

  it('replaces table-wide SELECT with catalogue columns; internal columns are not granted', () => {
    for (const t of ['commerce_products', 'commerce_product_versions', 'commerce_credit_prices', 'commerce_collections', 'commerce_bundle_versions', 'commerce_purchases']) {
      expect(body).toContain(`revoke select on public.${t} from authenticated;`)
    }
    const grants = [...body.matchAll(/grant select \(([^)]*)\)\s*on public\.(\w+) to authenticated;/g)]
    expect(grants.map((g) => g[2]).sort()).toEqual(['commerce_bundle_versions', 'commerce_collections', 'commerce_credit_prices', 'commerce_product_versions', 'commerce_products', 'commerce_purchases'])
    for (const [, cols] of grants) {
      expect(cols).not.toMatch(/rights_review|metadata|created_by|idempotency_key|ledger_entry_id|credit_price_id/)
    }
    expect(body).not.toMatch(/grant (insert|update|delete|all)/i)
  })

  it('member context: own balance + member-facing switch states only; enables nothing', () => {
    expect(body).toContain("'spend_enabled', coalesce(v_settings.commerce_enabled and v_settings.credit_spend_enabled, false)")
    expect(body).toContain('where user_id = auth.uid()')
    expect(body).not.toMatch(/updated_by|update public\.commerce_settings/)
    expect(body).toContain('revoke all on function public.commerce_member_context() from public, anon;')
    expect(body).toContain('grant execute on function public.commerce_member_context() to authenticated;')
  })

  it('verifier is one read-only SELECT with the required checks', () => {
    const v = verify.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').replace(/'(?:[^']|'')*'/g, "''")
    expect(v).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b\s+(into|table|function|from|on|public|trigger)/i)
    expect((v.match(/;/g) ?? []).length).toBe(1)
    for (const col of ['internal_columns_not_readable', 'catalogue_columns_readable', 'no_table_wide_select', 'no_client_writes',
      'member_context_definer_authenticated_only', 'member_context_own_balance_no_admin_fields', 'all_commercial_switches_off',
      'providers_disabled', 'overall_pass']) {
      expect(verify).toContain(col)
    }
  })
})
