'use client'
import { useRef, useState } from 'react'
import type { CorrespondentChoice } from '@/lib/correspondent-trigger'
import { retainedMentions, type MentionSelection } from '@/lib/public-mentions'

export function usePublicMentions(storageKey: string | null) {
  const [people, setPeople] = useState<MentionSelection[]>(() => {
    if (!storageKey) return []
    try {
      const data = JSON.parse(localStorage.getItem(`${storageKey}:mentions`) ?? '[]')
      return Array.isArray(data) ? data.filter(p => typeof p?.userId === 'string' && typeof p?.pseudonym === 'string') : []
    } catch { return [] }
  })
  const current = useRef(people)
  function save(next: MentionSelection[]) {
    current.current = next; setPeople(next)
    try { if (storageKey) localStorage.setItem(`${storageKey}:mentions`, JSON.stringify(next)) } catch { /* storage optional */ }
  }
  return {
    people,
    select: (person: CorrespondentChoice) => { save([...current.current.filter(p => p.userId !== person.userId), { userId: person.userId, pseudonym: person.pseudonym }]); return true },
    retained: (body: string) => retainedMentions(body, current.current),
    clear: () => { save([]); try { if (storageKey) localStorage.removeItem(`${storageKey}:mentions`) } catch { /* storage optional */ } },
  }
}
