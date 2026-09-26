'use client'

import { useState } from 'react'
import { formatCredits, formatMinor, minorDigits, priceWindowState, type PriceBookRow, type PriceRow, type ProductDetail } from '@/lib/admin-commerce'
import { inputClass, primaryButtonClass } from '@/app/profile/ui'
import { adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Card, ConfirmAction, Empty, ErrorNote, Field, Pill, formatDate, useAdminAction } from '../../ui'

const WINDOW_LABEL = { current: 'Current', scheduled: 'Scheduled', ended: 'Ended', draft: 'Draft', retired: 'Withdrawn' } as const
const WINDOW_TONE = { current: 'good', scheduled: 'warn', ended: 'quiet', draft: 'warn', retired: 'quiet' } as const

/**
 * Prices are never edited in place. A new price takes effect at its start
 * time and the current one closes at that same instant; published history
 * stays exactly as it was.
 */
export default function PricingPanel({ detail }: { detail: ProductDetail }) {
  const p = detail.product
  if (p.product_type === 'credit_pack') return <PriceBooks productId={p.id} rows={detail.price_books} credits={p.credit_amount} />
  if (p.is_complimentary) {
    return (
      <Card title="Price">
        <p className={adminTableSecondaryClass}>Complimentary — no Credit price. Untick Complimentary in Details (while it’s off sale) to sell it for Credits.</p>
      </Card>
    )
  }
  return <CreditPrices productId={p.id} rows={detail.credit_prices} />
}

function StartFields({ start, setStart, draft, setDraft }: { start: string; setStart: (v: string) => void; draft: boolean; setDraft: (v: boolean) => void }) {
  return (
    <>
      <Field label="Starts" hint="Leave empty for now; a future time schedules the change.">
        <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-[14px]">
        <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Save as draft (not live)
      </label>
    </>
  )
}

function CreditPrices({ productId, rows }: { productId: string; rows: PriceRow[] }) {
  const { run, pending, error } = useAdminAction()
  const [amount, setAmount] = useState('')
  const [start, setStart] = useState('')
  const [draft, setDraft] = useState(false)
  return (
    <Card title="Credit price" note="The price members pay in Credits. The displayed price is never what’s charged — every unlock re-reads it on the server.">
      <PriceHistory
        rows={rows.map((r) => ({ ...r, label: formatCredits(r.credit_amount), extra: r.purchases ? `${r.purchases} purchases` : null }))}
        kind="credit"
      />
      <form
        className="grid gap-3 border-t border-foreground/10 pt-3 sm:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault()
          const ok = await run('admin_commerce_set_price', {
            p_kind: 'credit',
            p_product_id: productId,
            p_amount: Number(amount),
            p_effective_from: start ? new Date(start).toISOString() : null,
            p_as_draft: draft,
            p_reason: null,
          })
          if (ok) setAmount('')
        }}
      >
        <Field label="New price (Credits)">
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} required className={inputClass} />
        </Field>
        <StartFields start={start} setStart={setStart} draft={draft} setDraft={setDraft} />
        <div className="sm:col-span-3">
          <button type="submit" disabled={pending || !amount} className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}>
            {draft ? 'Save draft price' : start ? 'Schedule price' : 'Set price now'}
          </button>
        </div>
      </form>
      <ErrorNote error={error} />
    </Card>
  )
}

