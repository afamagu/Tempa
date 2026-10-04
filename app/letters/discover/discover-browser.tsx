'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  discoveryRequest,
  discoverUrl,
  hasIntentionalDiscoverCriteria,
  type DiscoverValues,
} from '@/lib/discover-browser-state'
import DiscoveryResults, { type DiscoveryEntry } from '@/app/room/discovery-results'
import { appendDistinctPeople } from '@/app/room/people-browser'
import { loadMorePeople } from '@/app/room/discovery-actions'
import { markIntroductionPresented } from '@/app/introduction-actions'
import { loadPassiveIntroductions } from './actions'
import DiscoverFilters from './discover-filters'

export default function DiscoverBrowser({
  initialValues,
  initialEntries,
  initialHasMore,
  initialUnavailable,
  seed,
  viewerId = 'test',
  restore = false,
  passiveIntroductionsEnabled = true,
}: {
  viewerId?: string
  restore?: boolean
  initialValues: DiscoverValues
  initialEntries: DiscoveryEntry[]
  initialHasMore: boolean
  initialUnavailable: boolean
  seed: string
  passiveIntroductionsEnabled?: boolean
}) {
  const t = useTranslations('Discovery')
  const [values, setValues] = useState(initialValues)
  const [entries, setEntries] = useState(initialEntries)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<'failed' | 'signIn' | 'changed' | null>(initialUnavailable ? 'failed' : null)
  const sentinel = useRef<HTMLDivElement>(null)
  const passiveResults = useRef<HTMLDivElement>(null)
  const presentedThisVisit = useRef(new Set<string>())
  const visitSeed = useRef(seed)
  const automaticUsed = useRef(false)
  const generation = useRef(0)
  const busy = useRef(false)
  const alive = useRef(true)
  const state = useRef({ values: initialValues, entries: initialEntries, hasMore: initialHasMore, error: initialUnavailable })

  useEffect(() => {
    const clock = generation
    alive.current = true
    return () => { alive.current = false; clock.current++ }
  }, [])

  const load = useCallback(async (nextValues: DiscoverValues, reset: boolean) => {
    if (!reset && busy.current) return
    const intentional = hasIntentionalDiscoverCriteria(nextValues)

    // Blank Discover is deliberately finite. Filtering/searching is the only
    // path that enters broad paging; a full member may still do that because
    // public discovery remains open even when new private correspondence is not.
    if (!intentional && !passiveIntroductionsEnabled) {
      state.current = { values: nextValues, entries: [], hasMore: false, error: false }
      setValues(nextValues)
      setEntries([])
      setHasMore(false)
      setError(null)
      return
    }
    if (!intentional && !reset) return

    const version = reset ? ++generation.current : generation.current
    const previous = reset ? [] : state.current.entries
    busy.current = true
    setPending(true)
    setError(null)
    state.current.error = false

    if (reset) {
      automaticUsed.current = false
      state.current = { values: nextValues, entries: [], hasMore: false, error: false }
      setValues(nextValues)
      setEntries([])
      setHasMore(false)
    }

    try {
      if (!intentional) {
        const passive = await loadPassiveIntroductions()
        if (!alive.current || version !== generation.current) return
        if (passive.error) {
          state.current.error = true
          setError(passive.error)
          return
        }
        state.current = { values: nextValues, entries: passive.entries, hasMore: false, error: false }
        setEntries(passive.entries)
        setHasMore(false)
        return
      }

      const page = await loadMorePeople(
        {
          ...discoveryRequest(nextValues, visitSeed.current),
          ...(previous.length ? { afterUserId: previous[previous.length - 1].userId } : {}),
        },
        previous.slice(-6).map((person) => person.userId),
        true
      )
      if (!alive.current || version !== generation.current) return
      if (page.error) {
        state.current.error = true
        setError(page.error)
        return
      }
      const combined = appendDistinctPeople(previous, page.entries)
      const more = page.hasMore && combined.length > previous.length
      state.current = { values: nextValues, entries: combined, hasMore: more, error: false }
      setEntries(combined)
      setHasMore(more)
    } catch {
      if (alive.current && version === generation.current) {
        state.current.error = true
        setError('failed')
      }
    } finally {
      if (alive.current && version === generation.current) {
        busy.current = false
        setPending(false)
      }
    }
  }, [passiveIntroductionsEnabled])

  const cacheKey = `tempa.discover.return:${viewerId}`
  useEffect(() => {
    if (!restore) return
    try {
      const raw = sessionStorage.getItem(cacheKey)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (
        saved.url !== discoverUrl(initialValues) ||
        Date.now() - saved.at > 30 * 60 * 1000 ||
        !Array.isArray(saved.entries)
      ) return
      visitSeed.current = saved.seed
      automaticUsed.current = saved.automaticUsed
      if (Array.isArray(saved.presentedIds)) {
        presentedThisVisit.current = new Set(saved.presentedIds.filter((id: unknown) => typeof id === 'string'))
      }
      state.current = { values: initialValues, entries: saved.entries, hasMore: saved.hasMore, error: false }
      requestAnimationFrame(() => {
        if (!alive.current) return
        setEntries(saved.entries)
        setHasMore(hasIntentionalDiscoverCriteria(initialValues) ? saved.hasMore : false)
        setError(null)
        requestAnimationFrame(() => { if (alive.current) window.scrollTo(0, saved.scrollY) })
      })
    } catch { /* Storage is optional. */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function saveReturn() {
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({
        at: Date.now(),
        url: discoverUrl(state.current.values),
        entries: state.current.entries,
        hasMore: state.current.hasMore,
        seed: visitSeed.current,
        automaticUsed: automaticUsed.current,
        presentedIds: [...presentedThisVisit.current],
        scrollY: window.scrollY,
      }))
    } catch {}
  }

  function returnDestination() {
    const url = discoverUrl(values)
    return `${url}${url.includes('?') ? '&' : '?'}restore=1`
  }

  function change(next: DiscoverValues) {
    window.history.replaceState(null, '', discoverUrl(next))
    void load(next, true)
  }

  useEffect(() => {
    const pop = () => {
      const params = new URLSearchParams(window.location.search)
      void load(Object.fromEntries(params), true)
    }
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [load])

  const intentional = hasIntentionalDiscoverCriteria(values)

  // A passive introduction becomes an encounter only after the corresponding
  // card is substantially visible. Fetching six rows alone must not manufacture
  // familiarity for cards the member never actually reached.
  useEffect(() => {
    const root = passiveResults.current
    if (intentional || !root || !entries.length || !('IntersectionObserver' in window)) return
    const cards = Array.from(root.querySelectorAll<HTMLElement>('article'))
    const byCard = new Map(cards.map((card, index) => [card, entries[index]?.userId]).filter((pair): pair is [HTMLElement, string] => Boolean(pair[1])))
    const observer = new IntersectionObserver((records) => {
      for (const record of records) {
        if (!record.isIntersecting || record.intersectionRatio < 0.6) continue
        const candidateId = byCard.get(record.target as HTMLElement)
        if (!candidateId || presentedThisVisit.current.has(candidateId)) continue
        presentedThisVisit.current.add(candidateId)
        observer.unobserve(record.target)
        void markIntroductionPresented(candidateId)
      }
    }, { threshold: 0.6 })
    cards.forEach((card) => observer.observe(card))
    return () => observer.disconnect()
  }, [intentional, entries])

  useEffect(() => {
    const el = sentinel.current
    if (!intentional || !el || !hasMore || error || automaticUsed.current || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver((records) => {
      if (
        records.some((record) => record.isIntersecting) &&
        !busy.current &&
        state.current.hasMore &&
        !state.current.error &&
        !automaticUsed.current
      ) {
        automaticUsed.current = true
        void load(state.current.values, false)
      }
    }, { rootMargin: '160px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [intentional, hasMore, error, entries.length, load])

  const passiveEmptyBecauseFull = !intentional && !passiveIntroductionsEnabled

  return (
    <div
      className="space-y-10"
      onClickCapture={(event) => {
        if ((event.target as Element).closest('a[href^="/room/"]')) saveReturn()
      }}
    >
      <DiscoverFilters key={values.search ?? ''} values={values} onChange={change} />

      <section aria-label={t('browse')} aria-busy={pending} className="space-y-5">
        {!intentional && entries.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-widest text-foreground/55">People for you to notice today</p>
            <p className="mt-1 text-sm text-muted">A small set, on purpose.</p>
          </div>
        )}

        <div ref={passiveResults}>
          <DiscoveryResults entries={entries} returnTo={returnDestination()} profileLed />
        </div>

        <div ref={sentinel} className="flex min-h-12 items-center justify-center" aria-live="polite">
          {pending ? (
            <p className="text-sm text-muted">{t('loadingPeople')}</p>
          ) : error ? (
            <div className="space-y-2 text-center">
              <p role="alert" className="text-sm text-muted">{t(error)}</p>
              <button type="button" onClick={() => void load(values, entries.length === 0)} className="text-sm underline underline-offset-4">
                {t('retry')}
              </button>
            </div>
          ) : passiveEmptyBecauseFull ? (
            <p className="max-w-md text-center text-sm text-muted">
              Your correspondence circle is full for now. Search for a specific person, or keep reading the wider Tempa world.
            </p>
          ) : !entries.length ? (
            <p className="text-sm text-muted">{t('empty')}</p>
          ) : !intentional ? (
            <p className="text-sm text-muted">That’s everyone we’d like to introduce today.</p>
          ) : !hasMore ? (
            <p className="text-sm text-muted">{t('end')}</p>
          ) : (
            <button type="button" onClick={() => void load(values, false)} className="text-sm text-muted underline underline-offset-4">
              {t('more')}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
