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
  type CorrespondenceRhythmState,
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
  body: string
}

type RelationshipEpisode = {
  correspondenceId: string
  state: RelationshipSurfaceState
  pendingDirection: PendingDirection
  activityAt: number
  latestLetter: VisibleLetterRow | null
  unreadCount: number
}

function otherParticipant(row: CorrespondenceRow, viewerId: string) {
  return row.participant_low === viewerId ? row.participant_high : row.participant_low
}

/**
 * Viewer-safe lifecycle classification for one correspondence episode.
 * A database row can already be established while its first reciprocal reply
 * is still travelling. The viewer therefore sees establishment only after a
 * reply is actually visible through letters_for_participant.
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
 * Collapse multiple episodes with the same person into the relationship that
 * matters now. Living established correspondence outranks pending attempts;
 * pending outranks history; recency only breaks ties inside the same state.
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

function establishedStatus({
  viewerId,
  person,
  episode,
  rhythm,
}: {
  viewerId: string
  person: LetterboxPerson
  episode: RelationshipEpisode
  rhythm: CorrespondenceRhythmState | null
}) {
  if (episode.unreadCount > 0) return 'Letter waiting'

  const latestLetter = episode.latestLetter
  const viewerTurn = latestLetter?.recipient_id === viewerId
  const counterpartTurn = latestLetter?.sender_id === viewerId

  if (viewerTurn && latestLetter && rhythm) {
    const timing = rhythmTimingState({
      waitingSince: latestLetter.created_at,
      rhythm: rhythm.viewerRhythm,
    })
    return rhythmStatusCopy({
      whoseTurn: 'viewer',
      timing,
      counterpartPseudonym: person.pseudonym,
    }) ?? 'Your turn'
  }

  if (counterpartTurn && latestLetter && rhythm) {
    const timing = rhythmTimingState({
      waitingSince: latestLetter.created_at,
      rhythm: rhythm.counterpartRhythm,
    })
    return rhythmStatusCopy({
      whoseTurn: 'counterpart',
      timing,
      counterpartPseudonym: person.pseudonym,
    }) ?? 'Quiet right now'
  }

  return latestLetter?.sender_id === viewerId
    ? 'Quiet right now'
    : 'Your correspondence continues'
}

/**
 * Shared Phase 4 relationship model for Home and Letterbox.
 *
 * Only viewer-visible letter metadata is read. Identity data still comes from
 * getLetterboxPeople(), but activity, excerpt, unread state and turn state are
 * re-scoped to the chosen current episode so an old closed episode cannot make
 * a current living relationship look unread or display stale context.
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
    .select('correspondence_id, sender_id, recipient_id, reply_to_id, created_at, is_unread, body')
    .in('correspondence_id', correspondenceIds)
    .order('created_at', { ascending: false })

  const letters = (letterRows ?? []) as VisibleLetterRow[]
  const lettersByCorrespondence = new Map<string, VisibleLetterRow[]>()
  for (const letter of letters) {
    const existing = lettersByCorrespondence.get(letter.correspondence_id) ?? []
    existing.push(letter)
    lettersByCorrespondence.set(letter.correspondence_id, existing)
  }

  const episodesByPerson = new Map<string, RelationshipEpisode[]>()

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
    const unreadCount = episodeLetters.filter(
      (letter) => letter.recipient_id === viewerId && letter.is_unread
    ).length

    const existing = episodesByPerson.get(otherId) ?? []
    existing.push({
      correspondenceId: correspondence.id,
      state,
      pendingDirection,
      activityAt,
      latestLetter,
      unreadCount,
    })
    episodesByPerson.set(otherId, existing)
  }

  const baseByPerson = new Map(people.map((person) => [person.userId, person]))
  const selected = [...episodesByPerson.entries()]
    .map(([otherId, episodes]) => {
      const base = baseByPerson.get(otherId)
      const chosen = chooseRelationshipEpisode(episodes)
      return base && chosen ? { otherId, base, chosen } : null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  // Pilot capacity keeps the established set deliberately small. Fetch each
  // participant-only rhythm concurrently so Home/Letterbox do not serialize
  // one network round trip per correspondent.
  const rhythmEntries = await Promise.all(
    selected
      .filter(({ chosen }) => chosen.state === 'established')
      .map(async ({ chosen }) => [
        chosen.correspondenceId,
        await getCorrespondenceRhythm(supabase, chosen.correspondenceId),
      ] as const)
  )
  const rhythmByCorrespondence = new Map(rhythmEntries)

  return selected
    .map(({ base, chosen }) => {
      let statusText: string

      if (chosen.state === 'pending') {
        statusText = chosen.pendingDirection === 'incoming'
          ? 'A first letter is waiting'
          : chosen.pendingDirection === 'outgoing'
            ? 'Your first letter is waiting for a response'
            : 'A correspondence is waiting to begin'
      } else if (chosen.state === 'past') {
        statusText = 'Past correspondence'
      } else {
        statusText = establishedStatus({
          viewerId,
          person: base,
          episode: chosen,
          rhythm: rhythmByCorrespondence.get(chosen.correspondenceId) ?? null,
        })
      }

      return {
        ...base,
        activityAt: chosen.activityAt || base.activityAt,
        unreadCount: chosen.unreadCount,
        latestExcerpt: chosen.latestLetter?.body ?? base.latestExcerpt,
        lastLetterFromViewer: chosen.latestLetter?.sender_id === viewerId,
        relationshipState: chosen.state,
        pendingDirection: chosen.pendingDirection,
        livingCorrespondenceId: chosen.state === 'past' ? null : chosen.correspondenceId,
        statusText,
      }
    })
    .sort((a, b) => {
      const stateDifference = STATE_PRIORITY[b.relationshipState] - STATE_PRIORITY[a.relationshipState]
      return stateDifference !== 0 ? stateDifference : b.activityAt - a.activityAt
    })
}
