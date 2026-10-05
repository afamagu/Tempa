'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { buildMarketplace, loadMarketplace, type Marketplace } from '@/lib/marketplace'
import type { PostcardCatalogEntry } from '@/lib/postcards'
import CatalogueBrowser from '@/app/marketplace/catalogue-browser'

/**
 * Tempa's own postcard catalog — never the device photo library.
 *
 * Commerce Checkpoint 3 — the Letter / Dispatch picker is now the same
 * catalogue system as the marketplace (app/marketplace/catalogue-browser),
 * in "pick" mode: compact still tiles, search, discovery views, a detail
 * view with front/back and a deliberate motion preview, and "Use this
 * Postcard" only for what this member may send (Complimentary, or a
 * premium Postcard they have unlocked). Received Keepsakes are still
 * never offered as sendable. The caller's contract is unchanged: it
 * passes the live ACTIVE catalogue and gets back a postcard key; sending,
 * Safety, snapshot versioning and the server ownership check are exactly
 * as before.
 *
 * Phase 7 adds `strictCatalog` as an opt-in only. Return Cards pass a
 * server-narrowed Complimentary catalogue, and strict mode prevents any
 * non-Postcard marketplace product from appearing in that picker. Existing
 * callers keep the exact previous behavior by default.
 */

// Cache is scoped to the supplied catalogue identity, not just time. That
// matters now that Return Cards intentionally pass a narrower subset: opening
// that picker must never poison a later ordinary Letter picker for five minutes.
let cached: { at: number; catalogueSignature: string; value: Promise<Marketplace> } | null = null

function catalogueSignature(postcards: PostcardCatalogEntry[]) {
  return postcards.map((postcard) => postcard.key).sort().join('|')
}

function readMarketplace(postcards: PostcardCatalogEntry[]): Promise<Marketplace> {
  const signature = catalogueSignature(postcards)
  if (!cached || cached.catalogueSignature !== signature || Date.now() - cached.at > 5 * 60_000) {
    const value = loadMarketplace(createClient(), postcards)
    cached = { at: Date.now(), catalogueSignature: signature, value }
    value.catch(() => {
      if (cached?.value === value) cached = null
    })
  }
  return cached.value
}

/** If commerce data cannot be read at all, never block sending: offer the
 * active catalogue exactly as before commerce (the server still enforces). */
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
  /** The live, active DB catalogue — fetched by the caller. */
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

  // Both composers place this catalogue in a full-viewport scroll
  // container. Lock the document beneath it so mobile swipes scroll the
  // postcards rather than the composer or the browser's pull-to-refresh.
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
