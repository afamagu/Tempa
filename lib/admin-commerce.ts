import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Commerce Checkpoint 4 — Admin → Commerce data layer. Every read and
 * write goes through the admin-only, audited RPCs in
 * docs/sql/2026-10-23-commerce-admin-operations.sql (is_staff('admin')
 * enforced server-side; moderators and members are refused). Nothing here
 * writes a table directly, and nothing can switch commerce on.
 */

export type AdminCommerceError = { code: string; message: string }
export type Result<T> = { data: T; error: null } | { data: null; error: AdminCommerceError }

// Admin-facing explanations for every refusal the server can return.
export const ADMIN_COMMERCE_ERRORS: Record<string, string> = {
  not_authorized: 'Admin → Commerce is limited to admins.',
  not_found: 'That item no longer exists. Refresh and try again.',
  not_ready: 'This can’t be published yet — complete the required checklist items first.',
  unpublish_first: 'Remove it from sale before changing whether it’s Complimentary or paid.',
  remove_from_sale_first: 'Remove it from sale before moving it back to draft.',
  price_overlap: 'That price would overlap another published price for the same period. End or withdraw the other price first, or choose a later start.',
  price_frozen: 'Published prices can’t be edited. Set a new price instead — the current one closes when the new one starts.',
  invalid_price: 'That price isn’t valid here. Credit prices are for Postcards, Gifts and Keepsakes; local prices are for Credit packs, and USD amounts must equal the USD reference.',
  needs_human_label: 'Give this a human name (for example “Morocco”, not “MA”) before publishing it.',
  duplicate: 'Something with that name already exists in this facet.',
  bundle_frozen: 'Published bundle versions can’t change. Create a new version instead.',
  bundle_empty: 'Add at least one item before publishing this version.',
  bundle_items_durable_only: 'Bundles can only contain products members keep (premium Postcards, durable Keepsakes) — not Gifts, Credit packs or other bundles.',
  not_grantable: 'Only products members keep (premium Postcards, durable Keepsakes) can be granted.',
  reason_required: 'Add a reason — it is recorded in the audit log.',
  member_unavailable: 'That member can’t receive this (the account may be closed).',
  adjustment_below_zero: 'A correction can’t take a balance below zero.',
  invalid_request: 'Some details aren’t valid. Check the form and try again.',
  unexpected: 'Something went wrong. Nothing was changed — please try again.',
}

export function adminCommerceError(error: { message?: string } | null | undefined): AdminCommerceError {
  const code = error?.message?.match(/COMMERCE:([a-z_]+)/)?.[1] ?? 'unexpected'
  return { code, message: ADMIN_COMMERCE_ERRORS[code] ?? ADMIN_COMMERCE_ERRORS.unexpected }
}

export async function callAdminCommerce<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { data: null, error: adminCommerceError(error) }
  return { data: data as T, error: null }
}

export async function isCommerceAdmin(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_staff', { p_min_role: 'admin' })
  return !error && data === true
}

// ---------- shapes ----------
export type ProductType = 'postcard' | 'gift' | 'keepsake_template' | 'credit_pack' | 'bundle' | 'physical'
export type Lifecycle = 'draft' | 'scheduled' | 'published' | 'inactive' | 'retired'
export type Check = { key: string; label: string; ok: boolean; required: boolean }

export type Overview = {
  switches: Record<'commerce_enabled' | 'credit_spend_enabled' | 'fiat_checkout_enabled' | 'live_payments_enabled' | 'gifts_enabled' | 'home_shelf_enabled', boolean>
  providers: { code: string; display_name: string; checkout_enabled: boolean; live_mode_enabled: boolean }[]
  products: Partial<Record<Lifecycle, number>>
  by_type: Partial<Record<ProductType, number>>
  complimentary: number
  paid: number
  missing_price: number
  missing_artwork: number
  review_pending: number
  published_not_ready: number
  code_only_place_terms: number
  credits_outstanding: number | string
  credits_negative: number | string
  wallets: number
  orders: number
  recent_credit_ops: { created_at: string; actor: string; action: string; member: string; member_id: string; reason: string | null; delta: number | null; balance: number | null }[]
}

export type CatalogItem = {
  id: string
  slug: string
  product_type: ProductType
  title: string
  lifecycle_state: Lifecycle
  publish_at: string | null
  unpublish_at: string | null
  is_complimentary: boolean
  postcard_key: string | null
  credit_amount: number | null
  display_order: number
  catalog_active: boolean | null
  thumbnail: string | null
  price: number | null
  ready: boolean
  review_flag: boolean
  terms: number
  owners: number
}

