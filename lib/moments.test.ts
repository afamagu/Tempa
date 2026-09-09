import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  toMomentRpcPayload,
  completedParagraphs,
  clampRevealLine,
  REVEAL_LINE_MAX_LENGTH,
  POSTCARD_CATALOG,
  POSTCARD_BACK_MESSAGE_MAX_LENGTH,
  POSTCARD_BACK_PLACEHOLDER,
  resolveLetterPostcardDisplay,
  type MomentDraft,
  type LetterPostcardDraft,
} from './moments'

describe('toMomentRpcPayload', () => {
  // The exact bug from live testing: reply_to_letter reads
  // elem->>'image_path' / elem->>'postcard_key' (snake_case). Sending
  // MomentDraft's camelCase keys straight through left those absent,
  // read as NULL, and violated moments_type_fields_consistent.
  it('serializes a photo draft to snake_case, with postcard_key explicitly null', () => {
    const draft: MomentDraft = { position: 0, type: 'photo', imagePath: 'corr-1/abc.jpg' }

    expect(toMomentRpcPayload(draft)).toEqual({
      position: 0,
      type: 'photo',
      image_path: 'corr-1/abc.jpg',
      postcard_key: null,
    })
  })

  it('serializes a postcard draft to snake_case, with image_path explicitly null', () => {
    const draft: MomentDraft = { position: 2, type: 'postcard', postcardKey: 'essaouira' }

    expect(toMomentRpcPayload(draft)).toEqual({
      position: 2,
      type: 'postcard',
      image_path: null,
      postcard_key: 'essaouira',
    })
  })

  it('never sends a payload where both or neither of image_path/postcard_key are set', () => {
    const photo = toMomentRpcPayload({ position: 0, type: 'photo', imagePath: 'x.jpg' })
    const postcard = toMomentRpcPayload({ position: 1, type: 'postcard', postcardKey: 'essaouira' })

    // Exactly one set per row — mirrors moments_type_fields_consistent's
    // own shape, so a violation here would be caught before ever
    // reaching the database.
    expect(photo.image_path === null).toBe(false)
    expect(photo.postcard_key === null).toBe(true)
    expect(postcard.image_path === null).toBe(true)
    expect(postcard.postcard_key === null).toBe(false)
  })

  it('maps an entire mixed thread of drafts in order, preserving each position', () => {
    const drafts: MomentDraft[] = [
      { position: 0, type: 'postcard', postcardKey: 'essaouira' },
      { position: 3, type: 'photo', imagePath: 'corr-1/def.jpg' },
    ]

    expect(drafts.map(toMomentRpcPayload)).toEqual([
      { position: 0, type: 'postcard', image_path: null, postcard_key: 'essaouira' },
      { position: 3, type: 'photo', image_path: 'corr-1/def.jpg', postcard_key: null },
    ])
  })
})

// The continuous composer's "quiet photo-Moment opportunity" trigger:
// a paragraph becomes eligible only once the writer has actually
// finished it (a blank line follows), never the one still being typed.
// Its array index here is exactly the `position` a Moment attached to
// it is sent with — unchanged from the existing RPC/database contract.
describe('completedParagraphs', () => {
  it('is empty for an empty draft', () => {
    expect(completedParagraphs('')).toEqual([])
  })

  it('is empty while only one paragraph has been started (not yet finished)', () => {
    expect(completedParagraphs('Hi S.N,')).toEqual([])
  })

  it('finishes the first paragraph the moment a blank line starts a second one', () => {
    expect(completedParagraphs('Hi S.N,\n\nHow are you?')).toEqual(['Hi S.N,'])
  })

  it('never includes the paragraph still being typed, only earlier ones', () => {
    const body = 'First.\n\nSecond.\n\nThird still being written'
    expect(completedParagraphs(body)).toEqual(['First.', 'Second.'])
  })

  it('treats a single Enter (soft line break) as staying within one paragraph', () => {
    // One blank line is a paragraph break; a lone newline is not — this
    // mirrors splitParagraphs/the SQL side's own \n\s*\n boundary.
    expect(completedParagraphs('Line one\nLine two still the same paragraph')).toEqual([])
  })

  it('shrinks back down if the writer merges two paragraphs by deleting the blank line', () => {
    const twoParagraphs = 'First.\n\nSecond still being written'
    const merged = 'First.Second still being written'
    expect(completedParagraphs(twoParagraphs)).toEqual(['First.'])
    expect(completedParagraphs(merged)).toEqual([])
  })
})

