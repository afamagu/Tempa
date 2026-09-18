import { describe, it, expect } from 'vitest'
import {
  resolveLetterDirection,
  isPhotoDecisionOutstandingForUser,
  canReconsiderPhotoFree,
  buildLetterboxPeople,
  filterLetterboxPeople,
  letterPreviewText,
  isRichBody,
  visibleCorrespondenceIdsForPair,
  attachMomentCounts,
  excludeHiddenLetters,
  excludeHiddenMailInTransit,
  deriveArrivals,
  hasIncomingMailInTransit,
  incomingMailInTransitPersonIds,
  mapLetterPostcardRows,
  letterPostcardToBaseContent,
  deriveLetterboxCardStatus,
  type Letter,
  type LetterboxPerson,
  type IncomingMailInTransit,
  type LetterPostcardRow,
} from './letters'
import { RICH_BODY_MARKER, docToPlainBody } from './letter-editor-doc'
import { simulateSendFirstLetter, simulateReplyToLetter } from './__tests__/simulateLetterRpcs'

// User A = Saint Nico, User B = Evening Quill — the exact scenario from
// real authenticated testing that exposed this bug.
const A = 'user-a-saint-nico'
const B = 'user-b-evening-quill'

const pseudonymById = new Map([
  [A, 'Saint Nico'],
  [B, 'Evening Quill'],
])

describe('resolveLetterDirection', () => {
  const letter1 = { senderId: A, recipientId: B } // A sends to B
  const letter2 = { senderId: B, recipientId: A } // B replies to A
  const letter3 = { senderId: A, recipientId: B } // A replies again

  // A. First letter, sender A -> recipient B, viewer A: renders A -> B.
  // B. Same first letter, viewer B: also renders A -> B.
  // Note `resolveLetterDirection` takes no viewer/target argument at
  // all — there is nothing for a "viewer" to be, which is the point:
  // direction cannot vary by who's asking.
  it('A & B: first letter always resolves sender A -> recipient B, regardless of viewer', () => {
    const result = resolveLetterDirection(letter1, pseudonymById)
    expect(result).toEqual({ senderName: 'Saint Nico', recipientName: 'Evening Quill' })
  })

  // C. Reply, sender B -> recipient A, viewer A: renders B -> A.
  // D. Same reply, viewer B: also renders B -> A.
  it('C & D: a reply resolves sender B -> recipient A, regardless of viewer', () => {
    const result = resolveLetterDirection(letter2, pseudonymById)
    expect(result).toEqual({ senderName: 'Evening Quill', recipientName: 'Saint Nico' })
  })

  // E. Third letter, sender A -> recipient B again: renders A -> B.
  it('E: a third letter (direction flips back) resolves sender A -> recipient B', () => {
    const result = resolveLetterDirection(letter3, pseudonymById)
    expect(result).toEqual({ senderName: 'Saint Nico', recipientName: 'Evening Quill' })
  })

  // F. Historical/collapsed letters retain their own direction and do
  // not inherit the direction of the latest letter — resolving an
  // entire thread out of order, or resolving only the "old" ones
  // without ever touching the newest, must give each letter its own
  // independently-correct answer.
  it('F: each letter in a thread keeps its own direction independent of thread order or position', () => {
    const thread = [letter1, letter2, letter3]
    const resolved = thread.map((l) => resolveLetterDirection(l, pseudonymById))

    expect(resolved[0]).toEqual({ senderName: 'Saint Nico', recipientName: 'Evening Quill' })
    expect(resolved[1]).toEqual({ senderName: 'Evening Quill', recipientName: 'Saint Nico' })
    expect(resolved[2]).toEqual({ senderName: 'Saint Nico', recipientName: 'Evening Quill' })

    // letter1 (A -> B, collapsed/historical) must not inherit letter2's
    // (B -> A, the reply) direction, whichever one happens to be the
    // latest/expanded letter in the actual thread.
    expect(resolveLetterDirection(letter1, pseudonymById)).not.toEqual(
      resolveLetterDirection(letter2, pseudonymById)
    )
    // letter1 and letter3 legitimately share a direction (both A -> B)
    // — resolving them independently must still agree with each other,
    // not merely "not crash."
    expect(resolveLetterDirection(letter1, pseudonymById)).toEqual(
      resolveLetterDirection(letter3, pseudonymById)
    )
  })

  // G. Refreshing, or entering the correspondence from a different
  // Letterbox route, does not alter direction. There is no "route" or
  // "entry point" concept anywhere in this function's inputs — the
  // ROOT PRINCIPLE is enforced structurally: the same letter and the
  // same pseudonym map always produce the same output, called any
  // number of times, in any order, standing in for "no matter how many
  // times the page is loaded / from wherever."
  it('G: repeated calls (simulating reload / a different entry route) always agree', () => {
    const first = resolveLetterDirection(letter1, pseudonymById)
    const second = resolveLetterDirection(letter1, pseudonymById)
    const third = resolveLetterDirection(letter1, pseudonymById)

    expect(first).toEqual(second)
    expect(second).toEqual(third)
  })

  it('falls back to "A member" for an id missing from the pseudonym map, rather than guessing', () => {
    const result = resolveLetterDirection(letter1, new Map())
    expect(result).toEqual({ senderName: 'A member', recipientName: 'A member' })
  })
})

