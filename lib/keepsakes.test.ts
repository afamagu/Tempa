import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMyPostcards, removeMyPostcard } from './keepsakes'
import { createFakePostcards } from './__tests__/simulatePostcardRpcs'

const RECIPIENT = 'user-recipient'
const SENDER = 'user-sender'
const OTHER_MEMBER = 'user-other'
const BYSTANDER = 'user-bystander'

const NOW = '2026-09-14T12:00:00.000Z'
const YESTERDAY = '2026-09-13T12:00:00.000Z'
const TOMORROW = '2026-09-15T12:00:00.000Z'

function client(fake: ReturnType<typeof createFakePostcards>) {
  return fake as unknown as SupabaseClient
}

function seeded(viewerId: string | null) {
  return createFakePostcards({
    viewerId,
    now: NOW,
    versions: [
      {
        id: 'pv-essaouira-1',
        postcardKey: 'essaouira',
        versionNumber: 1,
        title: 'Essaouira',
        location: 'Atlantic Morocco',
        collection: 'Atlantic Morocco Collection',
        postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
        footerText: 'Tempa Postcard · Atlantic Morocco Collection',
        frontImagePath: '/postcards/essaouira.jpg',
        motionSrc: '/postcards/essaouira-living.mp4',
        durationSeconds: 10.04,
        revealLineAlignment: null,
        isCurrent: true,
      },
    ],
    letters: [
      {
        id: 'letter-delivered',
        correspondenceId: 'corr-1',
        senderId: SENDER,
        recipientId: RECIPIENT,
        deliverAt: YESTERDAY,
      },
      {
        id: 'letter-in-transit',
        correspondenceId: 'corr-2',
        senderId: SENDER,
        recipientId: RECIPIENT,
        deliverAt: TOMORROW,
      },
      {
        id: 'letter-outgoing',
        correspondenceId: 'corr-3',
        senderId: RECIPIENT,
        recipientId: OTHER_MEMBER,
        deliverAt: YESTERDAY,
      },
    ],
    letterPostcards: [
      {
        letterId: 'letter-delivered',
        postcardVersionId: 'pv-essaouira-1',
        revealLine: 'Wish you were here',
        backMessage: 'Made it here at last.',
        senderPseudonymSnapshot: 'Morning Larch',
      },
      {
        letterId: 'letter-in-transit',
        postcardVersionId: 'pv-essaouira-1',
        revealLine: null,
        backMessage: 'Still on its way.',
        senderPseudonymSnapshot: 'Morning Larch',
      },
      {
        letterId: 'letter-outgoing',
        postcardVersionId: 'pv-essaouira-1',
        revealLine: null,
        backMessage: 'Sent by the recipient, to someone else.',
        senderPseudonymSnapshot: 'Evening Quill',
      },
    ],
  })
}

describe('get_my_postcards — recipient-only, delivery-gated, derived from letter_postcards -> letters', () => {
  it('rejects an unauthenticated caller', async () => {
    const fake = seeded(null)
    const { data, error } = await getMyPostcards(client(fake))
    expect(error?.message).toBe('Authentication required.')
    expect(data).toEqual([])
  })

  it('returns a Postcard from a delivered letter addressed to the caller', async () => {
    const fake = seeded(RECIPIENT)
    const { data, error } = await getMyPostcards(client(fake))
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].letterId).toBe('letter-delivered')
    expect(data[0].base.title).toBe('Essaouira')
    expect(data[0].backMessage).toBe('Made it here at last.')
    expect(data[0].senderPseudonymSnapshot).toBe('Morning Larch')
  })

  it('excludes a Postcard whose letter has not been delivered yet (in transit)', async () => {
    const fake = seeded(RECIPIENT)
    const { data } = await getMyPostcards(client(fake))
    expect(data.some((p) => p.letterId === 'letter-in-transit')).toBe(false)
  })

  it('excludes the sender\'s own outgoing letter — Keepsakes is receiving-only, never the sender\'s copy', async () => {
    const fake = seeded(RECIPIENT)
    const { data } = await getMyPostcards(client(fake))
    expect(data.some((p) => p.letterId === 'letter-outgoing')).toBe(false)
  })

  it('a different member sees none of these Postcards — cross-member exclusion', async () => {
    const fake = seeded(BYSTANDER)
    const { data } = await getMyPostcards(client(fake))
    expect(data).toEqual([])
  })

  it('a removed Postcard is hidden from this read path', async () => {
    const fake = seeded(RECIPIENT)
    fake._keepsakeRemovals.push({ userId: RECIPIENT, letterId: 'letter-delivered' })
    const { data } = await getMyPostcards(client(fake))
    expect(data).toEqual([])
  })
})

describe('remove_my_postcard — "Remove from my Postcards," never a deletion of anything else', () => {
  it('rejects an unauthenticated caller', async () => {
    const fake = seeded(null)
    const { error } = await removeMyPostcard(client(fake), 'letter-delivered')
    expect(error?.message).toBe('Authentication required.')
  })

  it('rejects a letter the caller never received a Postcard for', async () => {
    const fake = seeded(RECIPIENT)
    const { error } = await removeMyPostcard(client(fake), 'letter-outgoing')
    expect(error?.message).toBe('Postcard not found.')
  })

  it('rejects an in-transit letter — cannot remove before delivery', async () => {
    const fake = seeded(RECIPIENT)
    const { error } = await removeMyPostcard(client(fake), 'letter-in-transit')
    expect(error?.message).toBe('Postcard not found.')
  })

  it('rejects removing the same Postcard twice', async () => {
    const fake = seeded(RECIPIENT)
    await removeMyPostcard(client(fake), 'letter-delivered')
    const { error } = await removeMyPostcard(client(fake), 'letter-delivered')
    expect(error?.message).toBe('This Postcard has already been removed from your collection.')
  })

  it('hides the Postcard from Keepsakes without touching letter_postcards, the letter, or any other member\'s data', async () => {
    const fake = seeded(RECIPIENT)
    const { error } = await removeMyPostcard(client(fake), 'letter-delivered')
    expect(error).toBeNull()
    expect(fake._letterPostcards.some((lp) => lp.letterId === 'letter-delivered')).toBe(true)
    const { data } = await getMyPostcards(client(fake))
    expect(data).toEqual([])
  })
})
