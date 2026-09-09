'use client'

import { useState, type KeyboardEvent } from 'react'
import { helperTextClass } from '@/app/profile/ui'

const TOPIC_MAX_COUNT = 3

/**
 * A plain tag input — never hashtags in the UI, no tag pages/following/
 * trending anywhere (see the Build Guide's Dispatches section).
 * normalizeTopics (lib/dispatches.ts) is the actual source of truth for
 * count/dedup/trim; this only decides when to call onChange.
 */
export default function TopicInput({
  topics,
  onChange,
}: {
  topics: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  function commitDraft() {
    const value = draft.trim()
    if (value.length === 0 || topics.length >= TOPIC_MAX_COUNT) {
      setDraft('')
      return
    }
    onChange([...topics, value])
    setDraft('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitDraft()
    }
  }

  function removeTopic(topic: string) {
    onChange(topics.filter((t) => t !== topic))
  }

  return (
    <div className="space-y-2">
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topics.map((topic) => (
            <span
              key={topic}
              className="flex items-center gap-1 rounded-full border border-foreground/15 py-0.5 pl-2.5 pr-1 text-[13px] text-foreground/80"
            >
              {topic}
              <button
                type="button"
                onClick={() => removeTopic(topic)}
                aria-label={`Remove topic ${topic}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-foreground/50 hover:bg-foreground/10 hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {topics.length < TOPIC_MAX_COUNT && (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitDraft}
          maxLength={40}
          placeholder="Add a topic, press Enter"
          aria-label="Add a topic"
          className="w-full max-w-xs rounded-md border border-foreground/15 bg-transparent px-3 py-1.5 text-[14px] outline-none transition-colors placeholder:text-muted focus:border-accent"
        />
      )}
      {topics.length >= TOPIC_MAX_COUNT && <p className={helperTextClass}>Up to 3 topics.</p>}
    </div>
  )
}
