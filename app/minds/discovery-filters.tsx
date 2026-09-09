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
  onApply,
}: {
  country: string
  gender: string
  ageRange: string
  /** Called after a filter value changes — lets a mobile filter sheet
   * dismiss itself and return the member straight to the writing. */
  onApply?: () => void
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
    // A filter change starts a new eligible pool, so the batch position
    // resets to the first page of it.
    params.delete('batch')
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
    onApply?.()
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
          className="w-full rounded-md border border-foreground/15 bg-background text-foreground px-3 py-2.5 text-base outline-none transition-colors focus:border-accent"
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
          className="w-full rounded-md border border-foreground/15 bg-background text-foreground px-3 py-2.5 text-base outline-none transition-colors focus:border-accent"
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
