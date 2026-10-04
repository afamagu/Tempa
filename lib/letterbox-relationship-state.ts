import type { SupabaseClient } from '@supabase/supabase-js'
import type { LetterboxPerson } from './letters'
import {
  getCorrespondenceRhythm,
  rhythmStatusCopy,
  rhythmTimingState,
  type CorrespondenceRhythmState,
} from './writing-rhythm'

export type LetterboxRelationshipGroup = 'current' | 'pending' | 'past'

export type LetterboxRelationshipState = {
  group: LetterboxRelationshipGroup
  correspondenceId: string | null
  statusLabel: string
}

type CorrespondenceRow = {
  id: string
  participant_low: string
  participant_high: string
  status: string
  established_at: string | null
}

function counterpartId(row: CorrespondenceRow, viewerId: string) {
  return row.participant_low === viewerId ? row.participant_high : row.participant_low
}

function chooseCurrentEpisode(rows: CorrespondenceRow[]) {
  return (
    rows.find((row) => row.status === 'active' && row.established_at !== null) ??
    rows.find((row) => row.status === 'pending' && row.established_at === null) ??
    null
  )
}

export function relationshipStatusLabel({
  person,
  group,
  rhythm,
  now = new Date(),
}: {
  person: LetterboxPerson
  group: LetterboxRelationshipGroup
  rhythm: CorrespondenceRhythmState | null
  now?: Date
}): string {
  if (person.unreadCount > 0) return 'Letter waiting'

  if (group === 'past') return 'Past correspondence'

  if (group === 'pending') {
    return person.lastLetterFromViewer ? 'Waiting to hear back' : 'First letter waiting'
  }

  if (person.lastLetterFromViewer) {
    const timing = rhythmTimingState({
      waitingSince: new Date(person.activityAt),
      rhythm: rhythm?.counterpartRhythm ?? null,
      now,
    })
    return (
      rhythmStatusCopy({
        whoseTurn: 'counterpart',
        timing,
        counterpartPseudonym: person.pseudonym,
      }) ?? 'Quiet right now'
    )
  }

  const timing = rhythmTimingState({
    waitingSince: new Date(person.activityAt),
    rhythm: rhythm?.viewerRhythm ?? null,
    now,
  })
  return (
    rhythmStatusCopy({
      whoseTurn: 'viewer',
      timing,
      counterpartPseudonym: person.pseudonym,
    }) ?? 'Your turn'
  )
}

/**
 * One relationship-state read for Home and Letterbox. Historical episodes are
 * preserved, but the currently established episode always wins over an older
 * closed episode with the same person. Rhythm RPCs run only for established
 * current correspondences; the pilot cap keeps that set deliberately small.
 */
export async function getLetterboxRelationshipStates(
  supabase: SupabaseClient,
  viewerId: string,
  people: LetterboxPerson[]
): Promise<Record<string, LetterboxRelationshipState>> {
  if (people.length === 0) return {}

  const personIds = new Set(people.map((person) => person.userId))
  const { data } = await supabase
    .from('correspondences')
    .select('id, participant_low, participant_high, status, established_at')
    .or(`participant_low.eq.${viewerId},participant_high.eq.${viewerId}`)

  const byPerson = new Map<string, CorrespondenceRow[]>()
  for (const raw of (data ?? []) as CorrespondenceRow[]) {
    const otherId = counterpartId(raw, viewerId)
    if (!personIds.has(otherId)) continue
    const existing = byPerson.get(otherId) ?? []
    existing.push(raw)
    byPerson.set(otherId, existing)
  }

  const currentByPerson = new Map<string, CorrespondenceRow | null>()
  for (const person of people) {
    currentByPerson.set(person.userId, chooseCurrentEpisode(byPerson.get(person.userId) ?? []))
  }

  const rhythmEntries = await Promise.all(
    people.map(async (person) => {
      const current = currentByPerson.get(person.userId)
      if (!current || current.status !== 'active' || !current.established_at) {
        return [person.userId, null] as const
      }
      return [person.userId, await getCorrespondenceRhythm(supabase, current.id)] as const
    })
  )
  const rhythmByPerson = new Map(rhythmEntries)

  const result: Record<string, LetterboxRelationshipState> = {}
  for (const person of people) {
    const current = currentByPerson.get(person.userId)
    const group: LetterboxRelationshipGroup = current
      ? current.status === 'active' && current.established_at
        ? 'current'
        : 'pending'
      : 'past'

    result[person.userId] = {
      group,
      correspondenceId: current?.id ?? null,
      statusLabel: relationshipStatusLabel({
        person,
        group,
        rhythm: rhythmByPerson.get(person.userId) ?? null,
      }),
    }
  }

  return result
}
