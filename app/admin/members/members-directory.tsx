'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { listMembers, type AccountStatus, type MemberListRow } from '@/lib/admin'
import { inputClass, secondaryButtonClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { formatDateTimeFull } from '@/lib/format-date'
import { debounce } from '@/lib/debounce'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import { publicProfileMarkUrl } from '@/lib/profile-marks'

const PAGE_SIZE = 25
const STATUS_OPTIONS: { value: AccountStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'banned', label: 'Banned' },
]

/**
 * Admin Operations Refinement checkpoint — the whole Members directory
 * as one client component: a server-paginated default listing (newest
 * first) that never fetches more than PAGE_SIZE rows at a time,
 * debounced pseudonym search (300ms, matching app/letters/letterbox-
 * search.tsx's established pattern), and account-status/country
 * filters. Every change re-queries admin_list_members with a fresh
 * limit/offset — never a client-side "fetch all then filter."
 * Seeded with the server component's first-paint page so there's no
 * loading flash on open.
 */
export default function MembersDirectory({
  initialMembers,
  initialError,
}: {
  initialMembers: MemberListRow[]
  initialError: string | null
}) {
  const supabase = createClient()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<AccountStatus | ''>('')
  const [country, setCountry] = useState('')
  const [page, setPage] = useState(0)
  const [members, setMembers] = useState(initialMembers)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialError)
  const activeRequestRef = useRef(0)

  function fetchPage(nextQuery: string, nextStatus: AccountStatus | '', nextCountry: string, nextPage: number) {
    const requestId = ++activeRequestRef.current
    setLoading(true)
    const supabase = createClient()
    void listMembers(supabase, {
      query: nextQuery || undefined,
      status: nextStatus || undefined,
      country: nextCountry || undefined,
      limit: PAGE_SIZE,
      offset: nextPage * PAGE_SIZE,
    }).then(({ data, error: fetchError }) => {
      // Guard against an out-of-order response overwriting a later one.
      if (requestId !== activeRequestRef.current) return
      setLoading(false)
      if (fetchError) {
        setError(fetchError.message)
        return
      }
      setError(null)
      setMembers(data)
    })
  }

  // Constructed inside an effect, not during render — a ref must only
  // ever be read/written outside of render (same pattern as
  // app/letters/letterbox-search.tsx). null only for the brief instant
  // before the effect below has run, which no user interaction can
  // reach in practice; the optional chaining at each call site is just
  // honest typing, not a real race.
  const debouncerRef = useRef<ReturnType<
    typeof debounce<[string, AccountStatus | '', string]>
  > | null>(null)

  useEffect(() => {
    debouncerRef.current = debounce(
      (nextQuery: string, nextStatus: AccountStatus | '', nextCountry: string) => {
        fetchPage(nextQuery, nextStatus, nextCountry, 0)
      },
      300
    )
    return () => debouncerRef.current?.cancel()
  }, [])

  function handleQueryChange(value: string) {
    setQuery(value)
    setPage(0)
    debouncerRef.current?.call(value, status, country)
  }

  function handleStatusChange(value: AccountStatus | '') {
    setStatus(value)
    setPage(0)
    debouncerRef.current?.cancel()
    fetchPage(query, value, country, 0)
  }

  function handleCountryChange(value: string) {
    setCountry(value)
    setPage(0)
    debouncerRef.current?.call(query, status, value)
  }

  function goToPage(nextPage: number) {
    setPage(nextPage)
    debouncerRef.current?.cancel()
    fetchPage(query, status, country, nextPage)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search by pseudonym"
          className={`max-w-xs flex-1 ${inputClass}`}
        />
        <select
          value={status}
          onChange={(e) => handleStatusChange(e.target.value as AccountStatus | '')}
          className={inputClass}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={country}
          onChange={(e) => handleCountryChange(e.target.value)}
          placeholder="Country"
          className={`max-w-[10rem] ${inputClass}`}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {members.length === 0 ? (
        <p className={adminMetadataClass}>{loading ? 'Loading…' : 'No members found.'}</p>
      ) : (
        <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
          {members.map((m) => (
            <Link
              key={m.id}
              href={`/admin/members/${m.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-foreground/[.03]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <ProfileIdentityMark
                  identifier={m.id}
                  markUrl={m.markId ? publicProfileMarkUrl(supabase, `${m.markId}.png`) : null}
                  size="sm"
                />
                <div className="min-w-0">
                <p className={adminTableTextClass}>{m.pseudonym}</p>
                <p className={adminMetadataClass}>
                  {m.country ?? 'Unknown location'}
                  {m.createdAt ? ` · joined ${formatDateTimeFull(m.createdAt)}` : ''}
                </p>
                </div>
              </div>
              <span className={adminMetadataClass}>{m.status}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => goToPage(Math.max(page - 1, 0))}
          disabled={page === 0 || loading}
          className={secondaryButtonClass}
        >
          Previous
        </button>
        <p className={adminMetadataClass}>Page {page + 1}</p>
        <button
          type="button"
          onClick={() => goToPage(page + 1)}
          disabled={members.length < PAGE_SIZE || loading}
          className={secondaryButtonClass}
        >
          Next
        </button>
      </div>
    </div>
  )
}