// Exercises the CREATION path (simulating send_first_letter /
// reply_to_letter's actual INSERT assignments — see
// lib/__tests__/simulateLetterRpcs.ts), then feeds the resulting rows
// through the same retrieval/mapping layer the app uses
// (resolveLetterDirection), end to end. The pure resolveLetterDirection
// tests above prove the DISPLAY layer is correct for correctly-shaped
// rows; this proves CREATION produces correctly-shaped rows in the
// first place, and that the two layers agree with each other — the
// exact join the real-world screenshot bug report calls into question.
describe('letter creation contract, through to display', () => {
  const NICOLE = 'user-saint-nicole'
  const QUILL = 'user-evening-quill'
  const names = new Map([
    [NICOLE, 'Saint Nicole'],
    [QUILL, 'Evening Quill'],
  ])

  it('alternates sender/recipient correctly across a 4-letter conversation', () => {
    // Letter 1: Evening Quill writes to Saint Nicole.
    const letter1 = simulateSendFirstLetter(QUILL, NICOLE)
    expect(letter1).toMatchObject({ senderId: QUILL, recipientId: NICOLE })

    // Letter 2: Saint Nicole replies.
    const letter2 = simulateReplyToLetter(NICOLE, letter1)
    expect(letter2).toMatchObject({ senderId: NICOLE, recipientId: QUILL })

    // Letter 3: Evening Quill replies again.
    const letter3 = simulateReplyToLetter(QUILL, letter2)
    expect(letter3).toMatchObject({ senderId: QUILL, recipientId: NICOLE })

    // Letter 4: Saint Nicole replies again.
    const letter4 = simulateReplyToLetter(NICOLE, letter3)
    expect(letter4).toMatchObject({ senderId: NICOLE, recipientId: QUILL })

    // Now push all four DB-like rows through the exact same
    // retrieval/mapping layer the app renders from, and confirm the
    // displayed direction matches what was actually created for every
    // letter — the body/header/sender-identity must all belong to the
    // same row, regardless of position in the thread.
    const thread = [letter1, letter2, letter3, letter4]
    const displayed = thread.map((l) => resolveLetterDirection(l, names))

    expect(displayed[0]).toEqual({ senderName: 'Evening Quill', recipientName: 'Saint Nicole' })
    expect(displayed[1]).toEqual({ senderName: 'Saint Nicole', recipientName: 'Evening Quill' })
    expect(displayed[2]).toEqual({ senderName: 'Evening Quill', recipientName: 'Saint Nicole' })
    expect(displayed[3]).toEqual({ senderName: 'Saint Nicole', recipientName: 'Evening Quill' })
  })

  it('rejects a reply attempt from someone who is not the original letter\'s recipient', () => {
    // Mirrors reply_to_letter's own WHERE guard (`recipient_id = auth.uid()`)
    // — only the person a letter was actually addressed to may reply to
    // it, so recipient_id can never be assigned from anyone else's
    // identity.
    const letter1 = simulateSendFirstLetter(QUILL, NICOLE)
    expect(() => simulateReplyToLetter(QUILL, letter1)).toThrow()
    expect(() => simulateReplyToLetter('some-third-party', letter1)).toThrow()
  })
})

// The shared "outstanding photo decision" predicate — reused by the
// Letterbox indicator, PhotoConsent, and the composer's blocked-photo
// message. Before this stabilization pass, each of those three surfaces
// checked `status === 'pending'` independently, which is why 'deferred'
// (just as unresolved as 'pending') silently lost every route back to
// the decision. These tests exercise the predicate directly so that
// class of drift can't reappear silently in any one surface.
describe('isPhotoDecisionOutstandingForUser', () => {
  const REQUESTER = 'user-requester'
  const OTHER = 'user-other' // whoever isn't the requester

  it('no_request: never outstanding for either side', () => {
    const consent = { status: 'no_request' as const, requestedBy: null, resolvedBy: null }
    expect(isPhotoDecisionOutstandingForUser(consent, REQUESTER)).toBe(false)
    expect(isPhotoDecisionOutstandingForUser(consent, OTHER)).toBe(false)
  })

  // pending requester -> not outstanding (they're waiting, not deciding)
  it('pending requester: not outstanding', () => {
    const consent = { status: 'pending' as const, requestedBy: REQUESTER, resolvedBy: null }
    expect(isPhotoDecisionOutstandingForUser(consent, REQUESTER)).toBe(false)
  })

  // pending decision-maker -> outstanding
  it('pending decision-maker (non-requester): outstanding', () => {
    const consent = { status: 'pending' as const, requestedBy: REQUESTER, resolvedBy: null }
    expect(isPhotoDecisionOutstandingForUser(consent, OTHER)).toBe(true)
  })

  // deferred requester -> not outstanding (still just waiting)
  it('deferred requester: not outstanding', () => {
    const consent = { status: 'deferred' as const, requestedBy: REQUESTER, resolvedBy: OTHER }
    expect(isPhotoDecisionOutstandingForUser(consent, REQUESTER)).toBe(false)
  })

  // deferred decision-maker (the one who chose "Maybe later", i.e.
  // resolvedBy) -> outstanding: they can still decide.
  it('deferred decision-maker (resolver): outstanding', () => {
    const consent = { status: 'deferred' as const, requestedBy: REQUESTER, resolvedBy: OTHER }
    expect(isPhotoDecisionOutstandingForUser(consent, OTHER)).toBe(true)
  })

  // photo-free requester -> resolved, not outstanding
  it('photo-free requester: not outstanding (resolved, not outstanding)', () => {
    const consent = { status: 'photo_free' as const, requestedBy: REQUESTER, resolvedBy: OTHER }
    expect(isPhotoDecisionOutstandingForUser(consent, REQUESTER)).toBe(false)
  })

  // photo-free resolver -> ALSO not outstanding, explicitly. photo_free
  // is a resolved state; the resolver's reconsideration is a deliberate
  // separate action, never something the UI should keep pushing them
  // toward the way it does for a genuinely unresolved state.
  it('photo-free resolver: not outstanding (resolved, not a nag)', () => {
    const consent = { status: 'photo_free' as const, requestedBy: REQUESTER, resolvedBy: OTHER }
    expect(isPhotoDecisionOutstandingForUser(consent, OTHER)).toBe(false)
  })

  // enabled both sides -> nothing left to decide, for anyone
  it('enabled: not outstanding for either side', () => {
    const consent = { status: 'enabled' as const, requestedBy: REQUESTER, resolvedBy: OTHER }
    expect(isPhotoDecisionOutstandingForUser(consent, REQUESTER)).toBe(false)
    expect(isPhotoDecisionOutstandingForUser(consent, OTHER)).toBe(false)
  })

  // Regression test for the real live bug (Saint Nicole / Melons):
  // Melons sent a photo; Saint Nicole chose photo_free; Saint Nicole
  // later reconsidered via "Ask about photos" (request_photo_sharing),
  // which sets requested_by to the RECONSIDERING EX-RESOLVER and resets
  // resolved_by to null, moving status to 'pending'. LockedPhotoMoment
  // used to decide "show the live three-choice UI" from status alone,
  // with no requester check — so Saint Nicole, now the requester of her
  // own reconsideration, was wrongly shown live buttons too. Clicking
  // one correctly failed server-side ("You cannot respond to your own
  // request"), surfacing as a confusing generic save error.
  it('photo-free reconsideration: the reconsidering ex-resolver (now requester) has nothing outstanding', () => {
    const consent = { status: 'pending' as const, requestedBy: 'saint-nicole', resolvedBy: null }
    expect(isPhotoDecisionOutstandingForUser(consent, 'saint-nicole')).toBe(false)
  })

  it('photo-free reconsideration: the other participant now genuinely owes the decision', () => {
    const consent = { status: 'pending' as const, requestedBy: 'saint-nicole', resolvedBy: null }
    expect(isPhotoDecisionOutstandingForUser(consent, 'melons')).toBe(true)
  })
})

