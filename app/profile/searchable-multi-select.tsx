'use client'

import { useEffect, useRef, useState } from 'react'
import type { Option } from './data'
import { inputClass } from './ui'

export default function SearchableMultiSelect({
  id,
  values,
  onChange,
  options,
  placeholder,
  allowCustom = false,
}: {
  id: string
  values: string[]
  onChange: (values: string[]) => void
  options: Option[]
  placeholder?: string
  allowCustom?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const trimmedQuery = query.trim()

  const filtered = options
    .filter((o) => !values.includes(o.value))
    .filter((o) =>
      trimmedQuery ? o.label.toLowerCase().includes(trimmedQuery.toLowerCase()) : true
    )
    .slice(0, 100)

  const exactMatch = options.some(
    (o) => o.label.toLowerCase() === trimmedQuery.toLowerCase()
  )
  const alreadyAdded = values.some(
    (v) => v.toLowerCase() === trimmedQuery.toLowerCase()
  )
  const showCustomOption =
    allowCustom && trimmedQuery.length > 1 && !exactMatch && !alreadyAdded

  const listLength = filtered.length + (showCustomOption ? 1 : 0)

  useEffect(() => {
    // Pointer events cover touch, pen and mouse consistently. The old
    // mousedown-only listener could leave the listbox open on phones,
    // covering the next onboarding field until the member happened to
    // tap elsewhere.
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  function addValue(value: string) {
    if (!values.includes(value)) {
      onChange([...values, value])
    }
    // A selection completes the interaction. Close immediately so the
    // dropdown never obscures the field below on a small screen; tapping
    // the control again still lets the member add more languages.
    setOpen(false)
    setQuery('')
    setHighlighted(0)
  }

  function removeValue(value: string) {
    onChange(values.filter((v) => v !== value))
  }

  function selectAtIndex(index: number) {
    if (index < filtered.length) {
      addValue(filtered[index].value)
    } else if (showCustomOption) {
      addValue(trimmedQuery)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault()
        setOpen(true)
        setHighlighted(0)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((h) => Math.min(h + 1, listLength - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      selectAtIndex(highlighted)
    } else if (e.key === 'Backspace' && query === '' && values.length > 0) {
      removeValue(values[values.length - 1])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className={`${inputClass} flex flex-wrap items-center gap-1.5 py-1.5`}>
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full border border-foreground/15 bg-foreground/[.03] px-2.5 py-1 text-sm"
          >
            {v}
            <button
              type="button"
              onClick={() => removeValue(v)}
              aria-label={`Remove ${v}`}
              className="text-muted transition-colors hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={`${id}-listbox`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setHighlighted(0)
          }}
          onFocus={() => {
            setOpen(true)
            setHighlighted(0)
          }}
          onKeyDown={handleKeyDown}
          placeholder={values.length === 0 ? placeholder : undefined}
          autoComplete="off"
          className="min-w-[8ch] flex-1 bg-transparent outline-none text-base py-0.5"
        />
      </div>
      {open && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-foreground/15 bg-background shadow-none"
        >
          {filtered.length === 0 && !showCustomOption && (
            <li className="px-3 py-2 text-sm text-muted">No matches</li>
          )}
          {filtered.map((option, index) => (
            <li key={option.value} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addValue(option.value)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  index === highlighted ? 'bg-accent/10' : 'hover:bg-foreground/[.04]'
                }`}
              >
                {option.label}
              </button>
            </li>
          ))}
          {showCustomOption && (
            <li role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addValue(trimmedQuery)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  filtered.length === highlighted ? 'bg-accent/10' : 'hover:bg-foreground/[.04]'
                }`}
              >
                Add &ldquo;{trimmedQuery}&rdquo;
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
