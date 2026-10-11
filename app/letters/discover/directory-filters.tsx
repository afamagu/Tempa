'use client'

import { useEffect, useState } from 'react'
import { COUNTRY_OPTIONS, LANGUAGE_OPTIONS, AGE_RANGE_OPTIONS, GENDER_OPTIONS, INTENT_OPTIONS } from '@/app/profile/data'
import { INTEREST_TAXONOMY } from '@/lib/interests'
import type { DirectoryFilters as DirectoryFilterValues } from '@/lib/room-directory'

const fieldClass = 'min-h-11 w-full rounded-md border border-foreground/15 bg-background px-3 py-2.5 text-[14px] text-foreground focus-visible:outline-2 focus-visible:outline-accent'
const labelClass = 'mb-2 block text-[12px] font-medium text-foreground/65'

function FilterSelect({
  label, value, options, onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return <label className="block min-w-0">
    <span className={labelClass}>{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass}>
      <option value="">Anywhere / Any</option>
      {options.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
    </select>
  </label>
}

export default function DirectoryFilters({
  values, onChange,
}: {
  values: DirectoryFilterValues
  onChange: (values: DirectoryFilterValues) => void
}) {
  const [search, setSearch] = useState(values.search ?? '')
  useEffect(() => { setSearch(values.search ?? '') }, [values.search])

  function update(key: keyof DirectoryFilterValues, value: string) {
    onChange({ ...values, [key]: value })
  }

  const advancedCount = ['age','gender','intent','interest'].filter(key => Boolean(values[key as keyof DirectoryFilterValues])).length
  const selectedCount = ['country','language','search','age','gender','intent','interest'].filter(key => Boolean(values[key as keyof DirectoryFilterValues])).length
    + (values.letters === 'all' ? 1 : 0)
  return <details className="group rounded-[5px] border border-[#dfd3c2] bg-[#fffdf8]">
    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-[14px] font-medium text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
      <span>Filter people {selectedCount ? <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">{selectedCount} selected</span> : <span className="ml-2 font-normal text-foreground/50">Place · Language</span>}</span>
      <span aria-hidden="true" className="text-lg text-foreground/60 transition-transform group-open:rotate-45">+</span>
    </summary>
    <div className="space-y-5 border-t border-[#e8ded1] px-5 pb-6 pt-5">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => {e.preventDefault(); update('search',search.trim().slice(0,80))}}>
        <label className="min-w-0 flex-1">
          <span className={labelClass}>Name or a particular place</span>
          <input type="search" value={search} maxLength={80} onChange={(e)=>setSearch(e.target.value)}
            className={fieldClass} placeholder="A name, country, or language" />
        </label>
        <button type="submit" className="self-end rounded-md border border-foreground/20 px-5 py-3 text-[13px] font-medium hover:bg-foreground/[.04]">Find</button>
      </form>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FilterSelect label="Place" value={values.country ?? ''} options={COUNTRY_OPTIONS} onChange={(value)=>update('country',value)} />
        <FilterSelect label="Language" value={values.language ?? ''} options={LANGUAGE_OPTIONS} onChange={(value)=>update('language',value)} />
      </div>
      <label className="flex cursor-pointer items-center gap-3 border-t border-foreground/10 pt-5 text-[14px]">
        <input type="checkbox" className="h-[17px] w-[17px] accent-[#455d4b]"
          checked={values.letters !== 'all'}
          onChange={(e)=>update('letters',e.target.checked ? '' : 'all')} />
        <span>
          <span className="block font-medium">Has left a letter</span>
          <span className="block text-[12px] text-foreground/60">Show people whose writing you can already read.</span>
        </span>
      </label>
      <details className="rounded-md border border-foreground/10 px-4 py-3">
        <summary className="cursor-pointer text-[13px] text-foreground/70">
          More filters{advancedCount ? ` · ${advancedCount} active` : ''}
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FilterSelect label="Age range" value={values.age ?? ''} options={AGE_RANGE_OPTIONS} onChange={(value)=>update('age',value)} />
          <FilterSelect label="Gender" value={values.gender ?? ''} options={GENDER_OPTIONS} onChange={(value)=>update('gender',value)} />
          <FilterSelect label="Looking for" value={values.intent ?? ''} options={INTENT_OPTIONS} onChange={(value)=>update('intent',value)} />
          <FilterSelect label="Interest" value={values.interest ?? ''} options={INTEREST_TAXONOMY.map(({key,label})=>({value:key,label}))} onChange={(value)=>update('interest',value)} />
        </div>
      </details>
      {selectedCount>0 && <button type="button" onClick={()=>{setSearch('');onChange({})}} className="text-[13px] text-foreground/60 underline underline-offset-4">Clear filters</button>}
    </div>
  </details>
}