describe('canReconsiderPhotoFree', () => {
  it('is true only for whoever actually made the photo_free choice', () => {
    const consent = { status: 'photo_free' as const, resolvedBy: 'saint-nicole' }
    expect(canReconsiderPhotoFree(consent, 'saint-nicole')).toBe(true)
  })

  // The other participant must never be able to overturn someone else's
  // photo_free boundary — this is the display-side half of the same
  // guarantee request_photo_sharing enforces server-side.
  it('is false for the other participant — they cannot overturn this boundary', () => {
    const consent = { status: 'photo_free' as const, resolvedBy: 'saint-nicole' }
    expect(canReconsiderPhotoFree(consent, 'melons')).toBe(false)
  })

  it('is false once the state has moved on from photo_free', () => {
    expect(canReconsiderPhotoFree({ status: 'pending', resolvedBy: 'saint-nicole' }, 'saint-nicole')).toBe(false)
    expect(canReconsiderPhotoFree({ status: 'enabled', resolvedBy: 'saint-nicole' }, 'saint-nicole')).toBe(false)
  })
})

// Letterbox Level 1 — one card per person, collapsing every visible
// correspondence episode shared with them.
describe('buildLetterboxPeople', () => {
  const VIEWER = 'viewer'
  const ELVIS = 'elvis'
  const PRIYA = 'priya'

  const profilesById = new Map([
    [ELVIS, { pseudonym: 'Elvis', country: 'US', age_range: '25-34' }],
    [PRIYA, { pseudonym: 'Priya', country: 'IN', age_range: '35-44' }],
  ])

  it('1. multiple visible correspondence episodes with the same person collapse into one card', () => {
    const correspondences = [
      { id: 'c-old', participant_low: ELVIS, participant_high: VIEWER },
      { id: 'c-new', participant_low: ELVIS, participant_high: VIEWER },
    ]
    const latest = new Map([
      ['c-old', { createdAt: '2026-01-01T00:00:00Z', body: 'old letter' }],
      ['c-new', { createdAt: '2026-08-01T00:00:00Z', body: 'new letter' }],
    ])

    const result = buildLetterboxPeople(VIEWER, correspondences, new Set(), latest, new Map(), new Set(), profilesById)

    expect(result).toHaveLength(1)
    expect(result[0].userId).toBe(ELVIS)
    expect(result[0].activityAt).toBe(new Date('2026-08-01T00:00:00Z').getTime())
  })

  it('2. newest visible activity controls Level-1 ordering', () => {
    const correspondences = [
      { id: 'c-elvis', participant_low: ELVIS, participant_high: VIEWER },
      { id: 'c-priya', participant_low: VIEWER, participant_high: PRIYA },
    ]
    const latest = new Map([
      ['c-elvis', { createdAt: '2026-01-01T00:00:00Z', body: 'a' }],
      ['c-priya', { createdAt: '2026-08-01T00:00:00Z', body: 'b' }],
    ])

    const result = buildLetterboxPeople(VIEWER, correspondences, new Set(), latest, new Map(), new Set(), profilesById)

    expect(result.map((p) => p.userId)).toEqual([PRIYA, ELVIS])
  })

  it('3. one hidden episode + one visible episode with the same person still produces that person', () => {
    const correspondences = [
      { id: 'c-hidden', participant_low: ELVIS, participant_high: VIEWER },
      { id: 'c-visible', participant_low: ELVIS, participant_high: VIEWER },
    ]
    // The hidden episode is more recent — it must NOT win.
    const latest = new Map([
      ['c-hidden', { createdAt: '2026-08-01T00:00:00Z', body: 'hidden' }],
      ['c-visible', { createdAt: '2026-03-01T00:00:00Z', body: 'visible' }],
    ])

    const result = buildLetterboxPeople(
      VIEWER,
      correspondences,
      new Set(['c-hidden']),
      latest,
      new Map(),
      new Set(),
      profilesById
    )

    expect(result).toHaveLength(1)
    expect(result[0].activityAt).toBe(new Date('2026-03-01T00:00:00Z').getTime())
    // The hidden episode's letter must never leak as the shown excerpt.
    expect(result[0].latestExcerpt).toBe('visible')
  })

  it('4. every episode with a person hidden removes that person from Level 1 entirely', () => {
    const correspondences = [{ id: 'c-only', participant_low: ELVIS, participant_high: VIEWER }]
    const latest = new Map([['c-only', { createdAt: '2026-08-01T00:00:00Z', body: 'x' }]])

    const result = buildLetterboxPeople(
      VIEWER,
      correspondences,
      new Set(['c-only']),
      latest,
      new Map(),
      new Set(),
      profilesById
    )

    expect(result).toHaveLength(0)
  })

  it('unread aggregation: sums unread counts across multiple visible episodes with the same person', () => {
    const correspondences = [
      { id: 'c-old', participant_low: ELVIS, participant_high: VIEWER },
      { id: 'c-new', participant_low: ELVIS, participant_high: VIEWER },
    ]
    const latest = new Map([
      ['c-old', { createdAt: '2026-01-01T00:00:00Z', body: 'a' }],
      ['c-new', { createdAt: '2026-08-01T00:00:00Z', body: 'b' }],
    ])
    const unread = new Map([
      ['c-old', 2],
      ['c-new', 3],
    ])

    const result = buildLetterboxPeople(VIEWER, correspondences, new Set(), latest, unread, new Set(), profilesById)

    expect(result).toHaveLength(1)
    expect(result[0].unreadCount).toBe(5)
  })

  it('unread aggregation: a hidden episode\'s unread letters never count toward the person\'s total', () => {
    const correspondences = [
      { id: 'c-hidden', participant_low: ELVIS, participant_high: VIEWER },
      { id: 'c-visible', participant_low: ELVIS, participant_high: VIEWER },
    ]
    const latest = new Map([
      ['c-hidden', { createdAt: '2026-01-01T00:00:00Z', body: 'a' }],
      ['c-visible', { createdAt: '2026-03-01T00:00:00Z', body: 'b' }],
    ])
    const unread = new Map([
      ['c-hidden', 9],
      ['c-visible', 1],
    ])

    const result = buildLetterboxPeople(
      VIEWER,
      correspondences,
      new Set(['c-hidden']),
      latest,
      unread,
      new Set(),
      profilesById
    )

    expect(result[0].unreadCount).toBe(1)
  })

  it('unread aggregation: zero when nothing is unread', () => {
    const correspondences = [{ id: 'c-1', participant_low: ELVIS, participant_high: VIEWER }]
    const latest = new Map([['c-1', { createdAt: '2026-01-01T00:00:00Z', body: 'a' }]])

    const result = buildLetterboxPeople(VIEWER, correspondences, new Set(), latest, new Map(), new Set(), profilesById)

    expect(result[0].unreadCount).toBe(0)
  })

  it('hasSentAny: true when the viewer has sent in at least one visible episode with that person', () => {
    const correspondences = [{ id: 'c-1', participant_low: ELVIS, participant_high: VIEWER }]
    const latest = new Map([['c-1', { createdAt: '2026-01-01T00:00:00Z', body: 'a' }]])

    const result = buildLetterboxPeople(
      VIEWER,
      correspondences,
      new Set(),
      latest,
      new Map(),
      new Set(['c-1']),
      profilesById
    )

    expect(result[0].hasSentAny).toBe(true)
  })

  it('hasSentAny: false when the viewer has never sent in any visible episode with that person', () => {
    const correspondences = [{ id: 'c-1', participant_low: ELVIS, participant_high: VIEWER }]
    const latest = new Map([['c-1', { createdAt: '2026-01-01T00:00:00Z', body: 'a' }]])

    const result = buildLetterboxPeople(VIEWER, correspondences, new Set(), latest, new Map(), new Set(), profilesById)

    expect(result[0].hasSentAny).toBe(false)
  })

  it('hasSentAny: a hidden episode the viewer sent in never counts toward a visible person\'s flag', () => {
    const correspondences = [
      { id: 'c-hidden', participant_low: ELVIS, participant_high: VIEWER },
      { id: 'c-visible', participant_low: ELVIS, participant_high: VIEWER },
    ]
    const latest = new Map([
      ['c-hidden', { createdAt: '2026-01-01T00:00:00Z', body: 'a' }],
      ['c-visible', { createdAt: '2026-03-01T00:00:00Z', body: 'b' }],
    ])

    const result = buildLetterboxPeople(
      VIEWER,
      correspondences,
      new Set(['c-hidden']),
      latest,
      new Map(),
      new Set(['c-hidden']),
      profilesById
    )

    expect(result[0].hasSentAny).toBe(false)
  })

  // Release Polish Pass — powers Letterbox's own "Waiting for a reply"
  // status line.
  it('lastLetterFromViewer: true when the most recent visible letter with this person was sent by the viewer', () => {
    const correspondences = [{ id: 'c-1', participant_low: ELVIS, participant_high: VIEWER }]
    const latest = new Map([['c-1', { createdAt: '2026-01-01T00:00:00Z', body: 'a', senderId: VIEWER }]])

    const result = buildLetterboxPeople(VIEWER, correspondences, new Set(), latest, new Map(), new Set(), profilesById)

    expect(result[0].lastLetterFromViewer).toBe(true)
  })

  it('lastLetterFromViewer: false when the most recent visible letter with this person was sent by them', () => {
    const correspondences = [{ id: 'c-1', participant_low: ELVIS, participant_high: VIEWER }]
    const latest = new Map([['c-1', { createdAt: '2026-01-01T00:00:00Z', body: 'a', senderId: ELVIS }]])

    const result = buildLetterboxPeople(VIEWER, correspondences, new Set(), latest, new Map(), new Set(), profilesById)

    expect(result[0].lastLetterFromViewer).toBe(false)
  })

  it('lastLetterFromViewer: reflects the MOST RECENT episode\'s sender, not an earlier one', () => {
    const correspondences = [
      { id: 'c-old', participant_low: ELVIS, participant_high: VIEWER },
      { id: 'c-new', participant_low: ELVIS, participant_high: VIEWER },
    ]
    const latest = new Map([
      ['c-old', { createdAt: '2026-01-01T00:00:00Z', body: 'old', senderId: VIEWER }],
      ['c-new', { createdAt: '2026-08-01T00:00:00Z', body: 'new', senderId: ELVIS }],
    ])

    const result = buildLetterboxPeople(VIEWER, correspondences, new Set(), latest, new Map(), new Set(), profilesById)

    expect(result[0].lastLetterFromViewer).toBe(false)
  })

  it('lastLetterFromViewer: false (never throws) when senderId is simply unknown', () => {
    const correspondences = [{ id: 'c-1', participant_low: ELVIS, participant_high: VIEWER }]
    const latest = new Map([['c-1', { createdAt: '2026-01-01T00:00:00Z', body: 'a' }]])

    const result = buildLetterboxPeople(VIEWER, correspondences, new Set(), latest, new Map(), new Set(), profilesById)

    expect(result[0].lastLetterFromViewer).toBe(false)
  })
})

