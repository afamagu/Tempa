import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Commerce Checkpoint 2 — thin, typed wrappers over the server-authoritative
 * Credit RPCs (docs/sql/2026-10-21-commerce-credit-services.sql). The
 * database resolves every price, balance and ownership decision; callers
 * only ever send a product/correspondence id and an idempotency key.
 * auth.uid() is read server-side, so no call can act for another member.
 * Every spend path refuses while the commerce switches are OFF.
 */

export type CommerceErrorCode =
  | 'commerce_disabled'
  | 'gifts_disabled'
  | 'account_unavailable'
  | 'not_available'
  | 'complimentary'
  | 'price_unavailable'
  | 'insufficient_credits'
  | 'idempotency_conflict'
  | 'invalid_request'
  | 'correspondence_unavailable'
  | 'recipient_unavailable'
  | 'not_authorized'
  | 'reason_required'
  | 'use_refund_operation'
  | 'adjustment_below_zero'
  | 'member_unavailable'

export type CommerceError = { code: CommerceErrorCode | 'unexpected'; message: string }

// Member-facing copy. Never shows raw database errors.
export const COMMERCE_ERROR_COPY: Record<CommerceErrorCode | 'unexpected', string> = {
  commerce_disabled: 'The Tempa shop isn’t open yet.',
  gifts_disabled: 'Gifts aren’t available yet.',
  account_unavailable: 'Purchases aren’t available on this account right now.',
  not_available: 'This isn’t available right now.',
  complimentary: 'This one is already yours to use — no Credits needed.',
  price_unavailable: 'This isn’t available right now.',
  insufficient_credits: 'You don’t have enough Credits for this yet.',
  idempotency_conflict: 'Something went wrong. Please try again.',
  invalid_request: 'Something went wrong. Please try again.',
  correspondence_unavailable: 'A Gift can only be sent within one of your correspondences.',
  recipient_unavailable: 'This Gift can’t be sent to them right now.',
  not_authorized: 'You don’t have permission to do that.',
  reason_required: 'Add a reason before saving.',
  use_refund_operation: 'Use the refund or dispute tools for payment reversals.',
  adjustment_below_zero: 'A correction can’t take a balance below zero.',
  member_unavailable: 'That member can’t receive Credits.',
  unexpected: 'Something went wrong. Please try again.',
}

const CODES = new Set(Object.keys(COMMERCE_ERROR_COPY))

export function commerceError(error: { message?: string } | null | undefined): CommerceError {
  const code = error?.message?.match(/COMMERCE:([a-z_]+)/)?.[1]
  const known = code && CODES.has(code) ? (code as CommerceErrorCode) : 'unexpected'
  return { code: known, message: COMMERCE_ERROR_COPY[known] }
}

/** One key per purchase intent; reuse it for retries of that same intent. */
export function newIdempotencyKey(): string {
  return `k_${crypto.randomUUID().replace(/-/g, '')}`
}

export type PurchaseResult =
  | { status: 'completed'; replayed: boolean; purchaseId: string; productId: string; creditsCharged: number; balance: number; giftId: string | null }
  | { status: 'already_owned' | 'all_owned'; productId: string; creditsCharged: 0; balance: number }

type RawPurchase = {
  status: 'completed' | 'already_owned' | 'all_owned'
  replayed?: boolean
  purchase_id?: string
  product_id: string
  credits_charged: number | string
  balance: number | string | null
  gift_id?: string | null
}

export function toPurchaseResult(raw: RawPurchase): PurchaseResult {
  if (raw.status === 'completed') {
    return {
      status: 'completed',
      replayed: raw.replayed === true,
      purchaseId: raw.purchase_id as string,
      productId: raw.product_id,
      creditsCharged: Number(raw.credits_charged),
      balance: Number(raw.balance ?? 0),
      giftId: raw.gift_id ?? null,
    }
  }
  return { status: raw.status, productId: raw.product_id, creditsCharged: 0, balance: Number(raw.balance ?? 0) }
}

type Result<T> = { data: T; error: null } | { data: null; error: CommerceError }

async function purchase(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Result<PurchaseResult>> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { data: null, error: commerceError(error) }
  return { data: toPurchaseResult(data as RawPurchase), error: null }
}

export const purchaseProduct = (supabase: SupabaseClient, productId: string, idempotencyKey: string) =>
  purchase(supabase, 'commerce_purchase_product', { p_product_id: productId, p_idempotency_key: idempotencyKey })

export const purchaseBundle = (supabase: SupabaseClient, bundleProductId: string, idempotencyKey: string) =>
  purchase(supabase, 'commerce_purchase_bundle', { p_bundle_product_id: bundleProductId, p_idempotency_key: idempotencyKey })

export const purchaseGift = (supabase: SupabaseClient, giftProductId: string, correspondenceId: string, idempotencyKey: string) =>
  purchase(supabase, 'commerce_purchase_gift', {
    p_gift_product_id: giftProductId,
    p_correspondence_id: correspondenceId,
    p_idempotency_key: idempotencyKey,
  })

export async function getCreditBalance(supabase: SupabaseClient): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('commerce_my_credit_balance')
  if (error) return { data: null, error: commerceError(error) }
  return { data: Number(data ?? 0), error: null }
}

export type CreditHistoryCategory =
  | 'bought'
  | 'spent'
  | 'spent_on_gift'
  | 'returned'
  | 'removed_after_refund'
  | 'removed_after_dispute'
  | 'restored_after_dispute'
  | 'from_tempa'
  | 'adjustment'

export const CREDIT_HISTORY_LABELS: Record<CreditHistoryCategory, string> = {
  bought: 'Credits bought',
  spent: 'Spent',
  spent_on_gift: 'Spent on a Gift',
  returned: 'Credits returned',
  removed_after_refund: 'Removed after a refund',
  removed_after_dispute: 'Removed after a payment dispute',
  restored_after_dispute: 'Restored after a payment dispute',
  from_tempa: 'From Tempa',
  adjustment: 'Balance correction',
}

export type CreditHistoryEntry = {
  id: string
  occurredAt: string
  category: CreditHistoryCategory
  label: string
  credits: number
  balanceAfter: number
  itemTitle: string | null
}

export type HistoryCursor = { occurredAt: string; id: string }

export async function getCreditHistory(
  supabase: SupabaseClient,
  { limit = 20, before }: { limit?: number; before?: HistoryCursor } = {},
): Promise<Result<{ entries: CreditHistoryEntry[]; next: HistoryCursor | null }>> {
  const { data, error } = await supabase.rpc('commerce_my_credit_history', {
    p_limit: limit,
    p_before_at: before?.occurredAt ?? null,
    p_before_id: before?.id ?? null,
  })
  if (error) return { data: null, error: commerceError(error) }
  const rows = (data ?? []) as {
    id: string
    occurred_at: string
    category: CreditHistoryCategory
    credits: number | string
    balance_after: number | string
    item_title: string | null
  }[]
  const entries = rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurred_at,
    category: r.category,
    label: CREDIT_HISTORY_LABELS[r.category] ?? CREDIT_HISTORY_LABELS.adjustment,
    credits: Number(r.credits),
    balanceAfter: Number(r.balance_after),
    itemTitle: r.item_title,
  }))
  const last = entries.at(-1)
  return { data: { entries, next: entries.length === limit && last ? { occurredAt: last.occurredAt, id: last.id } : null }, error: null }
}
