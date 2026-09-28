import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  COMMERCE_ERROR_COPY,
  CREDIT_HISTORY_LABELS,
  commerceError,
  getCreditBalance,
  getCreditHistory,
  newIdempotencyKey,
  purchaseBundle,
  purchaseGift,
  purchaseProduct,
  toPurchaseResult,
} from './commerce'

const SQL = ['2026-10-21-commerce-credit-services.sql', '2026-10-26-commerce-checkout-test-mode.sql']
  .map((f) => readFileSync(path.join(__dirname, '..', 'docs', 'sql', f), 'utf8'))
  .join('\n')

const fake = (result: { data?: unknown; error?: { message: string; code?: string } | null }) => {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe('commerce error codes', () => {
  it('every code the SQL can raise has member copy, and vice versa', () => {
    // 2026-10-26: the checkout gate returns its reason (`reason := '<code>'`), raised by the caller.
    const raised = new Set([...SQL.matchAll(/commerce_raise\('([a-z_]+)'\)|COMMERCE:([a-z_]+)'|reason := '([a-z_]+)'/g)].map((m) => m[1] ?? m[2] ?? m[3]))
    const known = new Set(Object.keys(COMMERCE_ERROR_COPY).filter((k) => k !== 'unexpected'))
    expect([...raised].sort()).toEqual([...known].sort())
  })

  it('maps COMMERCE:<code> to copy and never surfaces a raw database message', () => {
    expect(commerceError({ message: 'COMMERCE:insufficient_credits' })).toEqual({
      code: 'insufficient_credits',
      message: 'You don’t have enough Credits for this yet.',
    })
    const raw = commerceError({ message: 'duplicate key value violates unique constraint "x"' })
    expect(raw.code).toBe('unexpected')
    expect(raw.message).not.toMatch(/duplicate|constraint|COMMERCE/)
    expect(commerceError({ message: 'COMMERCE:made_up' }).code).toBe('unexpected')
    for (const copy of Object.values(COMMERCE_ERROR_COPY)) expect(copy).not.toMatch(/COMMERCE|sql|constraint/i)
  })

  it('idempotency keys satisfy the server format and are unique', () => {
    const a = newIdempotencyKey()
    expect(a).toMatch(/^[A-Za-z0-9:_-]{8,200}$/)
    expect(newIdempotencyKey()).not.toBe(a)
  })
})

describe('purchase wrappers send ids + key only — never a price or balance', () => {
  it('product', async () => {
    const { client, rpc } = fake({
      data: { status: 'completed', replayed: false, purchase_id: 'p1', product_id: 'x', credits_charged: '50', balance: '0', gift_id: null },
    })
    const res = await purchaseProduct(client, 'x', 'k_abc12345')
    expect(rpc).toHaveBeenCalledWith('commerce_purchase_product', { p_product_id: 'x', p_idempotency_key: 'k_abc12345' })
    expect(res).toEqual({
      data: { status: 'completed', replayed: false, purchaseId: 'p1', productId: 'x', creditsCharged: 50, balance: 0, giftId: null },
      error: null,
    })
  })

  it('bundle and Gift', async () => {
    const b = fake({ data: { status: 'all_owned', product_id: 'b', credits_charged: 0, balance: 10 } })
    expect((await purchaseBundle(b.client, 'b', 'k_bundle001')).data).toEqual({ status: 'all_owned', productId: 'b', creditsCharged: 0, balance: 10 })
    expect(b.rpc).toHaveBeenCalledWith('commerce_purchase_bundle', { p_bundle_product_id: 'b', p_idempotency_key: 'k_bundle001' })
    const g = fake({ error: { message: 'COMMERCE:gifts_disabled' } })
    expect(await purchaseGift(g.client, 'g', 'c', 'k_gift0001')).toEqual({
      data: null,
      error: { code: 'gifts_disabled', message: 'Gifts aren’t available yet.' },
    })
    expect(g.rpc).toHaveBeenCalledWith('commerce_purchase_gift', { p_gift_product_id: 'g', p_correspondence_id: 'c', p_idempotency_key: 'k_gift0001' })
  })

  it('already_owned is a result, not an error', () => {
    expect(toPurchaseResult({ status: 'already_owned', product_id: 'x', credits_charged: 0, balance: '7' })).toEqual({
      status: 'already_owned', productId: 'x', creditsCharged: 0, balance: 7,
    })
  })
})

describe('balance and history', () => {
  it('balance is a number; bigint strings are parsed', async () => {
    expect((await getCreditBalance(fake({ data: '120' }).client)).data).toBe(120)
    expect((await getCreditBalance(fake({ data: null }).client)).data).toBe(0)
  })

  it('history labels cover exactly the SQL categories', () => {
    const cats = new Set([...SQL.matchAll(/then '([a-z_]+)'\n/g)].map((m) => m[1]))
    cats.add('adjustment')
    expect([...cats].sort()).toEqual(Object.keys(CREDIT_HISTORY_LABELS).sort())
  })

  it('maps rows, and returns a keyset cursor only for a full page', async () => {
    const rows = [
      { id: 'a', occurred_at: '2026-10-02T00:00:00.123456Z', category: 'spent', credits: '-50', balance_after: '350', item_title: 'Essaouira' },
      { id: 'b', occurred_at: '2026-10-01T00:00:00Z', category: 'from_tempa', credits: '400', balance_after: '400', item_title: null },
    ]
    const { client, rpc } = fake({ data: rows })
    const res = await getCreditHistory(client, { limit: 2 })
    expect(rpc).toHaveBeenCalledWith('commerce_my_credit_history', { p_limit: 2, p_before_at: null, p_before_id: null })
    expect(res.data?.entries[0]).toEqual({
      id: 'a', occurredAt: '2026-10-02T00:00:00.123456Z', category: 'spent', label: 'Spent', credits: -50, balanceAfter: 350, itemTitle: 'Essaouira',
    })
    expect(res.data?.next).toEqual({ occurredAt: '2026-10-01T00:00:00Z', id: 'b' })
    expect((await getCreditHistory(fake({ data: rows.slice(0, 1) }).client, { limit: 2 })).data?.next).toBeNull()
  })
})