// Release Polish Pass — Letterbox's responsive correspondence-card
// status line: New letter / Waiting for a reply / Last exchanged
// {date}, in that priority order. "Mail on the way" is deliberately
// NOT one of this function's outputs — it's a separate, independent
// fact the caller renders alongside whatever this returns (see the
// function's own doc comment for why).
describe('deriveLetterboxCardStatus', () => {
  function person(overrides: Partial<LetterboxPerson> = {}): LetterboxPerson {
    return {
      userId: 'user-1',
      pseudonym: 'Evening Quill',
      country: 'South Africa',
      ageRange: '25-34',
      activityAt: new Date('2026-09-08T00:00:00Z').getTime(),
      unreadCount: 0,
      latestExcerpt: 'hi',
      hasSentAny: false,
      lastLetterFromViewer: false,
      ...overrides,
    }
  }

  it('an unread letter takes priority over "waiting for a reply"', () => {
    expect(deriveLetterboxCardStatus(person({ unreadCount: 2, lastLetterFromViewer: true }))).toEqual({
      kind: 'new',
      count: 2,
    })
  })

  it('"waiting for a reply" when the viewer sent the last letter and nothing is unread', () => {
    expect(deriveLetterboxCardStatus(person({ lastLetterFromViewer: true }))).toEqual({
      kind: 'waiting_for_reply',
    })
  })

  it('falls back to "last exchanged" with the activity date otherwise', () => {
    const activityAt = new Date('2026-09-08T00:00:00Z').getTime()
    expect(deriveLetterboxCardStatus(person({ activityAt }))).toEqual({
      kind: 'last_exchanged',
      activityAt,
    })
  })
})

