import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getHiddenCorrespondenceIds,
  getLetterboxPeople,
  type LetterboxPerson,
} from './letters'
import {
  getCorrespondenceRhythm,
  rhythmStatusCopy,
  rhythmTimingState,
} from './writing-rhythm'

export type RelationshipSurfaceState = 'established' | 'pending' | 'past'
export type PendingDirection = 'incoming' | 'outgoing' | null

export type RelationshipSurfacePerson = LetterboxPerson & {
  relationshipState: RelationshipSurfaceState
  pendingDirection: PendingDirection
  livingCorrespondenceId: string | null
  statusText: string
}

type CorrespondenceRow = {
  id: string
  participant_low: string
  participant_high: string
  status: string
  established_at: string | null
}

type VisibleLetterRow = {
  correspondence_id: string
  sender_id: string
  recipient_id: string
  reply_to_id: string | null
  created_at: string
  is_unread: boolean
}

function otherParticipant(row: CorrespondenceRow, viewerId: string) {
  return row.participant_low === viewerId ? row.participant_high : row.participant_low
}

/**
 * Viewer-safe lifecycle classification for one correspondence episode.
 *
 * A database row may already be status=active/established while the first
 * reciprocal reply is still travelling. We therefore require a reply that is
 * actually visible through letters_for_participant before the VIEWER sees the
 * relationship as established. This preserves Tempa's delayed-mail privacy.
 */
export function classifyVisibleRelationshipEpisode(
  correspondence: Pick<CorrespondenceRow, 'status' | 'established_at'>,
  hasVisibleReply: boolean
): RelationshipSurfaceState {
  if (
    correspondence.status === 'active' &&
    correspondence.established_at !== null &&
    hasVisibleReply
  ) {
    return 'established'
  }

  if (correspondence.status === 'pending' || (correspondence.status === 'active' && !hasVisibleReply)) {
    return 'pending'
  }

  return 'past'
}

const STATE_PRIORITY: Record<RelationshipSurfaceState, number> = {
  established: 3,
  pending: 2,
  past: 1,
}

/**
 * Collapse multiple historical episodes with the same person into the state
 * that matters now. A living established correspondence wins over a pending
 * or historical episode; a pending attempt wins over history. Recency breaks
 * ties within the same state.
 */
export function chooseRelationshipEpisode<T extends {
  state: RelationshipSurfaceState
  activityAt: number
}>(episodes: T[]): T | null {
  return [...episodes].sort((a, b) => {
    const stateDifference = STATE_PRIORITY[b.state] - STATE_PRIORITY[a.state]
    return stateDifference !== 0 ? stateDifference : b.activityAt - a.activityAt
  })[0] ?? null
}

/**
 * Shared Phase 4 relationship model for Home and Letterbox.
 *
 * It deliberately reads only viewer-visible letter metadata: no undelivered
 * body or reply is exposed. The mature getLetterboxPeople() function remains
 * responsible for identity/excerpt/unread aggregation; this helper layers the
 * canonical lifecycle/rhythm state over it.
 */
