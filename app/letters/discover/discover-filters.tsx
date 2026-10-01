'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { COUNTRY_OPTIONS, LANGUAGE_OPTIONS, AGE_RANGE_OPTIONS, GENDER_OPTIONS, INTENT_OPTIONS } from '@/app/profile/data'
import { INTEREST_TAXONOMY } from '@/lib/interests'
import { inputClass, secondaryButtonClass } from '@/app/profile/ui'

const FILTERS = { country: COUNTRY_OPTIONS, language: LANGUAGE_OPTIONS, age: AGE_RANGE_OPTIONS, gender: GENDER_OPTIONS, intent: INTENT_OPTIONS, interest: INTEREST_TAXONOMY.map(({ key, label }) => ({ value: key, label })) }
type Filter = keyof typeof FILTERS

export default function DiscoverFilters({ values, onChange }: { values: Record<string, string>; onChange: (values: Record<string, string>) => void }) {
  const t = useTranslations('Discovery')
  const interestT = useTranslations('ProfileSetup.interestOptions')
  const intentT = useTranslations('ProfileSetup.intentOptions')
  const genderT = useTranslations('ProfileSetup.genderOptions')
  function optionLabel(key: Filter, value: string, fallback: string) {
    if (key === 'interest') return interestT(value as Parameters<typeof interestT>[0])
    if (key === 'intent') return intentT(value as Parameters<typeof intentT>[0])
    if (key === 'gender') return genderT(value as Parameters<typeof genderT>[0])
    return fallback
  }
  function selectedLabel(key: Filter) {
    const option = FILTERS[key].find(option => option.value === values[key])
    return option ? optionLabel(key, option.value, option.label) : values[key]
  }
  const [panel, setPanel] = useState<Filter | 'all' | null>(null)
  const [optionSearch, setOptionSearch] = useState('')
  const [search, setSearch] = useState(values.search ?? '')
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel(null) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [])
  function update(key: string, value: string) {
    onChange({ ...values, [key]: value })
    setPanel(null); setOptionSearch('')
  }
  return <section aria-label={t('filters')} className="space-y-4">
    <form onSubmit={(event) => { event.preventDefault(); update('search', search.trim().slice(0, 80)) }} className="flex gap-2">
      <label className="flex-1"><span className="sr-only">{t('search')}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={80} placeholder={t('search')} className={inputClass} /></label>
      <button className={secondaryButtonClass} type="submit">{t('searchButton')}</button>
    </form>
    <div className="flex flex-wrap gap-2">
      {(Object.keys(FILTERS) as Filter[]).map((key) => <button key={key} type="button" aria-expanded={panel === key || panel === 'all'} onClick={() => { setPanel(panel === key ? null : key); setOptionSearch('') }} className={`rounded-full border px-3 py-2 text-sm ${values[key] ? 'border-accent/40 bg-accent/10' : 'border-foreground/15'}`}>{t(key)}{values[key] ? ` · ${selectedLabel(key)}` : ''}</button>)}
      <button type="button" aria-expanded={panel === 'all'} onClick={() => { setPanel(panel === 'all' ? null : 'all'); setOptionSearch('') }} className="rounded-full border border-foreground/15 px-3 py-2 text-sm">{t('all')}</button>
      {Object.values(values).some(Boolean) && <button type="button" onClick={() => { setSearch(''); setPanel(null); onChange({}) }} className="px-2 text-sm underline underline-offset-4">{t('clear')}</button>}
    </div>
    {panel && <div className="space-y-4 rounded-lg border border-foreground/15 bg-surface-shell p-4">
      <div className="flex items-center justify-between"><p className="text-sm font-semibold">{panel === 'all' ? t('all') : t(panel)}</p><button type="button" onClick={() => setPanel(null)} className="text-sm underline">{t('done')}</button></div>
      <label className="block"><span className="sr-only">{t('findOption')}</span><input type="search" value={optionSearch} onChange={(event) => setOptionSearch(event.target.value)} placeholder={t('findOption')} className={inputClass}/></label>
      <div className={panel === 'all' ? 'grid gap-4 sm:grid-cols-2' : ''}>
        {(panel === 'all' ? Object.keys(FILTERS) as Filter[] : [panel]).map((key) => <fieldset key={key} className="min-w-0"><legend className="mb-2 text-xs font-semibold uppercase tracking-wider">{t(key)}</legend><div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
          <button type="button" aria-pressed={!values[key]} onClick={() => update(key, '')} className="rounded-md border border-foreground/15 px-3 py-2 text-sm">{t('any')}</button>
          {FILTERS[key].map(option => ({ ...option, label: optionLabel(key, option.value, option.label) })).filter((option) => option.label.toLowerCase().includes(optionSearch.toLowerCase())).map((option) => <button type="button" key={option.value} aria-pressed={values[key] === option.value} onClick={() => update(key, option.value)} className={`rounded-md border px-3 py-2 text-sm ${values[key] === option.value ? 'border-accent bg-accent/10' : 'border-foreground/15'}`}>{option.label}</button>)}
        </div></fieldset>)}
      </div>
    </div>}
  </section>
}
