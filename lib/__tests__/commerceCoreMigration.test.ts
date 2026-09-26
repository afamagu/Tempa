// Commerce Checkpoint 1 — the SQL contract is pinned against the tracked
// migration text (CI cannot run Postgres). Behaviour was proven on real
// PostgreSQL (PGlite + btree_gist) on top of the production-faithful
// lifecycle fixture (2026-10-16/18/19 applied), including account closure
// with commerce data present — see the PR description.

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
  it('is one forward-only transaction, recorded as applied, redefining no existing function', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: APPLIED TO PRODUCTION 2026-09-26')
    expect(sql).not.toContain('NOT EXECUTED')
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
    for (const col of ['credit_amount bigint', 'amount_minor bigint', 'usd_reference_minor bigint', 'balance bigint', 'delta bigint',
      'credits_to_grant bigint', 'credits_charged bigint', 'allocation_credits bigint', 'credits_adjusted bigint']) {
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
    expect(body).toContain("raise exception 'Not enough Credits.'")
    expect(body).toContain('revoke all on function tempa_private.commerce_append_ledger(uuid, bigint, text, text, uuid, text, text, uuid) from public, anon, authenticated;')
    expect(body).not.toContain('p_allow_negative')
    expect(body).not.toMatch(/profiles[^;]*credit|credit_balance/i)
  })

  it('ledger idempotency replays only the identical operation, including source type and source id', () => {
    expect(body).toContain(`    if v_existing.user_id = p_user_id
       and v_existing.delta = p_delta
       and v_existing.entry_type = p_entry_type
       and v_existing.source_type = p_source_type
       and v_existing.source_id is not distinct from p_source_id then
      return v_existing;
    end if;
    raise exception 'Idempotency key reused for a different ledger operation.'`)
  })

  it('explicit accounting vocabulary: each type has a fixed sign and source; only refund/chargeback removals may go negative', () => {
    for (const t of ['purchase_refund_removal', 'chargeback_removal', 'chargeback_restoration', 'product_credit_refund']) expect(body).toContain(`'${t}'`)
    expect(body).not.toMatch(/'refund_reversal'|'chargeback_reversal'/)
    expect(body).toContain("(entry_type in ('purchase_refund_removal', 'chargeback_removal', 'chargeback_restoration') and source_type = 'payment_adjustment' and source_id is not null)")
    expect(body).toContain("(entry_type in ('product_spend', 'bundle_spend', 'gift_spend', 'product_credit_refund') and source_type = 'purchase' and source_id is not null)")
    expect(body).toContain("if v_balance + p_delta < 0 and p_entry_type not in ('purchase_refund_removal', 'chargeback_removal') then")
  })

  it('payment providers are a registry, never a hard-coded list; nothing is enabled', () => {
    expect(body).not.toMatch(/check \(provider in/)
    expect((body.match(/provider text not null references public\.commerce_payment_providers\(code\)/g) ?? []).length).toBe(3)
    expect(body).toContain("insert into public.commerce_payment_providers (code, display_name) values ('flutterwave', 'Flutterwave')")
    expect(body).toContain('checkout_enabled boolean not null default false')
    expect(body).toContain('live_mode_enabled boolean not null default false')
  })

  it('history is immutable: product versions, published prices, bundle versions, order and purchase snapshots', () => {
    expect(body).toContain("if (to_jsonb(new) - 'is_current') is distinct from (to_jsonb(old) - 'is_current') then")
    for (const trg of ['commerce_product_versions_immutable', 'commerce_credit_prices_guard', 'commerce_price_books_guard', 'commerce_bundle_versions_guard',
      'commerce_bundle_items_guard', 'commerce_order_snapshot_guard', 'commerce_purchase_price_guard', 'commerce_products_identity_guard']) {
      expect(body).toContain(`create trigger ${trg} `)
    }
  })

  it('deterministic prices: no overlapping published windows, one market per price-book row, bundles priced by fixed version allocations', () => {
    expect(body).toContain('create extension if not exists btree_gist with schema extensions;')
    for (const c of ['commerce_credit_prices_no_overlap', 'commerce_price_books_no_overlap', 'commerce_bundle_versions_no_overlap']) {
      expect(body).toMatch(new RegExp(`constraint ${c} exclude using gist \\([\\s\\S]*?\\) where \\(state = 'published'\\)`))
    }
    expect(body).toContain("market text not null check (market ~ '^[A-Z]{2}$' or market = '*')")
    expect(body).not.toContain('market_country_codes')
    expect(body).not.toContain('commerce_bundle_items (')
    expect(body).toContain('allocation_credits bigint not null check (allocation_credits > 0)')
    expect(body).toContain('already_owned boolean not null default false')
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

  it('existing Postcards are backfilled as published Complimentary; Postcards added later are DRAFT products', () => {
    expect(body).toContain("'postcard', c.title,\n       case when c.is_active then 'published' else 'inactive' end, true, 'durable', c.key")
    expect(body).toMatch(/after insert on public\.postcard_catalog/)
    const start = body.indexOf('commerce_postcard_product_for_new_catalog_row()\nreturns trigger')
    const trigger = body.slice(start, body.indexOf('revoke all on function tempa_private.commerce_postcard_product_for_new_catalog_row', start))
    expect((trigger.match(/'postcard', new\.title, 'draft', true, 'durable', new\.key/g) ?? []).length).toBe(2)
    expect(trigger).not.toContain("'published'")
    expect(trigger).not.toContain('is_active')
  })

  it('verifier is one read-only SELECT with overall_pass', () => {
    const v = code(verify).replace(/'(?:[^']|'')*'/g, "''")
    expect(v).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b\s+(into|table|function|from|on|public|trigger)/i)
    expect((v.match(/;/g) ?? []).length).toBe(1)
    for (const col of ['no_client_write_privileges', 'money_columns_bigint', 'ledger_append_only_trigger', 'append_ledger_locks_wallet',
      'no_commerce_fk_to_profiles', 'financial_rows_never_cascade_deleted', 'every_postcard_has_product', 'idempotency_matches_source',
      'ledger_vocabulary_explicit', 'providers_registry_neutral', 'price_windows_exclusive', 'price_book_single_market',
      'history_guards_present', 'new_postcards_default_draft', 'overall_pass']) {
      expect(verify).toContain(col)
    }
  })
})