// Living Postcards V1, Checkpoint 1 — the Reveal Line's product rule
// (test category F): at most 32 characters. This is the reusable
// Postcard object's own defensive clamp (app/letters/postcard-object.tsx),
// applied regardless of what a future caller supplies.
describe('clampRevealLine', () => {
  it('leaves a line at or under the 32-character limit untouched (beyond trimming)', () => {
    const line = 'Keep a little sea with you.'
    expect(line.length).toBeLessThanOrEqual(REVEAL_LINE_MAX_LENGTH)
    expect(clampRevealLine(line)).toBe(line)
  })

  it('trims leading/trailing whitespace even when already within the limit', () => {
    expect(clampRevealLine('  I thought of you here.  ')).toBe('I thought of you here.')
  })

  it('truncates a line longer than 32 characters to exactly the limit', () => {
    const tooLong = 'This is a Reveal Line that is much too long for the card'
    const result = clampRevealLine(tooLong)
    expect(result.length).toBeLessThanOrEqual(REVEAL_LINE_MAX_LENGTH)
    expect(tooLong.startsWith(result)).toBe(true)
  })

  it('a line exactly at the limit is unaffected', () => {
    const exact = 'x'.repeat(REVEAL_LINE_MAX_LENGTH)
    expect(clampRevealLine(exact)).toBe(exact)
    expect(clampRevealLine(exact).length).toBe(REVEAL_LINE_MAX_LENGTH)
  })

  it('a line one character over the limit loses exactly one character', () => {
    const overByOne = 'x'.repeat(REVEAL_LINE_MAX_LENGTH + 1)
    expect(clampRevealLine(overByOne).length).toBe(REVEAL_LINE_MAX_LENGTH)
  })
})

// Living Postcards V1, Checkpoint 2 — the canonical, real (not test-
// fixture) Essaouira Living Reveal asset is now wired into production
// catalog data. Test category A/B: the catalog references the exact
// motion path, and that file genuinely exists on disk where the app
// will request it from (public/postcards/, served at /postcards/...).
describe('POSTCARD_CATALOG.essaouira — canonical Living Reveal wiring (Checkpoint 2)', () => {
  it('references the exact canonical motion asset path', () => {
    expect(POSTCARD_CATALOG.essaouira.living?.motionSrc).toBe('/postcards/essaouira-living.mp4')
  })

  it('the referenced asset genuinely exists on disk at the expected public path', () => {
    const publicPath = path.join(__dirname, '..', 'public', 'postcards', 'essaouira-living.mp4')
    expect(existsSync(publicPath)).toBe(true)
  })

  it('uses the existing static front image as its resting/poster state (posterSrc left unset, falling back to frontImagePath)', () => {
    expect(POSTCARD_CATALOG.essaouira.living?.posterSrc).toBeUndefined()
    expect(POSTCARD_CATALOG.essaouira.frontImagePath).toBe('/postcards/essaouira.jpg')
  })

  it('carries no hard-coded production Reveal Line yet — that arrives with the future sent-letter Postcard data', () => {
    expect(POSTCARD_CATALOG.essaouira.living?.revealLine).toBeUndefined()
  })

  it('sets durationSeconds to the asset\'s actual measured length, not the old placeholder default', () => {
    const duration = POSTCARD_CATALOG.essaouira.living?.durationSeconds
    expect(duration).toBeDefined()
    expect(duration).toBeGreaterThan(9)
    expect(duration).toBeLessThan(11)
  })

  it('the existing developer-authored back content is completely unchanged', () => {
    expect(POSTCARD_CATALOG.essaouira.backMessage).toContain('I took the long way to get bread this morning.')
    expect(POSTCARD_CATALOG.essaouira.senderName).toBe('Youssef')
    expect(POSTCARD_CATALOG.essaouira.postmarkText).toBe('ESSAOUIRA\nATLANTIC MOROCCO')
  })
})

