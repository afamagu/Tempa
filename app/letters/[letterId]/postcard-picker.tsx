'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { buildMarketplace, loadMarketplace, type Marketplace } from '@/lib/marketplace'
import type { PostcardCatalogEntry } from '@/lib/postcards'
import CatalogueBrowser from '@/app/marketplace/catalogue-browser'

/**
 * Tempa's own Postcard catalog — never the device photo library.
 *
 * `strictCatalog` is deliberately opt-in. Ordinary Letter/Dispatch callers
 * retain the marketplace behavior they already have. Return Cards pass true
 * because their server-provided catalogue has already been narrowed to
 * currently published Complimentary Postcards; no Gift or other marketplace
 * item may leak back into that relationship-only picker.
 */

let cached: { at: number; value: Promise<Marketplace> } | null = null

function readMarketplace(postcards: PostcardCatalogEntry[]): Promise<Marketplace> {
  if (!cached || Date.now() - cached.at > 5 * 60_000) {
    const value = loadMarketplace(createClient(), postcards)
    cached = { at: Date.now(), value }
    value.catch(() => {
      cached = null
    })
  }
  return cached.value
}

function degraded(postcards: PostcardCatalogEntry[]): Marketplace {
  return buildMarketplace({
    postcards,
    products: null,
    prices: [],
    productTerms: [],
    collectionProducts: [],
    giftVersions: [],
    entitlements: [],
    context: { spendEnabled: false, giftsEnabled: false, checkoutEnabled: false, balance: 0 },
  })
}

export default function PostcardPicker({
  postcards,
  onSelect,
  onCancel,
  strictCatalog = false,
}: {
  postcards: PostcardCatalogEntry[]
  onSelect: (postcardKey: string) => void
  onCancel: () => void
  strictCatalog?: boolean
}) {
  const [marketplace, setMarketplace] = useState<Marketplace | null>(null)

  useEffect(() => {
    let live = true
    if (postcards.length === 0) return
    readMarketplace(postcards).then(
      (m) => live && setMarketplace(m),
      () => live && setMarketplace(degraded(postcards))
    )
    return () => {
      live = false
    }
  }, [postcards])

  const visibleMarketplace = useMemo(() => {
    if (!marketplace || !strictCatalog) return marketplace
    const keys = new Set(postcards.map((postcard) => postcard.key))
    return {
      ...marketplace,
      items: marketplace.items.filter(
        (item) => item.kind === 'postcard' && item.postcardKey !== null && keys.has(item.postcardKey)
      ),
    }
  }, [marketplace, postcards, strictCatalog])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <div className="mx-auto w-full max-w-6xl rounded-lg border border-foreground/10 bg-background p-4 sm:p-6">
      {visibleMarketplace ? (
        <CatalogueBrowser
          marketplace={visibleMarketplace}
          mode="pick"
          onPick={(key) => {
            cached = null
            onSelect(key)
          }}
          onClose={onCancel}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium uppercase tracking-wider text-muted">Postcards</p>
            <button type="button" onClick={onCancel} className="text-[13px] text-muted underline underline-offset-4">
              Cancel
            </button>
          </div>
          {postcards.length === 0 ? (
            <p className="text-[13px] text-muted">No postcards available right now.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-busy="true" aria-label="Loading Postcards">
              {postcards.slice(0, 12).map((p) => (
                <li key={p.key} className="aspect-[3/4] animate-pulse rounded-md bg-foreground/[0.05] motion-reduce:animate-none" />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
