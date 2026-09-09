// The one shared date/time formatter for every visible date/time in
// Tempa. Database timestamps stay UTC/timestamptz always; formatting
// here always goes through `new Date(iso)` and the browser/device's own
// locale + timezone (`toLocaleString`'s implicit default), which is the
// viewing member's local time — never inferred from country, never
// hard-coded to a fixed zone. A later explicit timezone preference can
// slot in here (a second parameter) without touching any call site.

/**
 * Compact relative/absolute date+time for a list row or a letter
 * header: "2:10 PM" today, "Tue" within the last few days, "Aug 31" or
 * "Aug 31, 2026" otherwise.
 */
export function formatDateTimeCompact(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  if (date.toDateString() === now.toDateString()) return time

  const daysAgo = (now.getTime() - date.getTime()) / 86_400_000
  if (daysAgo > 0 && daysAgo < 6) return date.toLocaleDateString(undefined, { weekday: 'short' })

  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(
    undefined,
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
  )
}

/**
 * Fuller "Today · 2:10 PM" / "Yesterday · 2:10 PM" / "Aug 31 · 2:10 PM"
 * form — for a single letter's own header inside the correspondence
 * thread, where the extra context reads better than the compact list
 * form above.
 */
export function formatDateTimeFull(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  if (date.toDateString() === now.toDateString()) return `Today · ${time}`

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday · ${time}`

  const sameYear = date.getFullYear() === now.getFullYear()
  const dateLabel = date.toLocaleDateString(
    undefined,
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
  )
  return `${dateLabel} · ${time}`
}

/** Plain date, no time — for a published answer's date, an account
 * event, anything that never needs a time-of-day component. */
export function formatDatePlain(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