export type PriceRow = { id: string; credit_amount: number; effective_from: string; effective_to: string | null; state: 'draft' | 'published' | 'retired'; purchases?: number }
export type PriceBookRow = { id: string; market: string; currency: string; amount_minor: number; usd_reference_minor: number; effective_from: string; effective_to: string | null; state: 'draft' | 'published' | 'retired' }
export type BundleItem = { product_id: string; title: string; product_type: ProductType; allocation_credits: number }
export type BundleVersion = { id: string; version_number: number; state: 'draft' | 'published' | 'retired'; effective_from: string; effective_to: string | null; items: BundleItem[] }

export type ProductDetail = {
  product: {
    id: string
    slug: string
    product_type: ProductType
    title: string
    short_description: string | null
    story_description: string | null
    lifecycle_state: Lifecycle
    publish_at: string | null
    unpublish_at: string | null
    is_complimentary: boolean
    entitlement_model: string
    postcard_key: string | null
    credit_amount: number | null
    preview_policy: 'still_only' | 'controlled_full' | 'controlled_teaser' | 'none'
    rights_review_state: string
    rights_review_notes: string | null
    cultural_review_state: string
    cultural_review_notes: string | null
    display_order: number
  }
  catalog: { key: string; is_active: boolean; country_code: string } | null
  postcard_versions: { id: string; version_number: number; title: string | null; image: string; motion: string | null; is_current: boolean; created_at: string; times_sent: number }[]
  versions: { id: string; version_number: number; title: string; image: string; thumbnail: string | null; motion: string | null; is_current: boolean; created_at: string; in_use: boolean }[]
  credit_prices: PriceRow[]
  price_books: PriceBookRow[]
  terms: { id: string; facet: string; label: string; state: string }[]
  collections: { id: string; title: string; state: string }[]
  bundle_versions: BundleVersion[]
  readiness: Check[]
  owners: number
  purchases: number
}

export type Term = { id: string; facet: Facet; slug: string; label: string; country_code: string | null; aliases: string[]; display_order: number; state: 'draft' | 'published' | 'inactive'; human_label: boolean; products: number }
export type Facet = 'place' | 'mood' | 'occasion' | 'world' | 'story' | 'tag'
export type Collection = { id: string; slug: string; title: string; description: string | null; state: 'draft' | 'scheduled' | 'published' | 'inactive'; publish_at: string | null; is_featured: boolean; display_order: number; products: { id: string; title: string; product_type: ProductType; lifecycle_state: Lifecycle }[] }
export type MemberCredits = {
  member: { id: string; label: string; closed: boolean }
  balance: number | string
  ledger: { id: string; created_at: string; entry_type: string; delta: number; balance_after: number; reason: string | null; actor: string | null; item: string | null }[]
  entitlements: { id: string; product_id: string; title: string; product_type: ProductType; source_type: string; state: string; granted_at: string; revoked_at: string | null }[]
}
export type AuditRow = { id: string; created_at: string; actor: string; action: string; target_type: string; target: string | null; target_id: string | null; reason: string | null; metadata: Record<string, unknown> | null }

// ---------- presentation helpers (pure) ----------
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  postcard: 'Postcard',
  gift: 'Gift',
  keepsake_template: 'Keepsake',
  credit_pack: 'Credit pack',
  bundle: 'Bundle',
  physical: 'Physical',
}

export const FACET_LABELS: Record<Facet, string> = {
  place: 'Places',
  mood: 'Moods',
  occasion: 'Occasions',
  world: 'Worlds',
  story: 'Stories',
  tag: 'Tags',
}

/** Scheduling (owner-approved) = published with a future publish_at. */
export function lifecycleLabel(state: Lifecycle, publishAt: string | null, now: Date = new Date()): string {
  if (state === 'published' && publishAt && new Date(publishAt).getTime() > now.getTime()) return 'Scheduled'
  return { draft: 'Draft', scheduled: 'Scheduled', published: 'Published', inactive: 'Off sale', retired: 'Retired' }[state]
}

export function lifecycleTone(label: string): 'good' | 'quiet' | 'warn' {
  if (label === 'Published') return 'good'
  if (label === 'Scheduled' || label === 'Draft') return 'warn'
  return 'quiet'
}

const MINOR_DIGITS: Record<string, number> = { JPY: 0, KRW: 0, UGX: 0, XAF: 0, XOF: 0, RWF: 0 }
export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2
}

