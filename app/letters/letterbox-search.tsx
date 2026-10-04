'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { debounce } from '@/lib/debounce'
import { toSearchResults, type SearchPersonResult, type SearchLetterResult } from '@/lib/search'
import { inputClass } from '@/app/profile/ui'
import type { RelationshipSurfacePerson } from '@/lib/relationship-surface'
import PeopleGrid from './people-grid'
import SearchResultsPanel, { type SearchStatus } from './search-results-panel'
import { publicProfileMarkUrl } from '@/lib/profile-marks'

const DEBOUNCE_MS = 300
const PEOPLE_LIMIT = 5
const LETTERS_LIMIT = 20

async function enrichPersonMarks(
  supabase: ReturnType<typeof createClient>,
  people: SearchPersonResult[]
): Promise<SearchPersonResult[]> {
  if (people.length === 0) return people
  const { data } = await supabase
    .from('public_profiles')
    .select('id, mark_id')
    .in('id', people.map((person) => person.personId))
  const markIdByPersonId = new Map((data ?? []).map((profile) => [profile.id, profile.mark_id]))
  return people.map((person) => {
    const markId = markIdByPersonId.get(person.personId)
    return {
      ...person,
      markUrl: markId ? publicProfileMarkUrl(supabase, `${markId}.png`) : null,
    }
  })
}

/**
 * Letterbox search spans people and letters the member already has here.
 * Empty search returns to the relationship-first Correspondence / First
 * letters / Past correspondence view unchanged.
 */
export default function LetterboxSearch({
  people,
  mailInTransitPersonIds,
}: {
  people: RelationshipSurfacePerson[]
  mailInTransitPersonIds: Set<string>
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [personResults, setPersonResults] = useState<SearchPersonResult[]>([])
  const [letterResults, setLetterResults] = useState<SearchLetterResult[]>([])
  const [lettersOffset, setLettersOffset] = useState(0)
  const [hasMoreLetters, setHasMoreLetters] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const activeQueryRef = useRef('')

  async function runSearch(q: string) {
    activeQueryRef.current = q

    if (q.trim() === '') {
      setStatus('idle')
      setPersonResults([])
      setLetterResults([])
      setLettersOffset(0)
      setHasMoreLetters(false)
      return
    }

    setStatus('loading')
    const supabase = createClient()
    const { data, error } = await supabase.rpc('search_letterbox', {
      p_query: q,
      p_people_limit: PEOPLE_LIMIT,
      p_letters_limit: LETTERS_LIMIT,
      p_letters_offset: 0,
    })

    if (activeQueryRef.current !== q) return

    if (error) {
      console.error('[letters] search failed', { message: error.message, code: error.code })
      setStatus('error')
      return
    }

    const results = toSearchResults(data ?? [])
    const letters = results.filter((r): r is SearchLetterResult => r.kind === 'letter')
    const foundPeople = results.filter((r): r is SearchPersonResult => r.kind === 'person')
    const peopleWithMarks = await enrichPersonMarks(supabase, foundPeople)
    if (activeQueryRef.current !== q) return
    setPersonResults(peopleWithMarks)
    setLetterResults(letters)
    setLettersOffset(letters.length)
    setHasMoreLetters(letters.length === LETTERS_LIMIT)
    setStatus('idle')
  }

  const debouncerRef = useRef<ReturnType<typeof debounce<[string]>> | null>(null)

  useEffect(() => {
    debouncerRef.current = debounce(runSearch, DEBOUNCE_MS)
    return () => debouncerRef.current?.cancel()
  }, [])

  function handleChange(next: string) {
    setQuery(next)
    if (next.trim() === '') {
      debouncerRef.current?.cancel()
      runSearch(next)
      return
    }
    debouncerRef.current?.call(next)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      debouncerRef.current?.flush(query)
    }
  }

  async function handleShowMoreLetters() {
    setLoadingMore(true)
    const supabase = createClient()
    const { data, error } = await supabase.rpc('search_letterbox', {
      p_query: query,
      p_people_limit: PEOPLE_LIMIT,
      p_letters_limit: LETTERS_LIMIT,
      p_letters_offset: lettersOffset,
    })
    setLoadingMore(false)

    if (error) {
      console.error('[letters] search (show more) failed', { message: error.message, code: error.code })
      setStatus('error')
      return
    }

    const moreLetters = toSearchResults(data ?? []).filter(
      (r): r is SearchLetterResult => r.kind === 'letter'
    )
    setLetterResults((prev) => [...prev, ...moreLetters])
    setLettersOffset((prev) => prev + moreLetters.length)
    setHasMoreLetters(moreLetters.length === LETTERS_LIMIT)
  }

  const isSearching = query.trim() !== ''

  return (
    <div className="space-y-6">
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search your correspondence…"
        aria-label="Search your correspondence"
        className={inputClass}
      />

      {isSearching ? (
        <SearchResultsPanel
          query={query}
          status={status}
          personResults={personResults}
          letterResults={letterResults}
          hasMoreLetters={hasMoreLetters}
          loadingMore={loadingMore}
          onShowMoreLetters={handleShowMoreLetters}
        />
      ) : (
        <PeopleGrid people={people} mailInTransitPersonIds={mailInTransitPersonIds} />
      )}
    </div>
  )
}
