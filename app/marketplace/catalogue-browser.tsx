'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { helperTextClass, iconButtonClass, inputClass, quietLinkClass, secondaryButtonClass, sectionLabelClass } from '@/app/profile/ui'
import {
  applyQuery,
  availableViews,
  facetTerms,
  forYouOrder,
  isSendable,
  itemState,
  VIEW_FACET,
  VIEW_LABELS,
  type CatalogueItem,
  type DiscoveryView,
  type Marketplace,
} from '@/lib/marketplace'
import CatalogueTile from './catalogue-tile'
import ProductDetail from './product-detail'
import { defaultUnlock, type UnlockFn } from './use-unlock'

type Tab = 'postcards' | 'gifts' | 'yours'
const PAGE = 24

/**
 * Commerce Checkpoint 3 — the ONE catalogue system, used both as the
 * member marketplace (/you/postcards, mode="browse") and as the Letter /
 * Dispatch Postcard picker (mode="pick"). Compact still tiles, discovery
 * views that are facets rather than containers (one Postcard can sit in
 * several), search across the catalogue's own metadata, and a detail view
 * for front/back, deliberate motion preview, ownership and unlocking.
 *
 * "Yours" keeps two different things visibly apart: Postcards you can
 * SEND (Complimentary + unlocked) and Keepsakes you RECEIVED (a received
 * Postcard is never sendable because of that).
 */