// Second canonical Living Postcard — proves the reusable engine supports
// more than one card. Test categories A-F, I, J.
describe('POSTCARD_CATALOG.bangkokAfterRain — second canonical Living Postcard', () => {
  // A. Exists as a distinct catalog card.
  it('exists as its own distinct catalog entry, separate from essaouira', () => {
    expect(POSTCARD_CATALOG.bangkokAfterRain).toBeDefined()
    expect(POSTCARD_CATALOG.bangkokAfterRain).not.toBe(POSTCARD_CATALOG.essaouira)
    expect(POSTCARD_CATALOG.bangkokAfterRain.title).toBe('Bangkok')
  })

  // B. Front image path.
  it('points to the exact front image path', () => {
    expect(POSTCARD_CATALOG.bangkokAfterRain.frontImagePath).toBe('/postcards/bangkok-after-rain.jpg')
  })

  // C. Living Reveal motion path.
  it('Living Reveal points to the exact motion asset path', () => {
    expect(POSTCARD_CATALOG.bangkokAfterRain.living?.motionSrc).toBe('/postcards/bangkok-after-rain-living.mp4')
  })

  // D. Duration metadata.
  it('duration metadata is 10.04', () => {
    expect(POSTCARD_CATALOG.bangkokAfterRain.living?.durationSeconds).toBe(10.04)
  })

  // E. Both files physically exist at their expected public paths.
  it('both the front image and the motion asset genuinely exist on disk', () => {
    const publicDir = path.join(__dirname, '..', 'public')
    expect(existsSync(path.join(publicDir, 'postcards', 'bangkok-after-rain.jpg'))).toBe(true)
    expect(existsSync(path.join(publicDir, 'postcards', 'bangkok-after-rain-living.mp4'))).toBe(true)
  })

  // F. No hard-coded Reveal Line.
  it('carries no hard-coded Reveal Line — that arrives with the future letter-level Postcard architecture', () => {
    expect(POSTCARD_CATALOG.bangkokAfterRain.living?.revealLine).toBeUndefined()
  })

  it('uses the front image as its resting/poster state (posterSrc left unset)', () => {
    expect(POSTCARD_CATALOG.bangkokAfterRain.living?.posterSrc).toBeUndefined()
  })

  it('carries no fake real-person sender identity — senderName/recipientLabel/recipientDetail are all omitted', () => {
    expect(POSTCARD_CATALOG.bangkokAfterRain.senderName).toBeUndefined()
    expect(POSTCARD_CATALOG.bangkokAfterRain.recipientLabel).toBeUndefined()
    expect(POSTCARD_CATALOG.bangkokAfterRain.recipientDetail).toBeUndefined()
  })

  it('still carries the minimum required back content to render/flip (backMessage, postmarkText)', () => {
    expect(POSTCARD_CATALOG.bangkokAfterRain.backMessage.length).toBeGreaterThan(0)
    expect(POSTCARD_CATALOG.bangkokAfterRain.postmarkText).toBe('BANGKOK\nTHAILAND')
  })

  // I/J. Exactly two catalog cards exist, essaouira among them.
  it('there are now exactly two current catalog Postcards, and essaouira is untouched in shape', () => {
    expect(Object.keys(POSTCARD_CATALOG)).toEqual(['essaouira', 'bangkokAfterRain'])
    expect(Object.keys(POSTCARD_CATALOG)).toHaveLength(2)
    expect(POSTCARD_CATALOG.essaouira.frontImagePath).toBe('/postcards/essaouira.jpg')
    expect(POSTCARD_CATALOG.essaouira.living?.motionSrc).toBe('/postcards/essaouira-living.mp4')
  })
})

