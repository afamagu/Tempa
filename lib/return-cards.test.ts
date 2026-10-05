import { describe, expect, it } from 'vitest'
import { mapReturnCardRows, returnCardVersionToBaseContent } from './return-cards'

describe('Return Cards', () => {
  it('maps a frozen Postcard version and historical sender snapshot', () => {
    const cards = mapReturnCardRows([
      {
        id: 'rc-1',
        correspondence_id: 'corr-1',
        source_letter_id: 'letter-1',
        sender_id: 'sender-1',
        recipient_id: 'recipient-1',
        message: 'Still here.',
        sender_pseudonym_snapshot: 'Evening Quill',
        sent_at: '2026-10-05T12:00:00.000Z',
        postcard_versions: {
          postcard_key: 'borrowed_lantern',
          title: 'The Borrowed Lantern',
          location: 'After the rain',
          collection: 'Small Signs',
          postmark_text: 'RETURN CARD',
          footer_text: 'Tempa Postcard',
          front_image_path: '/postcards/borrowed-lantern.jpg',
          motion_src: '/postcards/borrowed-lantern.mp4',
          duration_seconds: 8.5,
          reveal_line_alignment: 'bottom-left',
        },
      },
    ])

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      id: 'rc-1',
      sourceLetterId: 'letter-1',
      postcardKey: 'borrowed_lantern',
      message: 'Still here.',
      senderPseudonymSnapshot: 'Evening Quill',
    })
    expect(cards[0].version.frontImagePath).toBe('/postcards/borrowed-lantern.jpg')
  })

  it('drops a row whose immutable postcard version cannot be resolved', () => {
    const cards = mapReturnCardRows([
      {
        id: 'rc-broken',
        correspondence_id: 'corr-1',
        source_letter_id: 'letter-1',
        sender_id: 'sender-1',
        recipient_id: 'recipient-1',
        message: null,
        sender_pseudonym_snapshot: 'Evening Quill',
        sent_at: '2026-10-05T12:00:00.000Z',
        postcard_versions: null,
      },
    ])

    expect(cards).toEqual([])
  })

  it('converts the frozen version into the canonical Postcard display shape', () => {
    const base = returnCardVersionToBaseContent({
      title: 'The Borrowed Lantern',
      location: 'After the rain',
      collection: 'Small Signs',
      postmarkText: 'RETURN CARD',
      footerText: 'Tempa Postcard',
      frontImagePath: '/postcards/borrowed-lantern.jpg',
      motionSrc: '/postcards/borrowed-lantern.mp4',
      durationSeconds: 8.5,
      revealLineAlignment: 'bottom-left',
    })

    expect(base).toMatchObject({
      title: 'The Borrowed Lantern',
      frontImagePath: '/postcards/borrowed-lantern.jpg',
      revealLineAlignment: 'bottom-left',
      living: {
        motionSrc: '/postcards/borrowed-lantern.mp4',
        durationSeconds: 8.5,
      },
    })
  })
})