export async function getRelationshipSurfacePeople(
  supabase: SupabaseClient,
  viewerId: string
): Promise<RelationshipSurfacePerson[]> {
  const [people, { data: correspondenceRows }, hiddenIds] = await Promise.all([
    getLetterboxPeople(supabase, viewerId),
    supabase
      .from('correspondences')
      .select('id, participant_low, participant_high, status, established_at')
      .or(`participant_low.eq.${viewerId},participant_high.eq.${viewerId}`),
    getHiddenCorrespondenceIds(supabase, viewerId),
  ])

  if (people.length === 0) return []

  const correspondences = ((correspondenceRows ?? []) as CorrespondenceRow[]).filter(
    (row) => !hiddenIds.has(row.id)
  )
  if (correspondences.length === 0) return []

  const correspondenceIds = correspondences.map((row) => row.id)
  const { data: letterRows } = await supabase
    .from('letters_for_participant')
    .select('correspondence_id, sender_id, recipient_id, reply_to_id, created_at, is_unread')
    .in('correspondence_id', correspondenceIds)
    .order('created_at', { ascending: false })

  const letters = (letterRows ?? []) as VisibleLetterRow[]
  const lettersByCorrespondence = new Map<string, VisibleLetterRow[]>()
  for (const letter of letters) {
    const existing = lettersByCorrespondence.get(letter.correspondence_id) ?? []
    existing.push(letter)
    lettersByCorrespondence.set(letter.correspondence_id, existing)
  }

  const episodesByPerson = new Map<
    string,
    {
      correspondenceId: string
      state: RelationshipSurfaceState
      pendingDirection: PendingDirection
      activityAt: number
      latestLetter: VisibleLetterRow | null
    }[]
  >()

  for (const correspondence of correspondences) {
    const otherId = otherParticipant(correspondence, viewerId)
    const episodeLetters = lettersByCorrespondence.get(correspondence.id) ?? []
    const latestLetter = episodeLetters[0] ?? null
    const hasVisibleReply = episodeLetters.some((letter) => letter.reply_to_id !== null)
    const state = classifyVisibleRelationshipEpisode(correspondence, hasVisibleReply)
    const rootLetter = [...episodeLetters].reverse().find((letter) => letter.reply_to_id === null) ?? null
    const pendingDirection: PendingDirection =
      state !== 'pending' || !rootLetter
        ? null
        : rootLetter.sender_id === viewerId
          ? 'outgoing'
          : 'incoming'
    const activityAt = latestLetter ? new Date(latestLetter.created_at).getTime() : 0

    const existing = episodesByPerson.get(otherId) ?? []
    existing.push({
      correspondenceId: correspondence.id,
      state,
      pendingDirection,
      activityAt,
      latestLetter,
    })
    episodesByPerson.set(otherId, existing)
  }

  const baseByPerson = new Map(people.map((person) => [person.userId, person]))
  const result: RelationshipSurfacePerson[] = []

  for (const [otherId, episodes] of episodesByPerson) {
    const base = baseByPerson.get(otherId)
    if (!base) continue

    const chosen = chooseRelationshipEpisode(episodes)
    if (!chosen) continue

    let statusText: string

    if (chosen.state === 'pending') {
      statusText = chosen.pendingDirection === 'incoming'
        ? 'A first letter is waiting'
        : chosen.pendingDirection === 'outgoing'
          ? 'Your first letter is waiting for a response'
          : 'A correspondence is waiting to begin'
    } else if (chosen.state === 'past') {
      statusText = 'Past correspondence'
    } else if (base.unreadCount > 0) {
      statusText = 'Letter waiting'
    } else {
      const latestLetter = chosen.latestLetter
      const viewerTurn = latestLetter?.recipient_id === viewerId
      const counterpartTurn = latestLetter?.sender_id === viewerId
      const rhythm = await getCorrespondenceRhythm(supabase, chosen.correspondenceId)

      if (viewerTurn && latestLetter && rhythm) {
        const timing = rhythmTimingState({
          waitingSince: latestLetter.created_at,
          rhythm: rhythm.viewerRhythm,
        })
        statusText = rhythmStatusCopy({
          whoseTurn: 'viewer',
          timing,
          counterpartPseudonym: base.pseudonym,
        }) ?? 'Your turn'
      } else if (counterpartTurn && latestLetter && rhythm) {
        const timing = rhythmTimingState({
          waitingSince: latestLetter.created_at,
          rhythm: rhythm.counterpartRhythm,
        })
        statusText = rhythmStatusCopy({
          whoseTurn: 'counterpart',
          timing,
          counterpartPseudonym: base.pseudonym,
        }) ?? 'Quiet right now'
      } else {
        statusText = base.lastLetterFromViewer ? 'Quiet right now' : 'Your correspondence continues'
      }
    }

    result.push({
      ...base,
      relationshipState: chosen.state,
      pendingDirection: chosen.pendingDirection,
      livingCorrespondenceId: chosen.state === 'past' ? null : chosen.correspondenceId,
      statusText,
    })
  }

  return result.sort((a, b) => {
    const stateDifference = STATE_PRIORITY[b.relationshipState] - STATE_PRIORITY[a.relationshipState]
    return stateDifference !== 0 ? stateDifference : b.activityAt - a.activityAt
  })
}
