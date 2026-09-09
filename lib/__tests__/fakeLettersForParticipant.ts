// A minimal Supabase-client stand-in for exactly the query shape
// isEstablishedForViewer (lib/letters.ts) issues against
// letters_for_participant:
//   .from('letters_for_participant')
//     .select('id', { count: 'exact', head: true })
//     .eq('correspondence_id', id)
//     .not('reply_to_id', 'is', null)
//     .limit(1)
//
// Mirrors the VIEW'S OWN already-live visibility predicate structurally
// — auth.uid() = sender_id OR (auth.uid() = recipient_id AND
// deliver_at <= now()) — see docs/sql/2026-09-04-mail-call-enforcement.sql.
// It does NOT recompute what a real deliver_at value would be
// (compute_deliver_at's banding/jitter formula); every row's deliverAt
// is supplied directly by the test as an opaque, already-decided
// timestamp, exactly the way fakeSupabase.ts's other stand-ins supply
// already-decided data rather than re-deriving it. Comparing a stored
// timestamp to "now" is the entire visibility rule this view enforces
// — there is no way to exercise isEstablishedForViewer's actual query
// logic without representing that comparison somehow.

export type FakeParticipantLetter = {
  id: string
  correspondenceId: string
  senderId: string
  recipientId: string
  replyToId: string | null
  deliverAt: string
}

export function createFakeLettersForParticipant(options: {
  viewerId: string
  now: string
  letters: FakeParticipantLetter[]
}) {
  const { viewerId, now, letters } = options

  function visibleRows() {
    return letters.filter(
      (l) => l.senderId === viewerId || (l.recipientId === viewerId && l.deliverAt <= now)
    )
  }

  function from(table: string) {
    if (table !== 'letters_for_participant') {
      throw new Error(`fakeLettersForParticipant only simulates letters_for_participant, got "${table}"`)
    }

    const filters: { correspondenceId?: string; replyToIdNotNull?: boolean } = {}

    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        if (column === 'correspondence_id') filters.correspondenceId = value as string
        return builder
      },
      not(column: string, operator: string, value: unknown) {
        if (column === 'reply_to_id' && operator === 'is' && value === null) {
          filters.replyToIdNotNull = true
        }
        return builder
      },
      async limit(n: number) {
        const rows = visibleRows()
          .filter((l) => (filters.correspondenceId ? l.correspondenceId === filters.correspondenceId : true))
          .filter((l) => (filters.replyToIdNotNull ? l.replyToId !== null : true))
          .slice(0, n)
        return { count: rows.length, data: rows, error: null }
      },
    }
    return builder
  }

  return { from }
}