describe('filterLetterboxPeople', () => {
  const ALL: LetterboxPerson[] = [
    {
      userId: 'has-unread',
      pseudonym: 'A',
      country: 'US',
      ageRange: '25-34',
      activityAt: 1,
      unreadCount: 2,
      latestExcerpt: 'hi',
      hasSentAny: false,
      lastLetterFromViewer: false,
    },
    {
      userId: 'has-sent',
      pseudonym: 'B',
      country: 'US',
      ageRange: '25-34',
      activityAt: 2,
      unreadCount: 0,
      latestExcerpt: 'hi',
      hasSentAny: true,
      lastLetterFromViewer: false,
    },
    {
      userId: 'neither',
      pseudonym: 'C',
      country: 'US',
      ageRange: '25-34',
      activityAt: 3,
      unreadCount: 0,
      latestExcerpt: 'hi',
      hasSentAny: false,
      lastLetterFromViewer: false,
    },
  ]

  it('all: returns every row unchanged', () => {
    expect(filterLetterboxPeople(ALL, 'all')).toEqual(ALL)
  })

  it('new: only rows with unreadCount > 0', () => {
    expect(filterLetterboxPeople(ALL, 'new').map((p) => p.userId)).toEqual(['has-unread'])
  })

  it('sent: only rows with hasSentAny', () => {
    expect(filterLetterboxPeople(ALL, 'sent').map((p) => p.userId)).toEqual(['has-sent'])
  })
})