export default function CatalogueBrowser({
  marketplace,
  mode,
  onPick,
  onClose,
  unlock = defaultUnlock,
}: {
  marketplace: Marketplace
  mode: 'browse' | 'pick'
  onPick?: (postcardKey: string) => void
  onClose?: () => void
  unlock?: UnlockFn
}) {
  const [ownedIds, setOwnedIds] = useState(() => new Set(marketplace.ownedProductIds))
  const [balance, setBalance] = useState(marketplace.context.balance)
  const ownedKeys = useMemo(() => new Set(marketplace.ownedPostcardKeys), [marketplace.ownedPostcardKeys])
  const owned = useMemo(() => ({ productIds: ownedIds, postcardKeys: ownedKeys }), [ownedIds, ownedKeys])
  const context = { ...marketplace.context, balance }

  const postcards = useMemo(
    () => marketplace.items.filter((i) => i.kind === 'postcard' && itemState(i, owned) !== 'unavailable'),
    [marketplace.items, owned]
  )
  const gifts = useMemo(() => marketplace.items.filter((i) => i.kind === 'gift' && itemState(i, owned) !== 'unavailable'), [marketplace.items, owned])
  const views = useMemo(() => availableViews(postcards), [postcards])
  const hasPremium = marketplace.items.some((i) => i.commerceKnown && !i.isComplimentary)
  const showCredits = !marketplace.degraded && (hasPremium || balance > 0)

  const [tab, setTab] = useState<Tab>('postcards')
  const [view, setView] = useState<DiscoveryView>('for_you')
  const [term, setTerm] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const activeView = views.includes(view) ? view : 'for_you'
  const facet = VIEW_FACET[activeView]
  const terms = facet ? facetTerms(postcards, facet) : []
  const results = useMemo(() => applyQuery(postcards, { view: activeView, term, search }), [postcards, activeView, term, search])
  const sendableYours = useMemo(
    () => forYouOrder(postcards.filter((i) => isSendable(itemState(i, owned), i))),
    [postcards, owned]
  )
  const unlocked = sendableYours.filter((i) => itemState(i, owned) === 'owned')
  const complimentaryCount = sendableYours.filter((i) => itemState(i, owned) === 'complimentary').length
  const openItem = openKey ? marketplace.items.find((i) => i.key === openKey) ?? null : null
  const Heading = mode === 'pick' ? 'h2' : 'h1'

  function chooseView(next: DiscoveryView) {
    setView(next)
    setTerm(null)
    setLimit(PAGE)
  }

  function closeDetail() {
    const key = openKey
    setOpenKey(null)
    if (!key) return
    window.requestAnimationFrame(() => {
      const tile = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-testid="catalogue-tile"]') ?? [])].find((t) => t.dataset.key === key)
      tile?.focus()
    })
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'postcards', label: 'Postcards' },
    ...(gifts.length > 0 && mode === 'browse' ? [{ key: 'gifts' as Tab, label: 'Gifts' }] : []),
    { key: 'yours', label: 'Yours' },
  ]

  function grid(items: CatalogueItem[], paged: boolean) {
    const shown = paged ? items.slice(0, limit) : items
    return (
      <>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" data-testid="catalogue-grid">
          {shown.map((item) => (
            <li key={item.key}>
              <CatalogueTile
                item={item}
                state={itemState(item, owned)}
                showState={!marketplace.degraded}
                onOpen={() => setOpenKey(item.key)}
              />
            </li>
          ))}
        </ul>
        {paged && items.length > limit && (
          <button type="button" className={`mt-6 w-full ${secondaryButtonClass}`} onClick={() => setLimit((n) => n + PAGE)}>
            Show more
          </button>
        )}
      </>
    )
  }

  return (
    <div ref={rootRef} className="w-full space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className={sectionLabelClass}>{mode === 'pick' ? 'Postcards' : 'Tempa'}</p>
          <Heading className="font-serif text-2xl text-foreground sm:text-3xl">{mode === 'pick' ? 'Choose a Postcard' : 'Postcards'}</Heading>
        </div>
        <div className="flex items-center gap-3">
          {showCredits && (
            <p className="text-[13px] text-muted" data-testid="credit-balance">
              <span className="font-medium text-foreground">{balance}</span> Credits
            </p>
          )}
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close Postcards" className={iconButtonClass}>
              <span aria-hidden="true" className="text-xl leading-none">×</span>
            </button>
          )}
        </div>
      </div>

      <div role="tablist" aria-label="Catalogue" className="flex gap-5 border-b border-foreground/10">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 pb-2 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              tab === t.key ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'postcards' && (
        <div className="space-y-4" role="tabpanel">
          {postcards.length === 0 ? (
            <p className={helperTextClass}>No Postcards available right now.</p>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setLimit(PAGE)
                  }}
                  placeholder="Search places, moods, occasions…"
                  aria-label="Search Postcards"
                  className={`${inputClass} sm:max-w-sm`}
                />
                {views.length > 1 && (
                  <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Browse by">
                    {views.map((v) => (
                      <Chip key={v} selected={activeView === v} onClick={() => chooseView(v)}>
                        {VIEW_LABELS[v]}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>

              {terms.length > 0 && (
                <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={`${VIEW_LABELS[activeView]} filter`}>
                  <Chip selected={term === null} onClick={() => setTerm(null)} quiet>
                    All
                  </Chip>
                  {terms.map((t) => (
                    <Chip key={t.slug} selected={term === t.slug} onClick={() => setTerm(term === t.slug ? null : t.slug)} quiet>
                      {t.label}
                    </Chip>
                  ))}
                </div>
              )}

              <div className="flex min-h-5 items-center justify-between gap-3" aria-live="polite">
                <p className={helperTextClass}>
                  {activeView === 'for_you' && !search.trim() ? 'Chosen by Tempa' : `${results.length} ${results.length === 1 ? 'Postcard' : 'Postcards'}`}
                </p>
                {(search.trim() || term || activeView !== 'for_you') && (
                  <button
                    type="button"
                    className="text-[13px] text-foreground/70 underline decoration-foreground/30 underline-offset-4 hover:text-foreground"
                    onClick={() => {
                      setSearch('')
                      chooseView('for_you')
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {results.length === 0 ? (
                <p className={helperTextClass}>Nothing matches{search.trim() ? ` “${search.trim()}”` : ''}. Try another word or clear the filters.</p>
              ) : (
                grid(results, true)
              )}
            </>
          )}
        </div>
      )}

      {tab === 'gifts' && (
        <div role="tabpanel" className="space-y-4">
          {grid(forYouOrder(gifts), true)}
        </div>
      )}

      {tab === 'yours' && (
        <div role="tabpanel" className="space-y-8">
          <section className="space-y-3" aria-labelledby="yours-send">
            <div className="space-y-1">
              <h2 id="yours-send" className="text-[17px] font-medium text-foreground">
                Yours to send
              </h2>
              <p className={helperTextClass}>
                {marketplace.degraded
                  ? 'Postcards you can add to a Letter or Dispatch.'
                  : `Postcards you’ve unlocked${complimentaryCount > 0 ? `, plus ${complimentaryCount} Complimentary ${complimentaryCount === 1 ? 'Postcard' : 'Postcards'} anyone can send` : ''}.`}
              </p>
            </div>
            {mode === 'pick' || marketplace.degraded ? (
              sendableYours.length > 0 ? grid(sendableYours, false) : <p className={helperTextClass}>Nothing here yet.</p>
            ) : unlocked.length > 0 ? (
              grid(unlocked, false)
            ) : (
              <p className={helperTextClass}>You haven’t unlocked any Postcards yet.</p>
            )}
            {mode === 'browse' && !marketplace.degraded && complimentaryCount > 0 && (
              <button
                type="button"
                className={quietLinkClass}
                onClick={() => {
                  setTab('postcards')
                  chooseView('complimentary')
                }}
              >
                See Complimentary Postcards
              </button>
            )}
          </section>

          <section className="space-y-2 border-t border-foreground/10 pt-6" aria-labelledby="yours-received">
            <h2 id="yours-received" className="text-[17px] font-medium text-foreground">
              Received Keepsakes
            </h2>
            <p className={helperTextClass}>
              Postcards people send you are kept in Keepsakes. Receiving one doesn’t make it yours to send.
            </p>
            {mode === 'browse' && (
              <Link href="/you/keepsakes/postcards" className={quietLinkClass}>
                Open Keepsakes
              </Link>
            )}
          </section>
        </div>
      )}

      {openItem && (
        <ProductDetail
          item={openItem}
          state={itemState(openItem, owned)}
          context={context}
          mode={mode}
          unlock={unlock}
          onUnlocked={(productId, nextBalance) => {
            setOwnedIds((prev) => new Set(prev).add(productId))
            setBalance(nextBalance)
          }}
          onUse={onPick}
          onClose={closeDetail}
        />
      )}
    </div>
  )
}

function Chip({ selected, onClick, children, quiet }: { selected: boolean; onClick: () => void; children: React.ReactNode; quiet?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
        selected
          ? 'border-foreground/70 bg-foreground text-background'
          : quiet
            ? 'border-foreground/10 text-foreground/75 hover:border-foreground/25'
            : 'border-foreground/15 text-foreground hover:border-foreground/30'
      }`}
    >
      {children}
    </button>
  )
}
