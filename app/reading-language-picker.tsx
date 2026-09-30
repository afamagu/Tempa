'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import {
  readingLanguage,
  searchReadingLanguages,
  suggestReadingLanguage,
  type ReadingLanguage,
} from '@/lib/reading-languages'
import { helperTextClass, inputClass } from '@/app/profile/ui'

/**
 * A quiet, searchable list of Reading languages — the same control for
 * You → Reading language and, later, a reading surface's "Read in…" choice.
 * Each option shows the language's own name (in its own script and
 * direction) with the English name beneath. No flags, no countries.
 *
 * The browser's language list may HIGHLIGHT one option as a suggestion,
 * after mount only (so server and client render the same markup). It is
 * never selected or saved on the member's behalf.
 */
export default function ReadingLanguagePicker({
  value,
  onSelect,
  disabled = false,
}: {
  value: string | null
  onSelect: (code: string) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [suggested, setSuggested] = useState<string | null>(null)
  const searchId = useId()
  const listId = useId()

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const code = suggestReadingLanguage(navigator.languages?.length ? navigator.languages : [navigator.language])
    // Adopting a browser-only value after hydration is the point here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSuggested(code)
  }, [])

  const results = useMemo(() => searchReadingLanguages(query), [query])
  const suggestion = !query && suggested && suggested !== value ? readingLanguage(suggested) : null

  return (
    <div className="space-y-3">
      <label htmlFor={searchId} className="sr-only">
        Search languages
      </label>
      <input
        id={searchId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search languages"
        autoComplete="off"
        spellCheck={false}
        aria-controls={listId}
        disabled={disabled}
        className={inputClass}
      />

      {suggestion && (
        <div className="space-y-1.5">
          <p className={helperTextClass}>Suggested from this device</p>
          <LanguageOption language={suggestion} selected={false} disabled={disabled} onSelect={onSelect} />
        </div>
      )}

      <ul
        id={listId}
        aria-label="Languages"
        className="max-h-[min(60vh,28rem)] space-y-1 overflow-y-auto overscroll-contain rounded-md border border-foreground/10 p-1"
      >
        {results.map((language) => (
          <li key={language.code}>
            <LanguageOption
              language={language}
              selected={language.code === value}
              disabled={disabled}
              onSelect={onSelect}
            />
          </li>
        ))}
        {results.length === 0 && <li className={`${helperTextClass} px-3 py-2.5`}>No language matches that search.</li>}
      </ul>
    </div>
  )
}

function LanguageOption({
  language,
  selected,
  disabled,
  onSelect,
}: {
  language: ReadingLanguage
  selected: boolean
  disabled: boolean
  onSelect: (code: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(language.code)}
      aria-pressed={selected}
      disabled={disabled}
      className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-50 ${
        selected ? 'bg-accent/[.08]' : 'hover:bg-foreground/[.04]'
      }`}
    >
      <span className="min-w-0">
        <span lang={language.code} dir={language.direction} className="block text-[15px] text-foreground">
          {language.nativeName}
        </span>
        {language.nativeName !== language.name && (
          <span className="block text-[13px] text-muted">{language.name}</span>
        )}
      </span>
      {selected && <span className="shrink-0 text-[13px] text-muted">Current</span>}
    </button>
  )
}
