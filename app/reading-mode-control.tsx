'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { focusRingClass } from '@/app/profile/ui'
import type { ReadingMode } from '@/lib/writing-style'

// The reader's own accommodation — never the author's choice, never
// stored with the letter. Remembered per device (like drafts), with an
// in-memory fallback so the control still works where storage is blocked.
const STORAGE_KEY = 'tempa-reading-view'
const listeners = new Set<() => void>()
let memoryMode: ReadingMode = 'original'

function readMode(): ReadingMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'reader' || stored === 'original') return stored
  } catch {
    /* storage unavailable — fall through to memory */
  }
  return memoryMode
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useReadingMode(): [ReadingMode, (mode: ReadingMode) => void] {
  const mode = useSyncExternalStore(subscribe, readMode, () => 'original' as ReadingMode)
  const setMode = useCallback((next: ReadingMode) => {
    memoryMode = next
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore — memory still holds it for this session */
    }
    listeners.forEach((l) => l())
  }, [])
  return [mode, setMode]
}

const optionClass = `rounded px-1 py-0.5 transition-colors ${focusRingClass}`

/** "Original · Reader view" — a quiet two-state control in Tempa's own
 *  interface type. Two toggle buttons (aria-pressed), so it is reachable
 *  and operable by keyboard and announced as a pressed/unpressed pair. */
export default function ReadingModeControl({
  mode,
  onChange,
  className = '',
}: {
  mode: ReadingMode
  onChange: (mode: ReadingMode) => void
  className?: string
}) {
  return (
    <div role="group" aria-label="Reading typography" className={`flex items-center gap-1 text-[13px] ${className}`}>
      <button
        type="button"
        aria-pressed={mode === 'original'}
        onClick={() => onChange('original')}
        className={`${optionClass} ${mode === 'original' ? 'font-medium text-foreground' : 'text-muted hover:text-foreground'}`}
      >
        Original
      </button>
      <span aria-hidden="true" className="text-muted">
        ·
      </span>
      <button
        type="button"
        aria-pressed={mode === 'reader'}
        onClick={() => onChange('reader')}
        className={`${optionClass} ${mode === 'reader' ? 'font-medium text-foreground' : 'text-muted hover:text-foreground'}`}
      >
        Reader view
      </button>
    </div>
  )
}