// Letter-Level Postcards V1 (2026-09-13) — the product decision this
// codebase's own earlier comment (bangkokAfterRain, above) anticipated:
// "that arrives with the future letter-level Postcard architecture."
// resolveLetterPostcardDisplay is the ONE place a sender's own
// revealLine/backMessage are merged onto a catalog entry for display —
// used identically by the composer's live editor preview and the
// read-only letterhead slot shared by Preview and the delivered reader.
describe('resolveLetterPostcardDisplay', () => {
  const blank = { revealLine: '', backMessage: '' }

  it('returns null for an unknown/invalid postcardKey, mirroring every other catalog lookup in this codebase', () => {
    expect(resolveLetterPostcardDisplay('not-a-real-key', blank)).toBeNull()
  })

  // Placeholder semantics correction (2026-09-14) — C/D/E. The actual bug
  // this checkpoint fixes: a blank sender backMessage used to inherit
  // the catalog's own canned demo prose, and a later (also wrong) fix
  // returned POSTCARD_BACK_PLACEHOLDER as though it were authored
  // content. Neither is correct — POSTCARD_BACK_PLACEHOLDER is UI
  // guidance shown only in the editable textarea's own `placeholder`
  // attribute; it must never come back out of the resolver as
  // backMessage data. A blank draft resolves to a genuinely empty
  // string instead, so a read-only render simply shows no message.
  it('C. with blank overrides, resolves backMessage to an empty string', () => {
    const result = resolveLetterPostcardDisplay('essaouira', blank)
    expect(result?.backMessage).toBe('')
    expect(result?.living?.revealLine).toBeUndefined()
  })

  it('D. never returns POSTCARD_BACK_PLACEHOLDER as backMessage data', () => {
    const result = resolveLetterPostcardDisplay('essaouira', blank)
    expect(result?.backMessage).not.toBe(POSTCARD_BACK_PLACEHOLDER)
  })

  it('E. with blank overrides, never falls back to the catalog entry\'s own backMessage', () => {
    const result = resolveLetterPostcardDisplay('essaouira', blank)
    expect(result?.backMessage).not.toBe(POSTCARD_CATALOG.essaouira.backMessage)
  })

  it('F. a sender-provided backMessage overrides everything and displays exactly, never blended with catalog prose or the placeholder', () => {
    const result = resolveLetterPostcardDisplay('essaouira', {
      revealLine: '',
      backMessage: 'Thinking of you on this ordinary Tuesday.',
    })
    expect(result?.backMessage).toBe('Thinking of you on this ordinary Tuesday.')
    expect(result?.backMessage).not.toBe(POSTCARD_CATALOG.essaouira.backMessage)
    expect(result?.backMessage).not.toBe(POSTCARD_BACK_PLACEHOLDER)
  })

  // G/H — the catalog's own demo recipient identity (e.g. "Evening
  // Quill," a fictional tutorial recipient) must never appear on a real
  // letter-level Postcard, blank or written, regardless of what the
  // catalog entry itself carries.
  it('G/H. always suppresses the catalog\'s own recipientLabel/recipientDetail, blank or written', () => {
    expect(POSTCARD_CATALOG.essaouira.recipientLabel).toBeTruthy()
    expect(POSTCARD_CATALOG.essaouira.recipientDetail).toBeTruthy()

    const blankResult = resolveLetterPostcardDisplay('essaouira', blank)
    expect(blankResult?.recipientLabel).toBeUndefined()
    expect(blankResult?.recipientDetail).toBeUndefined()

    const writtenResult = resolveLetterPostcardDisplay('essaouira', {
      revealLine: '',
      backMessage: 'A real message from a real sender.',
    })
    expect(writtenResult?.recipientLabel).toBeUndefined()
    expect(writtenResult?.recipientDetail).toBeUndefined()
  })

  it('never substitutes a fake address, real recipient pseudonym, or any other invented recipient detail in place of the suppressed fields', () => {
    const result = resolveLetterPostcardDisplay('essaouira', blank)
    expect(result).not.toHaveProperty('recipientAddress')
    // Suppressed means genuinely absent — not replaced with some OTHER
    // string (a real pseudonym, "To: ...", a location) that would just
    // be a different flavor of the same problem.
    expect(result?.recipientLabel).toBeUndefined()
    expect(result?.recipientDetail).toBeUndefined()
  })

  it('a sender-provided revealLine is merged onto the catalog\'s own living data, without altering motionSrc/duration', () => {
    const result = resolveLetterPostcardDisplay('essaouira', {
      revealLine: 'Keep a little sea with you.',
      backMessage: '',
    })
    expect(result?.living?.revealLine).toBe('Keep a little sea with you.')
    expect(result?.living?.motionSrc).toBe(POSTCARD_CATALOG.essaouira.living?.motionSrc)
    expect(result?.living?.durationSeconds).toBe(POSTCARD_CATALOG.essaouira.living?.durationSeconds)
  })

  it('never mutates POSTCARD_CATALOG itself', () => {
    const before = JSON.parse(JSON.stringify(POSTCARD_CATALOG))
    resolveLetterPostcardDisplay('essaouira', { revealLine: 'x', backMessage: 'y' })
    expect(POSTCARD_CATALOG).toEqual(before)
  })

  it('a catalog entry with no living data (a future static letter-level Postcard) simply carries no living block, revealLine ignored', () => {
    // bangkokAfterRain has living data; simulate a hypothetical static
    // entry the same way STATIC_ESSAOUIRA does elsewhere in this suite.
    const result = resolveLetterPostcardDisplay('bangkokAfterRain', {
      revealLine: 'A line that would be ignored if this card had no living data',
      backMessage: '',
    })
    expect(result?.living?.revealLine).toBe(
      'A line that would be ignored if this card had no living data'
    )
  })

  // Pre-migration audit correction (2026-09-14), Part 5 — the real
  // sending member's pseudonym, never the catalog's own fictional demo
  // sender ("Youssef"). Deliberately NOT snapshotted anywhere — see this
  // function's own doc comment for why a live override is correct.
  describe('senderPseudonym override (audit correction, Part 5)', () => {
    it('replaces the catalog\'s own fictional sender name when provided', () => {
      const result = resolveLetterPostcardDisplay('essaouira', { ...blank, senderPseudonym: 'Evening Quill' })
      expect(result?.senderName).toBe('Evening Quill')
      expect(result?.senderName).not.toBe(POSTCARD_CATALOG.essaouira.senderName)
    })

    it('falls back to the catalog\'s own senderName when omitted (backward compatible — no existing caller passes it)', () => {
      const result = resolveLetterPostcardDisplay('essaouira', blank)
      expect(result?.senderName).toBe(POSTCARD_CATALOG.essaouira.senderName)
    })

    it('a card with no catalog senderName at all (bangkokAfterRain) still gets the real sender\'s name when provided', () => {
      expect(POSTCARD_CATALOG.bangkokAfterRain.senderName).toBeUndefined()
      const result = resolveLetterPostcardDisplay('bangkokAfterRain', { ...blank, senderPseudonym: 'Morning Larch' })
      expect(result?.senderName).toBe('Morning Larch')
    })

    it('never mutates POSTCARD_CATALOG itself', () => {
      const before = JSON.parse(JSON.stringify(POSTCARD_CATALOG))
      resolveLetterPostcardDisplay('essaouira', { ...blank, senderPseudonym: 'Someone Else' })
      expect(POSTCARD_CATALOG).toEqual(before)
    })
  })

  // Thumbnail + expanded-experience checkpoint (2026-09-14), Part 9 —
  // version-aware rendering: a delivered letter-level Postcard must use
  // its OWN frozen postcard_versions asset identity, never whatever
  // POSTCARD_CATALOG's current entry for the same key defines today.
  describe('version override (thumbnail + expanded-experience checkpoint, Part 9)', () => {
    const frozenVersion = {
      frontImagePath: '/postcards/essaouira-v2.jpg',
      motionSrc: '/postcards/essaouira-v2-living.mp4',
      durationSeconds: 8.2,
      revealLineAlignment: 'top-center' as const,
    }

    it('L. the frontImagePath comes from the frozen version, never the catalog\'s current entry', () => {
      const result = resolveLetterPostcardDisplay('essaouira', { ...blank, version: frozenVersion })
      expect(result?.frontImagePath).toBe('/postcards/essaouira-v2.jpg')
      expect(result?.frontImagePath).not.toBe(POSTCARD_CATALOG.essaouira.frontImagePath)
    })

    it('the Living Reveal motion asset, duration, and alignment all come from the frozen version', () => {
      const result = resolveLetterPostcardDisplay('essaouira', { ...blank, version: frozenVersion })
      expect(result?.living?.motionSrc).toBe('/postcards/essaouira-v2-living.mp4')
      expect(result?.living?.durationSeconds).toBe(8.2)
      expect(result?.living?.revealLineAlignment).toBe('top-center')
      expect(result?.living?.motionSrc).not.toBe(POSTCARD_CATALOG.essaouira.living?.motionSrc)
    })

    it('a sender-provided revealLine is still merged onto the frozen version\'s own living data', () => {
      const result = resolveLetterPostcardDisplay('essaouira', {
        revealLine: 'Keep a little sea with you.',
        backMessage: '',
        version: frozenVersion,
      })
      expect(result?.living?.revealLine).toBe('Keep a little sea with you.')
      expect(result?.living?.motionSrc).toBe('/postcards/essaouira-v2-living.mp4')
    })

    it('a version with no motion asset renders as a plain static Postcard — no living block at all, even if the catalog entry has one', () => {
      const result = resolveLetterPostcardDisplay('essaouira', {
        ...blank,
        version: { frontImagePath: '/postcards/essaouira-v2.jpg', motionSrc: null, durationSeconds: null, revealLineAlignment: null },
      })
      expect(result?.living).toBeUndefined()
    })

    it('omitting version entirely falls back to the catalog\'s own current artwork — the composer/Preview draft-preview behavior, unaffected', () => {
      const result = resolveLetterPostcardDisplay('essaouira', blank)
      expect(result?.frontImagePath).toBe(POSTCARD_CATALOG.essaouira.frontImagePath)
      expect(result?.living?.motionSrc).toBe(POSTCARD_CATALOG.essaouira.living?.motionSrc)
    })

    it('never mutates POSTCARD_CATALOG itself', () => {
      const before = JSON.parse(JSON.stringify(POSTCARD_CATALOG))
      resolveLetterPostcardDisplay('essaouira', { ...blank, version: frozenVersion })
      expect(POSTCARD_CATALOG).toEqual(before)
    })
  })
})

describe('POSTCARD_BACK_MESSAGE_MAX_LENGTH', () => {
  it('is 200, the product-locked hard maximum for a letter-level Postcard back', () => {
    expect(POSTCARD_BACK_MESSAGE_MAX_LENGTH).toBe(200)
  })
})

describe('LetterPostcardDraft — shape', () => {
  it('carries exactly postcardKey, revealLine, and backMessage — never an array, never more than one Postcard', () => {
    const draft: LetterPostcardDraft = {
      postcardKey: 'essaouira',
      revealLine: 'A few words',
      backMessage: 'Dear friend,',
    }
    expect(Object.keys(draft).sort()).toEqual(['backMessage', 'postcardKey', 'revealLine'])
  })
})
