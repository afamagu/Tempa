'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { newIdempotencyKey, purchaseBundle } from '@/lib/commerce'
import { collectionPrice, type PostcardBundleOffer } from '@/lib/postcard-bundles'
import { helperTextClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'

export default function CollectionShelf({ offers, ownedIds, spendEnabled, balance, onUnlocked }: {
  offers: PostcardBundleOffer[]; ownedIds: Set<string>; spendEnabled: boolean; balance: number;
  onUnlocked: (ids: string[], balance: number) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const keys = useRef(new Map<string, string>())
  const running = useRef(false)
  async function buy(offer: PostcardBundleOffer) {
    if (running.current || !spendEnabled) return
    running.current = true
    setBusy(true)
    setMessage('')
    try {
      const key = keys.current.get(offer.productId) ?? newIdempotencyKey()
      keys.current.set(offer.productId, key)
      const result = await purchaseBundle(createClient(), offer.productId, key)
      if (result.error) { setMessage(result.error.message); return }
      onUnlocked(offer.items.map((i) => i.productId), result.data.balance)
      keys.current.delete(offer.productId)
      setConfirmId(null)
      setMessage('These postcards are now yours to use.')
    } catch { setMessage('Could not confirm the purchase. Try again to check the same purchase safely.') }
    finally { running.current = false; setBusy(false) }
  }
  return <section aria-label="Six-card collections" className="space-y-4">
    <p className={helperTextClass}>Six postcards, 500 Credits. Each is yours to keep and use. Already own one? Pay only for the remaining cards at their collection price.</p>
    {!spendEnabled && <p className={helperTextClass}>Collection purchases open when the Tempa shop opens.</p>}
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {offers.map((offer) => {
        const price = collectionPrice(offer, ownedIds)
        return <li key={offer.productId} className="space-y-3 rounded-lg border border-foreground/10 p-4">
          <h2 className="font-serif text-xl">{offer.title}</h2>
          <div className="grid grid-cols-3 gap-2">{offer.items.map((item) => <figure key={item.productId}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.image} alt={item.title} loading="lazy" className="aspect-[9/16] w-full rounded-sm object-contain" />
            <figcaption className="mt-1 text-[11px] text-muted">{item.title}</figcaption>
          </figure>)}</div>
          {price === 0 ? <p className={helperTextClass}>All six are yours</p> : confirmId === offer.productId ? <div className="space-y-2">
            <p className={helperTextClass}>Use {price} Credits from your balance of {balance}?</p>
            <button type="button" className={primaryButtonClass} disabled={busy || !spendEnabled || balance < price} onClick={() => buy(offer)}>Confirm — {price} Credits</button>
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setConfirmId(null)}>Cancel</button>
          </div> : <button type="button" className={secondaryButtonClass} disabled={busy || !spendEnabled} onClick={() => setConfirmId(offer.productId)}>
            {price === 500 ? 'Unlock collection' : 'Complete collection'} — {price} Credits
          </button>}
        </li>
      })}
    </ul>
    <p role="status" aria-live="polite" className={helperTextClass}>{message}</p>
  </section>
}
