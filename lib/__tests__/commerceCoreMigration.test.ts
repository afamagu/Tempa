// Commerce Checkpoint 1 — the SQL contract is pinned against the tracked
// migration text (CI cannot run Postgres). Behaviour was proven on real
// PostgreSQL (PGlite) on top of the production-faithful lifecycle fixture
// (2026-10-16/18/19 applied), including account closure with commerce
// data present — see the PR description.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const sql = read('2026-10-20-commerce-core.sql')
const verify = read('2026-10-20-commerce-core-verify.sql')
const code = (s: string) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
const body = code(sql)

describe('2026-10-20 commerce core migration', () => {
  it('is one forward-only transaction, not yet executed, redefining no existing function', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
    const replaced = [...body.matchAll(/create or replace function ([\w.]+)\(/g)].map((m) => m[1])
    expect(replaced.every((f) => f.startsWith('tempa_private.commerce_'))).toBe(true)
    expect(body).not.toMatch(/drop table|drop column|alter table public\.(letters|profiles|postcard_catalog|postcard_versions|letter_postcards|dispatch_postcards)\b/i)
  })

  it('enables no money movement: every commercial switch defaults off, no member-callable spend/checkout RPC', () => {
    for (const col of ['commerce_enabled', 'credit_spend_enabled', 'fiat_checkout_enabled', 'live_payments_enabled', 'gifts_enabled', 'home_shelf_enabled']) {
      expect(body).toContain(`${col} boolean not null default false`)
    }
    expect(body).not.toMatch(/create or replace function public\./)
    expect(body).not.toMatch(/grant execute/i)
  })

  it('money is integer: Credits and fiat minor units are bigint; no float types', () => {
    for (const col of ['credit_amount bigint', 'amount_minor bigint', 'usd_reference_minor bigint', 'balance bigint', 'delta bigint', 'credits_to_grant bigint', 'credits_charged bigint']) {
      expect(body).toContain(col)
    }
    expect(body).not.toMatch(/\b(real|double precision|float\d?|money)\b/i)
    expect(body).toContain("check (currency ~ '^[A-Z]{3}$')")
    expect(body).toContain("check (currency <> 'USD' or amount_minor = usd_reference_minor)")
  })

  it('the ledger is append-only and only moved by the locked, idempotent internal function', () => {
    expect(body).toMatch(/before update or delete on public\.commerce_ledger_entries/)
    expect(body).toMatch(/before truncate on public\.commerce_ledger_entries/)
    expect(body).toContain('select balance into v_balance from public.commerce_wallets where user_id = p_user_id for update;')
    expect(body).toContain("raise exception 'Idempotency key reused for a different ledger movement.'")
    expect(body).toContain("raise exception 'Not enough Credits.'")
    expect(body).toContain('revoke all on function tempa_private.commerce_append_ledger(uuid, bigint, text, text, uuid, text, text, uuid, boolean) from public, anon, authenticated;')
    expect(body).not.toMatch(/profiles[^;]*credit|credit_balance/i)
  })

  it('clients never write commerce tables; members read only their own financial rows', () => {
    expect(body).toContain("execute format('revoke all on public.%I from public, anon, authenticated', t);")
    expect(body).not.toMatch(/grant (insert|update|delete|all)[^;]* on public\.commerce_/i)
    expect(body).not.toMatch(/create policy \w+ on public\.commerce_\w+ for (insert|update|delete|all)/i)
    for (const t of ['commerce_wallets', 'commerce_ledger_entries', 'commerce_purchases', 'commerce_entitlements', 'commerce_orders']) {
      expect(body).toMatch(new RegExp(`on public\\.${t} for select to authenticated using \\(user_id = auth\\.uid\\(\\)\\)`))
    }
    expect(body).toContain("using (sender_id = auth.uid() or (recipient_id = auth.uid() and state = 'delivered'));")
  })

  it('lifecycle-safe: member references use auth.users with no cascade, never public.profiles', () => {
    expect(body).not.toMatch(/references public\.profiles/)
    expect(body).not.toMatch(/references auth\.users\(id\) on delete cascade/)
  })

  it('existing Postcards are backfilled as Complimentary and new ones stay covered', () => {
    expect(body).toContain("'postcard', c.title,\n       case when c.is_active then 'published' else 'inactive' end, true, 'durable', c.key")
    expect(body).toMatch(/after insert on public\.postcard_catalog/)
  })

  it('verifier is one read-only SELECT with overall_pass', () => {
    const v = code(verify).replace(/'(?:[^']|'')*'/g, "''")
    expect(v).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b\s+(into|table|function|from|on|public|trigger)/i)
    expect((v.match(/;/g) ?? []).length).toBe(1)
    for (const col of ['no_client_write_privileges', 'money_columns_bigint', 'ledger_append_only_trigger', 'append_ledger_locks_wallet',
      'no_commerce_fk_to_profiles', 'financial_rows_never_cascade_deleted', 'every_postcard_has_product', 'overall_pass']) {
      expect(verify).toContain(col)
    }
  })
})