function PriceBooks({ productId, rows, credits }: { productId: string; rows: PriceBookRow[]; credits: number | null }) {
  const { run, pending, error } = useAdminAction()
  const [market, setMarket] = useState('*')
  const [currency, setCurrency] = useState('USD')
  const [amount, setAmount] = useState('')
  const [usd, setUsd] = useState('')
  const [start, setStart] = useState('')
  const [draft, setDraft] = useState(false)
  const digits = minorDigits(currency || 'USD')
  const isUsd = currency.toUpperCase() === 'USD'
  return (
    <Card
      title="Local prices"
      note={`What members pay for ${formatCredits(credits)} in each market. Amounts are stored as whole minor units (e.g. cents). Checkout opens in a later checkpoint.`}
    >
      <p className="rounded-md bg-foreground/[.04] px-3 py-2 text-[13px] text-foreground/80">
        Market <span className="font-medium">*</span> is only a <span className="font-medium">price fallback</span> for markets without their own row — it does not
        authorize selling in every country. Checkout checks eligibility separately.
      </p>
      <PriceHistory
        kind="book"
        rows={rows.map((r) => ({
          ...r,
          label: `${r.market === '*' ? 'Fallback (*)' : r.market} · ${formatMinor(r.amount_minor, r.currency)}`,
          extra: r.currency === 'USD' ? null : `≈ ${formatMinor(r.usd_reference_minor, 'USD')} reference`,
        }))}
      />
      <form
        className="grid gap-3 border-t border-foreground/10 pt-3 sm:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault()
          const ok = await run('admin_commerce_set_price', {
            p_kind: 'book',
            p_product_id: productId,
            p_amount: Number(amount),
            p_effective_from: start ? new Date(start).toISOString() : null,
            p_as_draft: draft,
            p_reason: null,
            p_market: market,
            p_currency: currency,
            p_usd_reference_minor: isUsd ? Number(amount) : Number(usd),
          })
          if (ok) setAmount('')
        }}
      >
        <Field label="Market" hint="Country code (NG, GB…) or * for the fallback.">
          <input value={market} onChange={(e) => setMarket(e.target.value.toUpperCase().slice(0, 2) || '*')} className={inputClass} />
        </Field>
        <Field label="Currency">
          <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))} className={inputClass} />
        </Field>
        <Field label="Amount (minor units)" hint={amount ? `= ${formatMinor(amount, currency || 'USD')}` : digits === 0 ? 'Whole units' : 'e.g. 499 = 4.99'}>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} required className={inputClass} />
        </Field>
        {!isUsd && (
          <Field label="USD reference (cents)" hint={usd ? `= ${formatMinor(usd, 'USD')}` : 'The canonical USD value — no live FX.'}>
            <input inputMode="numeric" value={usd} onChange={(e) => setUsd(e.target.value.replace(/\D/g, ''))} required className={inputClass} />
          </Field>
        )}
        <StartFields start={start} setStart={setStart} draft={draft} setDraft={setDraft} />
        <div className="sm:col-span-3">
          <button type="submit" disabled={pending || !amount || (!isUsd && !usd)} className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}>
            {draft ? 'Save draft price' : start ? 'Schedule price' : 'Set price now'}
          </button>
        </div>
      </form>
      <ErrorNote error={error} />
    </Card>
  )
}

function PriceHistory({
  rows,
  kind,
}: {
  rows: { id: string; state: string; effective_from: string; effective_to: string | null; label: string; extra: string | null }[]
  kind: 'credit' | 'book'
}) {
  const { run, error } = useAdminAction()
  if (rows.length === 0) return <Empty>No prices yet.</Empty>
  return (
    <>
      <ul className="divide-y divide-foreground/10">
        {rows.map((r) => {
          const w = priceWindowState(r)
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className={adminTableTextClass}>
                  {r.label} <Pill tone={WINDOW_TONE[w]}>{WINDOW_LABEL[w]}</Pill>
                </p>
                <p className={adminTableSecondaryClass}>
                  {formatDate(r.effective_from)} → {r.effective_to ? formatDate(r.effective_to) : 'open'}
                  {r.extra ? ` · ${r.extra}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {w === 'draft' && (
                  <>
                    <ConfirmAction label="Publish" message="Publish this price? The current price closes when it starts." reason onConfirm={(reason) => run('admin_commerce_publish_price', { p_kind: kind, p_price_id: r.id, p_reason: reason || null })} />
                    <ConfirmAction label="Discard" message="Discard this draft price?" onConfirm={() => run('admin_commerce_discard_draft_price', { p_kind: kind, p_price_id: r.id })} />
                  </>
                )}
                {(w === 'current' || w === 'scheduled') && (
                  <ConfirmAction
                    label={w === 'current' ? 'End now' : 'Withdraw'}
                    message={w === 'current' ? 'End this price now? Until another price starts, this product can’t be bought.' : 'Withdraw this scheduled price before it starts?'}
                    reason
                    reasonRequired
                    onConfirm={(reason) => run('admin_commerce_end_price', { p_kind: kind, p_price_id: r.id, p_effective_to: null, p_reason: reason })}
                  />
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <ErrorNote error={error} />
    </>
  )
}
