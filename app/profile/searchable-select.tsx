'use client'

import { useEffect, useRef, useState } from 'react'
import type { Option } from './data'
import { inputClass } from './ui'

export default function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedLabel = options.find((o) => o.value === value)?.label ?? ''

  const filtered = (
    query
      ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
      : options
  ).slice(0, 100)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function selectOption(option: Option) {
    onChange(option.value)
    setQuery('')
    setOpen(false)
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
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const option = filtered[highlighted]
      if (option) selectOption(option)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={`${id}-listbox`}
        disabled={disabled}
        value={open ? query : selectedLabel}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setHighlighted(0)
        }}
        onFocus={() => {
          setQuery('')
          setOpen(true)
          setHighlighted(0)
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClass}
      />
      {open && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-black/10 dark:border-white/20 bg-background shadow-lg"
        >
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-black/50 dark:text-white/50">
              No matches
            </li>
          )}
          {filtered.map((option, index) => (
            <li key={option.value} role="option" aria-selected={option.value === value}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectOption(option)}
                className={`w-full text-left px-3 py-2 text-sm ${
                  index === highlighted
                    ? 'bg-black/[.06] dark:bg-white/[.1]'
                    : 'hover:bg-black/[.04] dark:hover:bg-white/[.08]'
                }`}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
