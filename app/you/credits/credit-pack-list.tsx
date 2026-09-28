'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CreditPackOffer } from '@/lib/commerce'
import { newIdempotencyKey } from '@/lib/commerce'
import { formatMoney } from '@/lib/money'
import { helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import { startCreditCheckout } from './actions'

/**
 * One idempotency key per purchase intent (per pack + currency): a double
 * click or a retry after a network blip reuses it, so the server resolves
 * to the SAME order. The displayed price is only a label — the server
 * re-derives the price from the published price book.
 */
export default function CreditPackList({ offers }: { offers: CreditPackOffer[] }) {
  const router = useRouter()
  const keys = useRef(new Map<string, string>())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function buy(offer: CreditPackOffer) {
    if (busy) return
    const intent = `${offer.productId}:${offer.currency}`
    let key = keys.current.get(intent)
    if (!key) {
      key = newIdempotencyKey()
      keys.current.set(intent, key)
    }
    setBusy(intent)
    setError('')
    const result = await startCreditCheckout(offer.productId, offer.currency, key).catch(() => null)
    if (result?.status === 'redirect') {
      window.location.assign(result.url)
      return
    }
    if (result?.status === 'already_paid') {
      router.push(`/you/credits/return?tx_ref=${encodeURIComponent(result.reference)}`)
      return
    }
    setBusy(null)
    setError(result?.status === 'error' ? result.message : 'Something went wrong. Please try again.')
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {offers.map((offer) => {
          const intent = `${offer.productId}:${offer.currency}`
          return (
            <li key={intent} className="flex items-center justify-between gap-4 rounded-md border border-foreground/12 p-4">
              <div className="space-y-0.5">
                <p className="text-[15px] font-medium text-foreground">{offer.credits} Credits</p>
                <p className={helperTextClass}>{formatMoney(offer.amountMinor, offer.currency)}</p>
              </div>
              <button type="button" onClick={() => buy(offer)} disabled={busy !== null} className={secondaryButtonClass}>
                {busy === intent ? 'Opening checkout…' : 'Get'}
              </button>
            </li>
          )
        })}
      </ul>
      {error && (
        <p role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