/** Fiat amounts are stored as integer minor units; this is display only. */
export function formatMinor(amountMinor: number | string, currency: string): string {
  const digits = minorDigits(currency)
  const value = Number(amountMinor) / 10 ** digits
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  } catch {
    return `${value.toFixed(digits)} ${currency.toUpperCase()}`
  }
}

export function formatCredits(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  return `${v.toLocaleString('en')} ${Math.abs(v) === 1 ? 'Credit' : 'Credits'}`
}

export type PriceWindowState = 'current' | 'scheduled' | 'ended' | 'draft' | 'retired'
export function priceWindowState(row: { state: string; effective_from: string; effective_to: string | null }, now: Date = new Date()): PriceWindowState {
  if (row.state === 'draft') return 'draft'
  if (row.state === 'retired') return 'retired'
  const t = now.getTime()
  if (new Date(row.effective_from).getTime() > t) return 'scheduled'
  if (row.effective_to && new Date(row.effective_to).getTime() <= t) return 'ended'
  return 'current'
}

/** Bundle completion preview (Checkpoint 2 contract): the fixed allocations
 * of the items the member does NOT own — never today's individual prices. */
export function bundleCompletion(items: { product_id: string; allocation_credits: number | string }[], owned: Set<string>) {
  const full = items.reduce((a, i) => a + Number(i.allocation_credits), 0)
  const missing = items.filter((i) => !owned.has(i.product_id))
  return { full, completion: missing.reduce((a, i) => a + Number(i.allocation_credits), 0), allOwned: missing.length === 0 && items.length > 0 }
}

const ACTION_LABELS: Record<string, string> = {
  commerce_product_create: 'Created product',
  commerce_product_update: 'Edited product',
  commerce_product_publish: 'Published',
  commerce_product_remove_from_sale: 'Removed from sale',
  commerce_product_retire: 'Retired',
  commerce_product_to_draft: 'Moved to draft',
  commerce_version_add: 'Added artwork version',
  commerce_version_set_current: 'Changed current version',
  commerce_term_save: 'Saved facet term',
  commerce_product_terms: 'Changed facets',
  commerce_collection_save: 'Saved collection',
  commerce_collection_products: 'Changed collection products',
  commerce_merchandising_order: 'Reordered collections',
  commerce_price_draft: 'Drafted price',
  commerce_price_publish: 'Published price',
  commerce_price_end: 'Ended price',
  commerce_price_discard_draft: 'Discarded draft price',
  commerce_bundle_draft_save: 'Saved bundle draft',
  commerce_bundle_publish: 'Published bundle version',
  commerce_bundle_retire: 'Retired bundle version',
  commerce_entitlement_grant: 'Granted entitlement',
  commerce_credit_grant: 'Granted Credits',
  commerce_credit_adjustment: 'Corrected Credits',
}
export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/^commerce_/, '').replace(/_/g, ' ')
}

/** Concise before/after summary — never notes text, secrets or payment credentials. */
export function auditSummary(row: AuditRow): string {
  const m = row.metadata ?? {}
  const parts: string[] = []
  if (typeof m.from === 'string' && typeof m.to === 'string') parts.push(`${m.from} → ${m.to}`)
  if (m.amount !== undefined && m.amount !== null) parts.push(`amount ${m.amount}${m.currency ? ` ${m.currency}` : m.kind === 'credit' ? ' Credits' : ''}`)
  if (typeof m.market === 'string') parts.push(`market ${m.market}`)
  if (m.delta !== undefined) parts.push(`${Number(m.delta) > 0 ? '+' : ''}${m.delta} → ${m.balance_after}`)
  if (Array.isArray(m.fields)) parts.push(`changed ${(m.fields as string[]).map((f) => f.replace(/_/g, ' ')).join(', ')}`)
  if (typeof m.purpose === 'string') parts.push(`purpose ${m.purpose.replace(/_/g, ' ')}`)
  if (typeof m.product === 'string') parts.push(m.product)
  if (m.total_credits !== undefined) parts.push(`bundle ${m.total_credits} Credits`)
  return parts.join(' · ')
}

export const LEDGER_LABELS: Record<string, string> = {
  credit_purchase: 'Bought Credits',
  purchase_refund_removal: 'Removed after refund',
  chargeback_removal: 'Removed after chargeback',
  chargeback_restoration: 'Restored after chargeback',
  product_spend: 'Spent',
  bundle_spend: 'Spent on bundle',
  gift_spend: 'Spent on Gift',
  product_credit_refund: 'Returned (product refund)',
  promotional_grant: 'Promotional grant',
  complimentary_grant: 'Complimentary grant',
  admin_adjustment: 'Correction',
  opening_balance: 'Opening balance',
}

export function newAdminKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
}
