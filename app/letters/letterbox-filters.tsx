import type { LetterboxFilter } from '@/lib/letters'
import { pillClass } from '@/app/profile/ui'

const FILTERS: { value: LetterboxFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'sent', label: 'Sent' },
]

/**
 * Letterbox Level 1's entire filter surface — All / New / Sent, nothing
 * else. Operates purely on the already-fetched people list
 * (filterLetterboxPeople, lib/letters.ts) — switching tabs never
 * re-fetches. Same pill grammar as Minds' own tabs
 * (app/minds/page.tsx's MindsTabs) rather than inventing a new control.
 */
export default function LetterboxFilters({
  active,
  onChange,
}: {
  active: LetterboxFilter
  onChange: (filter: LetterboxFilter) => void
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter your Letterbox">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          role="tab"
          aria-selected={active === f.value}
          onClick={() => onChange(f.value)}
          className={pillClass(active === f.value)}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}
