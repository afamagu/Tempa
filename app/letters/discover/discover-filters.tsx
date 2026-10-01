'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { COUNTRY_OPTIONS, LANGUAGE_OPTIONS, AGE_RANGE_OPTIONS, GENDER_OPTIONS, INTENT_OPTIONS } from '@/app/profile/data'
import { inputClass, secondaryButtonClass } from '@/app/profile/ui'

const FILTERS = { country: COUNTRY_OPTIONS, language: LANGUAGE_OPTIONS, age: AGE_RANGE_OPTIONS, gender: GENDER_OPTIONS, intent: INTENT_OPTIONS }
type Filter = keyof typeof FILTERS

export default function DiscoverFilters() {
  const t = useTranslations('Discovery')
  const router = useRouter()
  const params = useSearchParams()
  const [panel, setPanel] = useState<Filter | 'all' | null>(null)
  const [optionSearch, setOptionSearch] = useState('')
  const [search, setSearch] = useState(params.get('search') ?? '')
  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value); else next.delete(key)
    next.delete('batch')
    router.push(`/letters/discover${next.size ? `?${next}` : ''}`)
    setPanel(null); setOptionSearch('')
  }
  return <section aria-label={t('filters')} className="space-y-4">
    <form onSubmit={(event) => { event.preventDefault(); update('search', search.trim().slice(0, 80)) }} className="flex gap-2">
      <label className="flex-1"><span className="sr-only">{t('search')}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={80} placeholder={t('search')} className={inputClass} /></label>
      <button className={secondaryButtonClass} type="submit">{t('searchButton')}</button>
    </form>
    <div className="flex flex-wrap gap-2">
      {(Object.keys(FILTERS) as Filter[]).map((key) => <button key={key} type="button" aria-expanded={panel === key || panel === 'all'} onClick={() => { setPanel(panel === key ? null : key); setOptionSearch('') }} className={`rounded-full border px-3 py-2 text-sm ${params.get(key) ? 'border-accent/40 bg-accent/10' : 'border-foreground/15'}`}>{t(key)}{params.get(key) ? ` · ${params.get(key)}` : ''}</button>)}
      <button type="button" aria-expanded={panel === 'all'} onClick={() => { setPanel(panel === 'all' ? null : 'all'); setOptionSearch('') }} className="rounded-full border border-foreground/15 px-3 py-2 text-sm">{t('all')}</button>
      {params.size > 0 && <button type="button" onClick={() => { setSearch(''); setPanel(null); router.push('/letters/discover') }} className="px-2 text-sm underline underline-offset-4">{t('clear')}</button>}
    </div>
    {panel && <div className="space-y-4 rounded-lg border border-foreground/15 bg-surface-shell p-4">
      <div className="flex items-center justify-between"><p className="text-sm font-semibold">{panel === 'all' ? t('all') : t(panel)}</p><button type="button" onClick={() => setPanel(null)} className="text-sm underline">{t('done')}</button></div>
      <label className="block"><span className="sr-only">{t('findOption')}</span><input type="search" value={optionSearch} onChange={(event) => setOptionSearch(event.target.value)} placeholder={t('findOption')} className={inputClass}/></label>
      <div className={panel === 'all' ? 'grid gap-4 sm:grid-cols-2' : ''}>
        {(panel === 'all' ? Object.keys(FILTERS) as Filter[] : [panel]).map((key) => <fieldset key={key} className="min-w-0"><legend className="mb-2 text-xs font-semibold uppercase tracking-wider">{t(key)}</legend><div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
          <button type="button" aria-pressed={!params.get(key)} onClick={() => update(key, '')} className="rounded-md border border-foreground/15 px-3 py-2 text-sm">{t('any')}</button>
          {FILTERS[key].filter((option) => option.label.toLowerCase().includes(optionSearch.toLowerCase())).map((option) => <button type="button" key={option.value} aria-pressed={params.get(key) === option.value} onClick={() => update(key, option.value)} className={`rounded-md border px-3 py-2 text-sm ${params.get(key) === option.value ? 'border-accent bg-accent/10' : 'border-foreground/15'}`}>{option.label}</button>)}
        </div></fieldset>)}
      </div>
    </div>}
  </section>
}