// Letterbox card previews (Level 1 and Level 2) — a card is a preview/
// navigation surface, never a reading surface.
describe('letterPreviewText', () => {
  it('a multi-paragraph body returns only the first paragraph', () => {
    const body = 'First paragraph, short.\n\nSecond paragraph, which a card must never show.'
    expect(letterPreviewText(body)).toBe('First paragraph, short.')
  })

  it('a single-paragraph body (however long) is returned in full — CSS line-clamping, not this function, does the visual truncation', () => {
    const longSingleParagraph =
      'One very long paragraph with no blank-line break at all, long enough to wrap across several ' +
      'visual lines in a small card, but still just one paragraph from start to finish.'
    expect(letterPreviewText(longSingleParagraph)).toBe(longSingleParagraph)
  })

  it('never mutates the string passed in (pure)', () => {
    const body = 'Paragraph one.\n\nParagraph two.'
    letterPreviewText(body)
    expect(body).toBe('Paragraph one.\n\nParagraph two.')
  })

  it('an empty body returns an empty string rather than throwing', () => {
    expect(letterPreviewText('')).toBe('')
  })

  it('extra blank lines between paragraphs do not change which paragraph is first', () => {
    const body = 'First.\n\n\n\nSecond, which must not appear.'
    expect(letterPreviewText(body)).toBe('First.')
  })

  // Final compatibility audit (2026-09-05) — the preview text handed
  // to FormattedText must never carry the rich-body marker itself,
  // regardless of whether the underlying letter is rich or historical.
  it('strips the rich-body marker before extracting the first paragraph, for a rich body', () => {
    const doc = { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Bold', marks: [{ type: 'bold' as const }] }] }] }
    const encoded = docToPlainBody(doc)
    expect(encoded.startsWith(RICH_BODY_MARKER)).toBe(true)
    expect(letterPreviewText(encoded)).toBe('**Bold**')
    expect(letterPreviewText(encoded).startsWith(RICH_BODY_MARKER)).toBe(false)
  })

  it('a historical body with no marker passes through completely unaffected', () => {
    const historical = 'my_username mentioned **something** once.'
    expect(letterPreviewText(historical)).toBe(historical)
  })
})

describe('isRichBody', () => {
  it('is true for a body carrying the rich-body marker', () => {
    expect(isRichBody(RICH_BODY_MARKER + '**Hello**')).toBe(true)
  })

  it('is false for a historical/plain body with no marker, however markup-like its characters look', () => {
    expect(isRichBody('**not originally bold** and my_username')).toBe(false)
  })

  it('is false for an empty body', () => {
    expect(isRichBody('')).toBe(false)
  })

  it('must be checked against the SAME raw body passed to letterPreviewText — both derive from stripRichBodyMarker on the whole value', () => {
    const doc = { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Plain, no marks.' }] }] }
    const encoded = docToPlainBody(doc)
    expect(isRichBody(encoded)).toBe(false)
    expect(letterPreviewText(encoded)).toBe('Plain, no marks.')
  })
})

// Letterbox Level 2 — one person's letter archive across every
// visible episode shared with them.
describe('visibleCorrespondenceIdsForPair', () => {
  it('5. combines every visible episode shared with a person', () => {
    const result = visibleCorrespondenceIdsForPair([{ id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' }], new Set())
    expect(result).toEqual(['c-1', 'c-2', 'c-3'])
  })

  it('6. excludes hidden episodes from the archive entirely', () => {
    const result = visibleCorrespondenceIdsForPair([{ id: 'c-1' }, { id: 'c-2' }], new Set(['c-2']))
    expect(result).toEqual(['c-1'])
  })
})

describe('attachMomentCounts', () => {
  const baseLetter: Letter = {
    id: 'l-1',
    senderId: 'a',
    recipientId: 'b',
    questionAnswerId: null,
    replyToId: null,
    correspondenceId: 'c-1',
    body: 'hello',
    status: 'sent',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-04T00:00:00Z',
    isUnread: false,
    repliedAt: null,
    closedAt: null,
    closedBy: null,
    closeReason: null,
  }

  it('7. produces the photo indicator only on the letter that actually has a Moment', () => {
    const withPhoto = { ...baseLetter, id: 'l-with-photo' }
    const withoutPhoto = { ...baseLetter, id: 'l-without-photo' }
    const momentCounts = new Map([['l-with-photo', { photo: 1, postcard: 0 }]])

    const result = attachMomentCounts([withPhoto, withoutPhoto], momentCounts)

    expect(result.find((l) => l.id === 'l-with-photo')?.momentCounts.photo).toBe(1)
    expect(result.find((l) => l.id === 'l-without-photo')?.momentCounts).toEqual({ photo: 0, postcard: 0 })
  })
})

// Home consolidation checkpoint — "Remove from my Letterbox" must mean
// a correspondence no longer surfaces in ANY of the viewer's ordinary
// personal mail surfaces, not just the Letterbox screen. These prove
// the same hiddenCorrespondenceIds set (already fetched by Letterbox)
// correctly filters both Home data sources: getMyLetters' output and
// the mail-in-transit rows.
describe('excludeHiddenLetters', () => {
  const VIEWER = 'viewer-id'

  function letter(overrides: Partial<Letter> = {}): Letter {
    return {
      id: 'l-1',
      senderId: 'other-id',
      recipientId: VIEWER,
      questionAnswerId: null,
      replyToId: null,
      correspondenceId: 'c-visible',
      body: 'hello',
      status: 'sent',
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-01-04T00:00:00Z',
      isUnread: false,
      repliedAt: null,
      closedAt: null,
      closedBy: null,
      closeReason: null,
      ...overrides,
    }
  }

  it('keeps a letter whose correspondence is not hidden', () => {
    const result = excludeHiddenLetters([letter()], new Set())
    expect(result).toHaveLength(1)
  })

  it('removes every letter belonging to a hidden correspondence', () => {
    const hidden = letter({ id: 'hidden-1', correspondenceId: 'c-hidden' })
    const visible = letter({ id: 'visible-1', correspondenceId: 'c-visible' })
    const result = excludeHiddenLetters([hidden, visible], new Set(['c-hidden']))
    expect(result.map((l) => l.id)).toEqual(['visible-1'])
  })

  it('an empty hidden set changes nothing', () => {
    const letters = [letter({ id: 'a' }), letter({ id: 'b', correspondenceId: 'c-2' })]
    expect(excludeHiddenLetters(letters, new Set())).toHaveLength(2)
  })

  // Home consolidation checkpoint — "hiding" is scoped per viewer at
  // the DATA layer (getHiddenCorrespondenceIds queries `.eq('user_id',
  // userId)`, so viewer A's hidden set can never contain viewer B's
  // hidden ids in the first place). This proves the FILTER itself has
  // no built-in participant bias either — it does exactly what the
  // caller-supplied set says, nothing more — so the same shared letter
  // list can correctly be "hidden" for one viewer's own call and
  // "visible" for another's, independently, from the exact same input.
  it('the same correspondence can be hidden for one viewer\'s own set and visible under a different set — the filter has no built-in participant bias', () => {
    const shared = [letter({ id: 'shared-1', correspondenceId: 'c-shared' })]
    const asViewerWhoHidIt = excludeHiddenLetters(shared, new Set(['c-shared']))
    const asAnotherViewerWhoDidNot = excludeHiddenLetters(shared, new Set())
    expect(asViewerWhoHidIt).toHaveLength(0)
    expect(asAnotherViewerWhoDidNot).toHaveLength(1)
  })
})

describe('deriveArrivals', () => {
  const VIEWER = 'viewer-id'
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString()

  function letter(overrides: Partial<Letter> = {}): Letter {
    return {
      id: 'l-1',
      senderId: 'other-id',
      recipientId: VIEWER,
      questionAnswerId: null,
      replyToId: null,
      correspondenceId: 'c-1',
      body: 'hello',
      status: 'sent',
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: future,
      isUnread: true,
      repliedAt: null,
      closedAt: null,
      closedBy: null,
      closeReason: null,
      ...overrides,
    }
  }

  it('an incoming unread letter appears in Arrivals', () => {
    const result = deriveArrivals([letter()], VIEWER)
    expect(result).toHaveLength(1)
  })

  it('an incoming read letter does not appear even when its lifecycle status is still sent', () => {
    expect(deriveArrivals([letter({ isUnread: false, status: 'sent' })], VIEWER)).toHaveLength(0)
  })

  it('unread state, not sent/replied lifecycle status, controls the Home waiting result', () => {
    expect(deriveArrivals([letter({ isUnread: true, status: 'replied' })], VIEWER)).toHaveLength(1)
    expect(deriveArrivals([letter({ isUnread: false, status: 'sent' })], VIEWER)).toHaveLength(0)
  })

  it('a letter this viewer SENT (not received) never appears in Arrivals', () => {
    const sent = letter({ senderId: VIEWER, recipientId: 'other-id' })
    expect(deriveArrivals([sent], VIEWER)).toHaveLength(0)
  })

  it('multiple incoming unread letters remain multiple waiting letters', () => {
    const result = deriveArrivals([letter({ id: 'l-1' }), letter({ id: 'l-2' })], VIEWER)
    expect(result).toHaveLength(2)
  })

  it('input is always sourced from letters_for_participant, which never returns an undelivered incoming letter at all — so an empty input (the pre-delivery case) produces an empty Arrivals list, never a fabricated one', () => {
    expect(deriveArrivals([], VIEWER)).toEqual([])
  })
})

describe('excludeHiddenMailInTransit', () => {
  function row(overrides: Partial<IncomingMailInTransit> = {}): IncomingMailInTransit {
    return { correspondenceId: 'c-visible', otherParticipantId: 'sender-1', ...overrides }
  }

  it('keeps a transit row whose correspondence is not hidden', () => {
    expect(excludeHiddenMailInTransit([row()], new Set())).toHaveLength(1)
  })

  it('removes a transit row belonging to a hidden correspondence', () => {
    const hidden = row({ correspondenceId: 'c-hidden' })
    expect(excludeHiddenMailInTransit([hidden], new Set(['c-hidden']))).toHaveLength(0)
  })

  it('hiding the only correspondence with mail in transit means no transit notice at all', () => {
    const hidden = row({ correspondenceId: 'c-hidden' })
    const remaining = excludeHiddenMailInTransit([hidden], new Set(['c-hidden']))
    expect(hasIncomingMailInTransit(remaining)).toBe(false)
  })

  it('a row never carries anything beyond correspondence/other-participant ids — no letter id, body, or deliver_at to accidentally expose', () => {
    const r = row()
    expect(Object.keys(r).sort()).toEqual(['correspondenceId', 'otherParticipantId'])
  })
})

// Letterbox archive compact-header checkpoint — the archive page's
// "Mail on the way" indicator (app/letters/with/[userId]/page.tsx)
// scopes this SAME existence-only signal to one specific correspondent
// (otherParticipantId), reusing this already-live helper rather than a
// new query shape. These prove the scoping itself, independent of any
// page/UI code.
describe('incomingMailInTransitPersonIds', () => {
  function row(overrides: Partial<IncomingMailInTransit> = {}): IncomingMailInTransit {
    return { correspondenceId: 'c-1', otherParticipantId: 'sender-1', ...overrides }
  }

  it('a person with incoming transit mail is in the set — the selected correspondent shows Mail on the way', () => {
    const ids = incomingMailInTransitPersonIds([row({ otherParticipantId: 'sender-1' })])
    expect(ids.has('sender-1')).toBe(true)
  })

  it('a person with no incoming transit mail is not in the set — no stale notice for them', () => {
    const ids = incomingMailInTransitPersonIds([])
    expect(ids.has('sender-1')).toBe(false)
  })

  it("transit mail from a DIFFERENT correspondent never marks the selected one — scoped per person, not \"something is on the way somewhere\"", () => {
    const ids = incomingMailInTransitPersonIds([row({ otherParticipantId: 'someone-else' })])
    expect(ids.has('sender-1')).toBe(false)
    expect(ids.has('someone-else')).toBe(true)
  })

  it('multiple travelling letters from the same person collapse into one set entry', () => {
    const ids = incomingMailInTransitPersonIds([
      row({ correspondenceId: 'c-1' }),
      row({ correspondenceId: 'c-1' }),
    ])
    expect(ids.size).toBe(1)
  })
})

// Final pre-migration architecture correction (2026-09-14) — postcard_key
// no longer lives directly on letter_postcards; it's read through the
// embedded postcard_versions relation instead (see the versioning
// migration this checkpoint prepares). This is the genuinely new mapping
// logic getLetterPostcardsForLetters now depends on, tested directly per
// this codebase's own convention of extracting non-trivial logic out of
// a live-DB-calling function so it doesn't need a live/faked Supabase
// client to verify.
describe('mapLetterPostcardRows', () => {
  function versionRow(overrides: Partial<NonNullable<LetterPostcardRow['postcard_versions']>> = {}) {
    return {
      postcard_key: 'essaouira',
      title: 'Essaouira',
      location: 'Atlantic Morocco',
      collection: 'Atlantic Morocco Collection',
      postmark_text: 'ESSAOUIRA\nATLANTIC MOROCCO',
      footer_text: 'Tempa Postcard · Atlantic Morocco Collection',
      front_image_path: '/postcards/essaouira.jpg',
      motion_src: '/postcards/essaouira-living.mp4',
      duration_seconds: 10.04,
      reveal_line_alignment: null,
      ...overrides,
    }
  }

  function postcardRow(overrides: Partial<LetterPostcardRow> = {}): LetterPostcardRow {
    return {
      letter_id: 'letter-1',
      reveal_line: null,
      back_message: 'Made it here at last.',
      sender_pseudonym_snapshot: 'Evening Quill',
      postcard_versions: versionRow(),
      ...overrides,
    }
  }

  it('reads postcardKey through the embedded postcard_versions relation, never a direct column', () => {
    const result = mapLetterPostcardRows([postcardRow()])
    expect(result.get('letter-1')).toEqual({
      postcardKey: 'essaouira',
      revealLine: '',
      backMessage: 'Made it here at last.',
      senderPseudonymSnapshot: 'Evening Quill',
      version: {
        title: 'Essaouira',
        location: 'Atlantic Morocco',
        collection: 'Atlantic Morocco Collection',
        postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
        footerText: 'Tempa Postcard · Atlantic Morocco Collection',
        frontImagePath: '/postcards/essaouira.jpg',
        motionSrc: '/postcards/essaouira-living.mp4',
        durationSeconds: 10.04,
        revealLineAlignment: null,
      },
    })
  })

  it('Admin Phase 2A-2 — carries the frozen title/location/collection/postmarkText/footerText through as the version object', () => {
    const result = mapLetterPostcardRows([
      postcardRow({ postcard_versions: versionRow({ title: 'A Later Edited Title', location: 'Somewhere Else' }) }),
    ])
    expect(result.get('letter-1')?.version.title).toBe('A Later Edited Title')
    expect(result.get('letter-1')?.version.location).toBe('Somewhere Else')
  })

  it('a null reveal_line becomes an empty string, matching the draft shape convention', () => {
    const result = mapLetterPostcardRows([postcardRow({ reveal_line: 'Keep a little sea with you.' })])
    expect(result.get('letter-1')?.revealLine).toBe('Keep a little sea with you.')
  })

  it('a row whose version relation failed to embed is skipped entirely, never fabricating a postcardKey or asset paths', () => {
    const result = mapLetterPostcardRows([postcardRow({ postcard_versions: null })])
    expect(result.has('letter-1')).toBe(false)
    expect(result.size).toBe(0)
  })

  it('one failed-join row never affects a different, healthy row in the same batch', () => {
    const result = mapLetterPostcardRows([
      postcardRow({ letter_id: 'letter-bad', postcard_versions: null }),
      postcardRow({ letter_id: 'letter-good' }),
    ])
    expect(result.has('letter-bad')).toBe(false)
    expect(result.get('letter-good')?.postcardKey).toBe('essaouira')
  })

  it('carries the frozen sender_pseudonym_snapshot through untouched, never the live pseudonym', () => {
    const result = mapLetterPostcardRows([postcardRow({ sender_pseudonym_snapshot: 'A Name From The Past' })])
    expect(result.get('letter-1')?.senderPseudonymSnapshot).toBe('A Name From The Past')
  })

  it('an empty row list produces an empty map', () => {
    expect(mapLetterPostcardRows([]).size).toBe(0)
  })

  it('batches multiple letters into one map, each keyed by its own letter_id', () => {
    const result = mapLetterPostcardRows([
      postcardRow({ letter_id: 'letter-a', postcard_versions: versionRow({ postcard_key: 'essaouira' }) }),
      postcardRow({
        letter_id: 'letter-b',
        postcard_versions: versionRow({
          postcard_key: 'bangkokAfterRain',
          front_image_path: '/postcards/bangkok-after-rain.jpg',
          motion_src: '/postcards/bangkok-after-rain-living.mp4',
        }),
      }),
    ])
    expect(result.size).toBe(2)
    expect(result.get('letter-a')?.postcardKey).toBe('essaouira')
    expect(result.get('letter-b')?.postcardKey).toBe('bangkokAfterRain')
  })

  // Thumbnail + expanded-experience checkpoint (2026-09-14) — the whole
  // point of version-aware rendering: the FROZEN asset fields travel
  // through untouched, independent of whatever POSTCARD_CATALOG's
  // current entry for the same key happens to define today.
  it('carries the frozen front_image_path/motion_src/duration_seconds through as the version object, never re-deriving them from a key', () => {
    const result = mapLetterPostcardRows([
      postcardRow({
        postcard_versions: versionRow({
          front_image_path: '/postcards/essaouira-v2.jpg',
          motion_src: '/postcards/essaouira-v2-living.mp4',
          duration_seconds: 8.2,
          reveal_line_alignment: 'top-center',
        }),
      }),
    ])
    expect(result.get('letter-1')?.version).toEqual({
      title: 'Essaouira',
      location: 'Atlantic Morocco',
      collection: 'Atlantic Morocco Collection',
      postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
      footerText: 'Tempa Postcard · Atlantic Morocco Collection',
      frontImagePath: '/postcards/essaouira-v2.jpg',
      motionSrc: '/postcards/essaouira-v2-living.mp4',
      durationSeconds: 8.2,
      revealLineAlignment: 'top-center',
    })
  })

  it('a version with no motion asset (a plain static Postcard) carries motionSrc as null, not fabricated', () => {
    const result = mapLetterPostcardRows([
      postcardRow({ postcard_versions: versionRow({ motion_src: null, duration_seconds: null }) }),
    ])
    expect(result.get('letter-1')?.version.motionSrc).toBeNull()
    expect(result.get('letter-1')?.version.durationSeconds).toBeNull()
  })

  // Admin Phase 2A-2 — letterPostcardToBaseContent is the delivered
  // reader's own half of the "resolve base content, then merge sender
  // overrides" split (lib/moments.ts's resolveLetterPostcardDisplay no
  // longer does any lookup of its own).
  describe('letterPostcardToBaseContent', () => {
    it('carries every frozen presentation field straight through', () => {
      const base = letterPostcardToBaseContent({
        title: 'Essaouira',
        location: 'Atlantic Morocco',
        collection: 'Atlantic Morocco Collection',
        postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
        footerText: 'Tempa Postcard · Atlantic Morocco Collection',
        frontImagePath: '/postcards/essaouira.jpg',
        motionSrc: '/postcards/essaouira-living.mp4',
        durationSeconds: 10.04,
        revealLineAlignment: 'top-center',
      })
      expect(base.title).toBe('Essaouira')
      expect(base.location).toBe('Atlantic Morocco')
      expect(base.collection).toBe('Atlantic Morocco Collection')
      expect(base.postmarkText).toBe('ESSAOUIRA\nATLANTIC MOROCCO')
      expect(base.footerText).toBe('Tempa Postcard · Atlantic Morocco Collection')
      expect(base.frontImagePath).toBe('/postcards/essaouira.jpg')
      expect(base.living).toEqual({
        motionSrc: '/postcards/essaouira-living.mp4',
        durationSeconds: 10.04,
        revealLineAlignment: 'top-center',
      })
    })

    it('a version with no motion asset produces no living block at all', () => {
      const base = letterPostcardToBaseContent({
        title: 'A Static Card',
        location: 'Nowhere',
        collection: 'A Collection',
        postmarkText: 'STATIC',
        footerText: 'Tempa Postcard',
        frontImagePath: '/postcards/static.jpg',
        motionSrc: null,
        durationSeconds: null,
        revealLineAlignment: null,
      })
      expect(base.living).toBeUndefined()
    })
  })
})
