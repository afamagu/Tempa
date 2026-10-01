'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { discoveryRequest, discoverUrl, type DiscoverValues } from '@/lib/discover-browser-state'
import DiscoveryResults, { type DiscoveryEntry } from '@/app/room/discovery-results'
import { appendDistinctPeople } from '@/app/room/people-browser'
import { loadMorePeople } from '@/app/room/discovery-actions'
import DiscoverFilters from './discover-filters'
import SuggestedProfiles from './suggested-profiles'

export default function DiscoverBrowser({ initialValues, initialEntries, initialHasMore, initialUnavailable, suggestions, seed, viewerId = 'test', restore = false }: {
  viewerId?: string; restore?: boolean; initialValues: DiscoverValues; initialEntries: DiscoveryEntry[]; initialHasMore: boolean;
  initialUnavailable: boolean; suggestions: DiscoveryEntry[]; seed: string
}) {
  const t = useTranslations('Discovery')
  const [values, setValues] = useState(initialValues)
  const [entries, setEntries] = useState(initialEntries)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<'failed' | 'signIn' | 'changed' | null>(initialUnavailable ? 'failed' : null)
  const sentinel = useRef<HTMLDivElement>(null)
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
    const version = reset ? ++generation.current : generation.current
    const previous = reset ? [] : state.current.entries
    busy.current = true
    setPending(true); setError(null)
    state.current.error = false
    if (reset) {
      automaticUsed.current = false
      state.current = { values: nextValues, entries: [], hasMore: false, error: false }
      setValues(nextValues); setEntries([]); setHasMore(false)
    }
    try {
      const page = await loadMorePeople({ ...discoveryRequest(nextValues, visitSeed.current), ...(previous.length ? { afterUserId: previous[previous.length - 1].userId } : {}) }, previous.slice(-6).map(p => p.userId), true)
      if (!alive.current || version !== generation.current) return
      if (page.error) { state.current.error = true; setError(page.error); return }
      const combined = appendDistinctPeople(previous, page.entries)
      // A duplicate-only response must not leave an observer/request loop running.
      const more = page.hasMore && combined.length > previous.length
      state.current = { values: nextValues, entries: combined, hasMore: more, error: false }
      setEntries(combined); setHasMore(more)
    } catch {
      if (alive.current && version === generation.current) { state.current.error = true; setError('failed') }
    } finally {
      if (alive.current && version === generation.current) { busy.current = false; setPending(false) }
    }
  }, [])

  const cacheKey = `tempa.discover.return:${viewerId}`
  useEffect(() => {
    if (!restore) return
    try {
      const raw = sessionStorage.getItem(cacheKey)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved.url !== discoverUrl(initialValues) || Date.now() - saved.at > 30 * 60 * 1000 || !Array.isArray(saved.entries)) return
      visitSeed.current = saved.seed
      automaticUsed.current = saved.automaticUsed
      state.current = { values: initialValues, entries: saved.entries, hasMore: saved.hasMore, error: false }
      requestAnimationFrame(() => { if (!alive.current) return; setEntries(saved.entries); setHasMore(saved.hasMore); setError(null); requestAnimationFrame(() => { if (alive.current) window.scrollTo(0, saved.scrollY) }) })
    } catch { /* Storage is optional; navigation still has a valid destination. */ }
    // Only restore on mounting a labelled return route, never on filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function saveReturn() {
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), url: discoverUrl(state.current.values), entries: state.current.entries, hasMore: state.current.hasMore, seed: visitSeed.current, automaticUsed: automaticUsed.current, scrollY: window.scrollY })) } catch {}
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
    // Filter changes replace only this page's query. Back/forward from a
    // profile still restores the URL without mounting another filter area.
    const pop = () => {
      const params = new URLSearchParams(window.location.search)
      void load(Object.fromEntries(params), true)
    }
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [load])
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore || error || automaticUsed.current || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(records => {
      if (records.some(record => record.isIntersecting) && !busy.current && state.current.hasMore && !state.current.error && !automaticUsed.current) {
        automaticUsed.current = true
        void load(state.current.values, false)
      }
    }, { rootMargin: '160px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, error, entries.length, load])

  return <div className="space-y-10" onClickCapture={event => { if ((event.target as Element).closest('a[href^="/room/"]')) saveReturn() }}>
    <DiscoverFilters key={values.search ?? ''} values={values} onChange={change} />
    <section aria-label={t('browse')} aria-busy={pending} className="space-y-5">
      <DiscoveryResults entries={entries} returnTo={returnDestination()} profileLed />
      <div ref={sentinel} className="flex min-h-12 items-center justify-center" aria-live="polite">
        {pending ? <p className="text-sm text-muted">{t('loadingPeople')}</p> : error ?
          <div className="space-y-2 text-center"><p role="alert" className="text-sm text-muted">{t(error)}</p><button type="button" onClick={() => void load(values, entries.length === 0)} className="text-sm underline underline-offset-4">{t('retry')}</button></div> :
          !entries.length ? <p className="text-sm text-muted">{t('empty')}</p> : !hasMore ? <p className="text-sm text-muted">{t('end')}</p> :
          <button type="button" onClick={() => void load(values, false)} className="text-sm text-muted underline underline-offset-4">{t('more')}</button>}
      </div>
    </section>
    {suggestions.length > 0 && <div className="border-t border-foreground/10 pt-8"><SuggestedProfiles entries={suggestions} returnTo={returnDestination()} /></div>}
  </div>
}
