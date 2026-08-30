'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import SearchableSelect from '@/app/profile/searchable-select'
import { COUNTRY_OPTIONS, GENDER_OPTIONS, AGE_RANGE_OPTIONS } from '@/app/profile/data'
import { fieldLabelClass } from '@/app/profile/ui'

const ANY_OPTION = { value: '', label: 'Any' }
const COUNTRY_FILTER_OPTIONS = [ANY_OPTION, ...COUNTRY_OPTIONS]

export default function DiscoveryFilters({
  country,
  gender,
  ageRange,
}: {
  country: string
  gender: string
  ageRange: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="space-y-1">
        <label htmlFor="filter-country" className={fieldLabelClass}>
          Country
        </label>
        <SearchableSelect
          id="filter-country"
          value={country}
          onChange={(v) => updateParam('country', v)}
          options={COUNTRY_FILTER_OPTIONS}
          placeholder="Any"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="filter-gender" className={fieldLabelClass}>
          Gender
        </label>
        <select
          id="filter-gender"
          value={gender}
          onChange={(e) => updateParam('gender', e.target.value)}
          className="w-full rounded-md border border-black/10 dark:border-white/20 bg-transparent px-3 py-2.5 text-base outline-none focus:border-black/30 dark:focus:border-white/40"
        >
          <option value="">Any</option>
          {GENDER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="filter-age" className={fieldLabelClass}>
          Age range
        </label>
        <select
          id="filter-age"
          value={ageRange}
          onChange={(e) => updateParam('age', e.target.value)}
          className="w-full rounded-md border border-black/10 dark:border-white/20 bg-transparent px-3 py-2.5 text-base outline-none focus:border-black/30 dark:focus:border-white/40"
        >
          <option value="">Any</option>
          {AGE_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
