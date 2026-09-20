import { describe, it, expect } from 'vitest'
import {
  docToPlainBody,
  docToMomentDrafts,
  docToDraftMomentDescriptors,
  resolveDraftPreviewMoments,
  extractLegacyPostcardMoment,
  stripPostcardMoments,
  UNAVAILABLE_PHOTO_DATA_URI,
  stripTransientPhotoPreviews,
  letterDocHasContent,
  canSendLetter,
  plainBodyToLetterDoc,
  markupBodyToLetterDoc,
  dispatchBodyToDoc,
  parseFormattedText,
  stripRichBodyMarker,
  RICH_BODY_MARKER,
  EMPTY_LETTER_DOC,
  type LetterDocJSON,
  type ParagraphNodeJSON,
  type InlineNodeJSON,
  type MarkJSON,
} from './letter-editor-doc'
import { splitParagraphs } from './moments'

function paragraph(...content: InlineNodeJSON[]): ParagraphNodeJSON {
  return { type: 'paragraph', content }
}

function text(value: string, marks?: MarkJSON[]): InlineNodeJSON {
  return marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }
}

function bold(value: string): InlineNodeJSON {
  return text(value, [{ type: 'bold' }])
}

function italic(value: string): InlineNodeJSON {
  return text(value, [{ type: 'italic' }])
}

function boldItalic(value: string): InlineNodeJSON {
  return text(value, [{ type: 'bold' }, { type: 'italic' }])
}

function photoMoment(imagePath: string, previewUrl?: string | null): InlineNodeJSON {
  return previewUrl === undefined
    ? { type: 'photoMoment', attrs: { imagePath } }
    : { type: 'photoMoment', attrs: { imagePath, previewUrl } }
}

function postcardMoment(postcardKey: string): InlineNodeJSON {
  return { type: 'postcardMoment', attrs: { postcardKey } }
}

describe('docToPlainBody', () => {
  it('joins paragraphs with a blank line, matching the RPC/SQL paragraph split', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('First.')), paragraph(text('Second.'))],
    }
    expect(docToPlainBody(doc)).toBe('First.\n\nSecond.')
  })

  it('renders a hardBreak as a single newline within its paragraph', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('Line one'), { type: 'hardBreak' }, text('Line two, same paragraph'))],
    }
    expect(docToPlainBody(doc)).toBe('Line one\nLine two, same paragraph')
  })

  // The exact contract requirement: a Moment atom must never serialize
  // into p_body — it contributes no text at all.
  it('excludes photoMoment nodes entirely from the plain body', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('Before the photo.'), photoMoment('corr-1/a.jpg')), paragraph(text('After.'))],
    }
    expect(docToPlainBody(doc)).toBe('Before the photo.\n\nAfter.')
  })

  it('is empty for the default empty document', () => {
    expect(docToPlainBody(EMPTY_LETTER_DOC)).toBe('')
  })
})

describe('docToMomentDrafts', () => {
  it('computes position from the paragraph walk, not a stored index', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('Zero.')), paragraph(text('One.'), photoMoment('corr-1/b.jpg')), paragraph(text('Two.'))],
    }
    expect(docToMomentDrafts(doc)).toEqual([{ position: 1, type: 'photo', imagePath: 'corr-1/b.jpg' }])
  })

  it('excludes paragraphs with no attached Moment', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('Just words.'))] }
    expect(docToMomentDrafts(doc)).toEqual([])
  })

  // Requirement: attached Moment stays with its paragraph when a
  // paragraph is inserted above it — simulated here by re-running the
  // walk against the doc AFTER such an insertion. Because position is
  // always derived fresh from the final tree (never a separately
  // tracked index), the Moment's paragraph in the walk is genuinely a
  // different value than before by definition, exactly matching what
  // the RPC now expects — nothing needed to "follow" it.
  it('recomputes the correct position after a paragraph is inserted above it', () => {
    const before: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('Original first.'), photoMoment('corr-1/c.jpg')), paragraph(text('Original second.'))],
    }
    expect(docToMomentDrafts(before)).toEqual([{ position: 0, type: 'photo', imagePath: 'corr-1/c.jpg' }])

    // Simulates the writer pressing Enter at the very start and typing
    // a brand-new paragraph before the one that owns the photo.
    const afterInsertAbove: LetterDocJSON = {
      type: 'doc',
      content: [
        paragraph(text('A new opening paragraph.')),
        paragraph(text('Original first.'), photoMoment('corr-1/c.jpg')),
        paragraph(text('Original second.')),
      ],
    }
    expect(docToMomentDrafts(afterInsertAbove)).toEqual([{ position: 1, type: 'photo', imagePath: 'corr-1/c.jpg' }])
  })

  // Requirement: deleting its paragraph removes the Moment. A photo
  // Moment is a real child of its paragraph node (see photo-moment-
  // node.tsx) — deleting the paragraph deletes the node with it, so the
  // walk over the resulting document simply never finds it again.
  it('has nothing to report once the paragraph carrying the Moment is deleted', () => {
    const withMoment: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('Keep.')), paragraph(text('Delete me.'), photoMoment('corr-1/d.jpg'))],
    }
    expect(docToMomentDrafts(withMoment)).toHaveLength(1)

    const afterDeletion: LetterDocJSON = { type: 'doc', content: [paragraph(text('Keep.'))] }
    expect(docToMomentDrafts(afterDeletion)).toEqual([])
  })

  it('supports multiple Moments across different paragraphs, each with its own position', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [
        paragraph(text('Zero.'), photoMoment('corr-1/e.jpg')),
        paragraph(text('One.')),
        paragraph(text('Two.'), photoMoment('corr-1/f.jpg')),
      ],
    }
    expect(docToMomentDrafts(doc)).toEqual([
      { position: 0, type: 'photo', imagePath: 'corr-1/e.jpg' },
      { position: 2, type: 'photo', imagePath: 'corr-1/f.jpg' },
    ])
  })

  it('uses collapsed body positions for the exact four-Moment Dispatch failure shape', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [
        paragraph(text('Zero.')),
        paragraph(), // an intentional empty editor paragraph disappears from p_body
        paragraph(text('Two.'), photoMoment('author/a.jpg')),
        paragraph(text('Three.')),
        paragraph(text('Four.')),
        paragraph(text('Five.'), photoMoment('author/b.jpg')),
        paragraph(text('Six.')),
        paragraph(text('Seven.'), photoMoment('author/c.jpg')),
        paragraph(text('Eight.')),
        paragraph(text('Nine.'), photoMoment('author/d.jpg')),
      ],
    }

    const paragraphsSentToTheRpc = splitParagraphs(docToPlainBody(doc))
    expect(paragraphsSentToTheRpc).toHaveLength(9)
    expect(docToMomentDrafts(doc)).toEqual([
      { position: 1, type: 'photo', imagePath: 'author/a.jpg' },
      { position: 4, type: 'photo', imagePath: 'author/b.jpg' },
      { position: 6, type: 'photo', imagePath: 'author/c.jpg' },
      { position: 8, type: 'photo', imagePath: 'author/d.jpg' },
    ])
    for (const moment of docToMomentDrafts(doc)) {
      expect(moment.position).toBeLessThan(paragraphsSentToTheRpc.length)
    }
  })

  it('keeps a standalone Moment in the gap after the preceding passage', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [
        paragraph(text('Before.')),
        paragraph(photoMoment('author/gap.jpg')),
        paragraph(text('After.')),
      ],
    }

    expect(splitParagraphs(docToPlainBody(doc))).toEqual(['Before.', 'After.'])
    expect(docToMomentDrafts(doc)).toEqual([
      { position: 0, type: 'photo', imagePath: 'author/gap.jpg' },
    ])
  })
})

describe('letterDocHasContent', () => {
  it('is false for the empty document', () => {
    expect(letterDocHasContent(EMPTY_LETTER_DOC)).toBe(false)
  })

  it('is true once there are actual words', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('Hello.'))] }
    expect(letterDocHasContent(doc)).toBe(true)
  })

  // A photo-only paragraph (no text at all) still counts as real
  // content to send — hasContent must not depend on text alone.
  it('is true for a photo-only paragraph with no text', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(photoMoment('corr-1/g.jpg'))] }
    expect(letterDocHasContent(doc)).toBe(true)
  })
})

// First-contact composer Send-button regression (2026-09-05) — root
// cause was React never re-rendering when the Tiptap editor's content
// changed (useEditor() doesn't force a re-render on transactions by
// default), not this derivation logic itself. canSendLetter is the ONE
// function both the button's disabled state and the submit guard use,
// so these tests are the actual regression coverage for the reported
// bug's real, testable surface.
describe('canSendLetter', () => {
  const notSubmitting = { aboveMax: false, submitting: false }

  it('an empty editor cannot be sent', () => {
    expect(canSendLetter(EMPTY_LETTER_DOC, notSubmitting)).toBe(false)
  })

  it('a whitespace-only editor cannot be sent', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('   \n  '))] }
    expect(canSendLetter(doc, notSubmitting)).toBe(false)
  })

  it('plain text can be sent', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('Hello there.'))] }
    expect(canSendLetter(doc, notSubmitting)).toBe(true)
  })

  it('bold text can be sent', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(bold('Hello there.'))] }
    expect(canSendLetter(doc, notSubmitting)).toBe(true)
  })

  it('italic text can be sent', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(italic('Hello there.'))] }
    expect(canSendLetter(doc, notSubmitting)).toBe(true)
  })

  it('a bold mark alone, on empty/whitespace text, does NOT count as content', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(bold('   '))] }
    expect(canSendLetter(doc, notSubmitting)).toBe(false)
  })

  it('emoji (ordinary non-whitespace Unicode) can be sent, same as any other character — no new minimum-length rule', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('🙂'))] }
    expect(canSendLetter(doc, notSubmitting)).toBe(true)
  })

  it('a photo-only paragraph counts as content (mirrors letterDocHasContent)', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(photoMoment('corr-1/h.jpg'))] }
    expect(canSendLetter(doc, notSubmitting)).toBe(true)
  })

  it('cannot be sent while already submitting, even with valid content', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('Hello there.'))] }
    expect(canSendLetter(doc, { aboveMax: false, submitting: true })).toBe(false)
  })

  it('cannot be sent while over the character limit, even with valid content', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('Hello there.'))] }
    expect(canSendLetter(doc, { aboveMax: true, submitting: false })).toBe(false)
  })

  it('a restored non-empty draft immediately permits sending', () => {
    // Simulates the exact draft-restoration path: markupBodyToLetterDoc
    // reconstructing a saved rich-JSON draft's document.
    const restored = markupBodyToLetterDoc(docToPlainBody({ type: 'doc', content: [paragraph(bold('Restored.'))] }))
    expect(canSendLetter(restored, notSubmitting)).toBe(true)
  })

  it('a restored empty/invalid draft does not permit sending', () => {
    const restored = markupBodyToLetterDoc('   ')
    expect(canSendLetter(restored, notSubmitting)).toBe(false)
  })

  // Length-policy audit (2026-09-05 live-test report): the ongoing
  // Write Anytime composer (moments-composer.tsx) and the reply that
  // establishes a correspondence (first-contact-response.tsx) now both
  // pass aboveMax: false unconditionally — canSendLetter itself never
  // computes length from the doc, so these prove a very long
  // established letter is exactly as sendable as a short one whenever
  // its caller says there's no product limit to check.
  describe('an established letter has no product-level length limit', () => {
    const veryLongBody = 'x'.repeat(10_000)

    it('a very long plain letter is sendable when aboveMax is false, regardless of length', () => {
      const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text(veryLongBody))] }
      expect(canSendLetter(doc, notSubmitting)).toBe(true)
    })

    it('Bold/Italic marks on a very long letter never reintroduce a length gate', () => {
      const doc: LetterDocJSON = {
        type: 'doc',
        content: [paragraph(bold(veryLongBody)), paragraph(italic(veryLongBody))],
      }
      expect(canSendLetter(doc, notSubmitting)).toBe(true)
    })

    it('an attached Moment alongside a very long letter never reintroduces a length gate', () => {
      const doc: LetterDocJSON = {
        type: 'doc',
        content: [paragraph(text(veryLongBody)), paragraph(photoMoment('corr-1/long.jpg'))],
      }
      expect(canSendLetter(doc, notSubmitting)).toBe(true)
    })

    it('restoring a very long draft (Write Anytime) remains immediately sendable', () => {
      const original: LetterDocJSON = { type: 'doc', content: [paragraph(bold(veryLongBody))] }
      const restored = markupBodyToLetterDoc(docToPlainBody(original))
      expect(canSendLetter(restored, notSubmitting)).toBe(true)
    })

    it('the SAME long doc is correctly blocked when its caller does set aboveMax — proving the gate is caller-controlled, not content-derived', () => {
      const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text(veryLongBody))] }
      expect(canSendLetter(doc, { aboveMax: true, submitting: false })).toBe(false)
    })
  })
})

describe('plainBodyToLetterDoc', () => {
  it('splits a legacy plain-text draft into one paragraph per blank-line region', () => {
    const doc = plainBodyToLetterDoc('First.\n\nSecond.')
    expect(docToPlainBody(doc)).toBe('First.\n\nSecond.')
    expect(docToMomentDrafts(doc)).toEqual([])
  })

  it('falls back to the empty document for blank input', () => {
    expect(plainBodyToLetterDoc('   ')).toEqual(EMPTY_LETTER_DOC)
  })
})

// Final compatibility audit (2026-09-05) — the exact defect this
// section exists to close: escaping protects text written THROUGH the
// new editor, but does nothing for a letter already stored before this
// feature existed, which was never escaped because there was nothing
// to escape from. stripRichBodyMarker is the ONE gate that decides
// whether ANY mark-decoding may happen at all.
describe('stripRichBodyMarker', () => {
  it('a body with no marker is never rich, and is returned completely unchanged', () => {
    const historical = 'A letter written long before Bold/Italic existed.'
    expect(stripRichBodyMarker(historical)).toEqual({ isRich: false, body: historical })
  })

  it('a body with the marker is rich, and comes back with the marker removed', () => {
    const result = stripRichBodyMarker(RICH_BODY_MARKER + '**Hello**')
    expect(result).toEqual({ isRich: true, body: '**Hello**' })
  })

  it('representative historical examples that merely LOOK like markup are all reported as not rich', () => {
    const examples = [
      'I *really* mean it',
      '**not originally bold**',
      'my_username',
      'one_two_three',
      'a literal \\ backslash',
      'combinations like _this_ and **that** happening naturally',
    ]
    for (const example of examples) {
      expect(stripRichBodyMarker(example)).toEqual({ isRich: false, body: example })
    }
  })

  it('an empty string is not rich', () => {
    expect(stripRichBodyMarker('')).toEqual({ isRich: false, body: '' })
  })
})

// Writing/composer essentials checkpoint — Bold/Italic storage. Marks
// are encoded as **bold** and _italic_ directly inside the existing
// plain-text body — no schema change, no HTML. These prove the
// encoding (docToPlainBody), the decoding (parseFormattedText), and
// the doc-reconstruction (markupBodyToLetterDoc) all agree with each
// other, and that paragraph/Moment structure is completely unaffected.
describe('docToPlainBody — bold/italic encoding', () => {
  it('wraps a bold text node in **markers**, prefixed with the rich-body marker', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(bold('Hello'))] }
    expect(docToPlainBody(doc)).toBe(RICH_BODY_MARKER + '**Hello**')
  })

  it('wraps an italic text node in a single underscore on each side, prefixed with the marker', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(italic('Hello'))] }
    expect(docToPlainBody(doc)).toBe(RICH_BODY_MARKER + '_Hello_')
  })

  it('wraps a bold+italic text node with both delimiters, italic innermost, prefixed with the marker', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(boldItalic('Hello'))] }
    expect(docToPlainBody(doc)).toBe(RICH_BODY_MARKER + '**_Hello_**')
  })

  it('leaves plain (unmarked) text completely unchanged — no marker at all when no mark is ever used', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('Hello.'))] }
    expect(docToPlainBody(doc)).toBe('Hello.')
    expect(docToPlainBody(doc).startsWith(RICH_BODY_MARKER)).toBe(false)
  })

  it('mixes plain, bold, and italic runs within one paragraph correctly, with exactly one leading marker', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('Plain '), bold('bold'), text(' and '), italic('italic'), text('.'))],
    }
    expect(docToPlainBody(doc)).toBe(RICH_BODY_MARKER + 'Plain **bold** and _italic_.')
  })

  it('a plain, entirely unformatted letter produces byte-identical output to before this feature existed — the overwhelming common case', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('Dear friend,')), paragraph(text('Nothing fancy here.'))],
    }
    expect(docToPlainBody(doc)).toBe('Dear friend,\n\nNothing fancy here.')
  })

  it('escapes a literal asterisk a member actually typed, so it can never be mistaken for a delimiter', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('2 * 2 = 4'))] }
    expect(docToPlainBody(doc)).toBe('2 \\* 2 = 4')
  })

  it('escapes a literal underscore a member actually typed', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('snake_case_name'))] }
    expect(docToPlainBody(doc)).toBe('snake\\_case\\_name')
  })

  it('escapes a literal backslash a member actually typed', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('C:\\path'))] }
    expect(docToPlainBody(doc)).toBe('C:\\\\path')
  })

  it('adding bold/italic to one paragraph does not change the paragraph count or any Moment position', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [
        paragraph(bold('Zero, bolded.'), photoMoment('corr-1/x.jpg')),
        paragraph(text('One.')),
        paragraph(italic('Two, italicized.'), photoMoment('corr-1/y.jpg')),
      ],
    }
    expect(docToPlainBody(doc).split('\n\n')).toHaveLength(3)
    expect(docToMomentDrafts(doc)).toEqual([
      { position: 0, type: 'photo', imagePath: 'corr-1/x.jpg' },
      { position: 2, type: 'photo', imagePath: 'corr-1/y.jpg' },
    ])
  })
})

describe('parseFormattedText', () => {
  it('a bold run decodes to one bold segment', () => {
    expect(parseFormattedText('**Hello**')).toEqual([{ text: 'Hello', bold: true, italic: false }])
  })

  it('an italic run decodes to one italic segment', () => {
    expect(parseFormattedText('_Hello_')).toEqual([{ text: 'Hello', bold: false, italic: true }])
  })

  it('a bold+italic run decodes to one segment with both flags set', () => {
    expect(parseFormattedText('**_Hello_**')).toEqual([{ text: 'Hello', bold: true, italic: true }])
  })

  it('plain text with no markers decodes to one plain segment', () => {
    expect(parseFormattedText('Just words.')).toEqual([{ text: 'Just words.', bold: false, italic: false }])
  })

  it('mixed plain/bold/italic runs decode into separate segments in order', () => {
    expect(parseFormattedText('Plain **bold** and _italic_.')).toEqual([
      { text: 'Plain ', bold: false, italic: false },
      { text: 'bold', bold: true, italic: false },
      { text: ' and ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
      { text: '.', bold: false, italic: false },
    ])
  })

  it('decodes an escaped literal asterisk back to a plain "*", never toggling bold', () => {
    expect(parseFormattedText('2 \\* 2 = 4')).toEqual([{ text: '2 * 2 = 4', bold: false, italic: false }])
  })

  it('decodes an escaped literal underscore back to a plain "_", never toggling italic', () => {
    expect(parseFormattedText('snake\\_case\\_name')).toEqual([
      { text: 'snake_case_name', bold: false, italic: false },
    ])
  })

  it('decodes an escaped literal backslash back to a plain "\\"', () => {
    expect(parseFormattedText('C:\\\\path')).toEqual([{ text: 'C:\\path', bold: false, italic: false }])
  })

  it('an empty string decodes to no segments', () => {
    expect(parseFormattedText('')).toEqual([])
  })
})

describe('docToPlainBody + parseFormattedText round-trip', () => {
  // parseFormattedText is the LOW-LEVEL tokenizer — real callers always
  // go through stripRichBodyMarker first (see FormattedText,
  // markupBodyToLetterDoc), so these tests do the same rather than
  // feeding parseFormattedText a still-marker-prefixed string directly.
  it('encoding then decoding a mixed-formatting paragraph reproduces the original text and marks', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('Plain '), bold('bold'), text(' and '), italic('italic'), text('.'))],
    }
    const { body: encoded } = stripRichBodyMarker(docToPlainBody(doc))
    const decoded = parseFormattedText(encoded)
    expect(decoded.map((s) => s.text).join('')).toBe('Plain bold and italic.')
    expect(decoded).toEqual([
      { text: 'Plain ', bold: false, italic: false },
      { text: 'bold', bold: true, italic: false },
      { text: ' and ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
      { text: '.', bold: false, italic: false },
    ])
  })

  it('a plain body (no marks, so no marker) containing literal asterisks/underscores round-trips to the exact original text', () => {
    const original = 'Use snake_case and 2 * 2 = 4, plus a \\ backslash.'
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text(original))] }
    const encoded = docToPlainBody(doc)
    expect(encoded.startsWith(RICH_BODY_MARKER)).toBe(false)
    const decoded = parseFormattedText(encoded)
    expect(decoded.map((s) => s.text).join('')).toBe(original)
  })
})

describe('markupBodyToLetterDoc', () => {
  it('reconstructs bold/italic marks from a properly marker-prefixed encoded body', () => {
    const original: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('Plain '), bold('bold'), text(' and '), italic('italic'), text('.'))],
    }
    const encoded = docToPlainBody(original)
    const doc = markupBodyToLetterDoc(encoded)
    expect(docToPlainBody(doc)).toBe(encoded)
  })

  it('preserves paragraph breaks exactly like plainBodyToLetterDoc', () => {
    const original: LetterDocJSON = { type: 'doc', content: [paragraph(bold('First.')), paragraph(text('Second.'))] }
    const encoded = docToPlainBody(original)
    const doc = markupBodyToLetterDoc(encoded)
    expect(docToPlainBody(doc)).toBe(encoded)
  })

  it('preserves a hard break (single newline) within one paragraph, decoding marks on each line', () => {
    const original: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(bold('Line one'), { type: 'hardBreak' }, text('Line two'))],
    }
    const encoded = docToPlainBody(original)
    const doc = markupBodyToLetterDoc(encoded)
    expect(docToPlainBody(doc)).toBe(encoded)
  })

  it('a legacy plain-text draft (written before this feature existed, no marker, no markup at all) decodes identically to plainBodyToLetterDoc', () => {
    const legacy = 'Just an ordinary draft.\n\nWith two paragraphs.'
    expect(docToPlainBody(markupBodyToLetterDoc(legacy))).toBe(docToPlainBody(plainBodyToLetterDoc(legacy)))
  })

  it('falls back to the empty document for blank input', () => {
    expect(markupBodyToLetterDoc('   ')).toEqual(EMPTY_LETTER_DOC)
  })

  // The actual defect this audit found and fixed: a body with NO
  // marker (whether genuinely historical, or just hand-written text
  // that happens to look like markup) must never be mark-decoded, no
  // matter what "**"/"_" sequences it coincidentally contains.
  it('a marker-LESS body that merely LOOKS like markup is treated as pure literal text, never decoded as marks', () => {
    const looksFormatted = '**not originally bold** and my_username and one_two_three'
    const doc = markupBodyToLetterDoc(looksFormatted)
    // plainBodyToLetterDoc's own behavior for this exact string is the
    // correctness bar: identical treatment, no special-casing.
    expect(docToPlainBody(doc)).toBe(docToPlainBody(plainBodyToLetterDoc(looksFormatted)))
  })
})

// Board usability checkpoint (2026-09-09) — dispatchBodyToDoc is the
// Dispatch-editing reconstruction function. Deliberately NOT a second
// implementation of text/mark/hardBreak decoding: it delegates entirely
// to markupBodyToLetterDoc (already exhaustively tested above) and adds
// only Moment reattachment, so these tests focus on exactly that new
// behavior plus a full round-trip proof.
describe('dispatchBodyToDoc', () => {
  it('with no Moments, behaves identically to markupBodyToLetterDoc', () => {
    const body = docToPlainBody({ type: 'doc', content: [paragraph(bold('Hello')), paragraph(text('World'))] })
    expect(dispatchBodyToDoc(body)).toEqual(markupBodyToLetterDoc(body))
  })

  it('reattaches a Moment at its exact paragraph position, as the paragraph\'s last inline node', () => {
    const original: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('First paragraph, with a photo.'), photoMoment('author-1/a.jpg')), paragraph(text('Second paragraph, no photo.'))],
    }
    const body = docToPlainBody(original)
    const moments = docToMomentDrafts(original)
      .filter((m) => m.type === 'photo')
      .map((m) => ({ position: m.position, imagePath: m.imagePath, previewUrl: 'https://signed.test/a.jpg' }))

    const rebuilt = dispatchBodyToDoc(body, moments)
    expect(docToPlainBody(rebuilt)).toBe(body)

    const rebuiltMoments = docToMomentDrafts(rebuilt)
    expect(rebuiltMoments).toEqual([{ position: 0, type: 'photo', imagePath: 'author-1/a.jpg' }])
  })

  it('passes the resolved previewUrl through into the reattached node\'s attrs', () => {
    const rebuilt = dispatchBodyToDoc('One paragraph.', [
      { position: 0, imagePath: 'author-1/a.jpg', previewUrl: 'https://signed.test/a.jpg' },
    ])
    const momentNode = (rebuilt.content?.[0]?.content ?? []).find((n) => n.type === 'photoMoment')
    expect(momentNode).toEqual({
      type: 'photoMoment',
      attrs: { imagePath: 'author-1/a.jpg', previewUrl: 'https://signed.test/a.jpg' },
    })
  })

  it('full round-trip: bold/italic, a hard break, and a Moment all survive body -> doc -> body unchanged', () => {
    const original: LetterDocJSON = {
      type: 'doc',
      content: [
        paragraph(bold('Bold line'), { type: 'hardBreak' }, italic('italic line')),
        paragraph(text('A plain paragraph with a photo.'), photoMoment('author-1/b.jpg')),
      ],
    }
    const body = docToPlainBody(original)
    const moments = docToMomentDrafts(original)
      .filter((m) => m.type === 'photo')
      .map((m) => ({ position: m.position, imagePath: m.imagePath, previewUrl: null }))

    const rebuilt = dispatchBodyToDoc(body, moments)
    expect(docToPlainBody(rebuilt)).toBe(body)
  })

  it('a Moment at a paragraph index beyond the document is simply never attached, not an error', () => {
    const rebuilt = dispatchBodyToDoc('Only one paragraph.', [
      { position: 5, imagePath: 'author-1/orphan.jpg', previewUrl: null },
    ])
    expect(docToMomentDrafts(rebuilt)).toEqual([])
  })
})

// Draft-integrity checkpoint (2026-09-08) — the actual root cause of the
// live-reported "Photo Moments break after a draft refresh" bug: a
// photoMoment's `previewUrl` is a `URL.createObjectURL` blob: reference
// that dies with the page. stripTransientPhotoPreviews is the fix — see
// its own doc comment for the full root-cause trace.
describe('stripTransientPhotoPreviews', () => {
  it('strips previewUrl from a photoMoment node while keeping imagePath intact', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('A photo.'), photoMoment('corr-1/a.jpg', 'blob:http://localhost/abc-123'))],
    }
    const stripped = stripTransientPhotoPreviews(doc)
    const node = stripped.content?.[0]?.content?.find((n) => n.type === 'photoMoment')
    expect(node).toEqual({ type: 'photoMoment', attrs: { imagePath: 'corr-1/a.jpg', previewUrl: null } })
  })

  it('is a no-op for a photoMoment that already has no previewUrl', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(photoMoment('corr-1/b.jpg'))] }
    const stripped = stripTransientPhotoPreviews(doc)
    expect(stripped.content?.[0]?.content?.[0]).toEqual({
      type: 'photoMoment',
      attrs: { imagePath: 'corr-1/b.jpg', previewUrl: null },
    })
  })

  it('leaves text, hardBreak, and postcardMoment nodes completely untouched', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(bold('Bold text'), { type: 'hardBreak' }, postcardMoment('essaouira'))],
    }
    expect(stripTransientPhotoPreviews(doc)).toEqual(doc)
  })

  it('strips every photoMoment across multiple paragraphs, independently', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [
        paragraph(text('One.'), photoMoment('corr-1/a.jpg', 'blob:http://localhost/a')),
        paragraph(text('Two.')),
        paragraph(text('Three.'), photoMoment('corr-1/b.jpg', 'blob:http://localhost/b')),
      ],
    }
    const stripped = stripTransientPhotoPreviews(doc)
    const photoNodes = (stripped.content ?? []).flatMap((p) => p.content ?? []).filter((n) => n.type === 'photoMoment')
    expect(photoNodes).toEqual([
      { type: 'photoMoment', attrs: { imagePath: 'corr-1/a.jpg', previewUrl: null } },
      { type: 'photoMoment', attrs: { imagePath: 'corr-1/b.jpg', previewUrl: null } },
    ])
  })

  it('never mutates the original document object', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(photoMoment('corr-1/c.jpg', 'blob:http://localhost/c'))],
    }
    const original = JSON.parse(JSON.stringify(doc))
    stripTransientPhotoPreviews(doc)
    expect(doc).toEqual(original)
  })
})

// Live-repair checkpoint (2026-09-08) — docToPreviewMoments (previous
// checkpoint) is replaced by a pure descriptor extractor plus an async
// resolver. Part J's own explicit instruction: the async resolution
// logic must be directly testable via an injected fake resolver, never
// merely "proven" by inspecting source text.
describe('docToDraftMomentDescriptors', () => {
  it('a photo node with a live previewUrl carries it through untouched (Case 1: just added this session)', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('A photo.'), photoMoment('corr-1/a.jpg', 'blob:http://localhost/live-preview'))],
    }
    const descriptors = docToDraftMomentDescriptors(doc)
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]).toMatchObject({
      position: 0,
      type: 'photo',
      imagePath: 'corr-1/a.jpg',
      previewUrl: 'blob:http://localhost/live-preview',
    })
  })

  it('a restored photo node (previewUrl null) is reported honestly as null, never invented (Case 2)', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('A photo.'), photoMoment('corr-1/b.jpg', null))] }
    const descriptors = docToDraftMomentDescriptors(doc)
    expect(descriptors[0]).toMatchObject({ type: 'photo', imagePath: 'corr-1/b.jpg', previewUrl: null })
  })

  it('a postcard node carries its exact postcardKey', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('A card.'), postcardMoment('bangkokAfterRain'))] }
    const descriptors = docToDraftMomentDescriptors(doc)
    expect(descriptors[0]).toMatchObject({ type: 'postcard', postcardKey: 'bangkokAfterRain' })
  })

  it('a text-only document produces no descriptors', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('Just words.'))] }
    expect(docToDraftMomentDescriptors(doc)).toEqual([])
  })

  it('position matches the paragraph index when every paragraph has real text (the overwhelmingly common case)', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [
        paragraph(text('Zero.')),
        paragraph(text('One.'), photoMoment('corr-1/a.jpg', 'blob:http://x/a')),
        paragraph(text('Two.'), postcardMoment('essaouira')),
      ],
    }
    const descriptors = docToDraftMomentDescriptors(doc)
    expect(descriptors.map((d) => d.position)).toEqual([1, 2])
  })

  // Part F/J-I — the actual bug: docToPlainBody + splitParagraphs (the
  // SAME split write_letter/reply_to_letter mirror server-side with
  // regexp_split_to_array) collapse a text-empty interior paragraph
  // entirely, shifting every later paragraph's real rendered index down
  // by one. A Moment's position must predict THAT collapsed index, not
  // the raw paragraph-array index, or LetterBody looks it up against the
  // wrong paragraph (or none at all).
  describe('collapse-aware positions (Part F)', () => {
    it('an empty interior paragraph shifts a later Moment down by exactly one position', () => {
      const doc: LetterDocJSON = {
        type: 'doc',
        content: [
          paragraph(text('Zero.')),
          paragraph(), // blank spacing paragraph — contributes no text at all
          paragraph(text('Two.'), photoMoment('corr-1/a.jpg', 'blob:http://x/a')),
        ],
      }
      // Prove the prediction against the REAL collapsed array LetterBody
      // actually indexes by, computed the exact same way it is at read
      // time — never asserting a hand-picked number in isolation.
      const collapsed = splitParagraphs(docToPlainBody(doc))
      expect(collapsed).toEqual(['Zero.', 'Two.'])

      const descriptors = docToDraftMomentDescriptors(doc)
      expect(descriptors[0].position).toBe(1)
      expect(collapsed[descriptors[0].position]).toBe('Two.')
    })

    it('a run of several empty interior paragraphs still collapses to exactly one shift', () => {
      const doc: LetterDocJSON = {
        type: 'doc',
        content: [
          paragraph(text('Zero.')),
          paragraph(),
          paragraph(),
          paragraph(),
          paragraph(text('Four.'), photoMoment('corr-1/a.jpg', null)),
        ],
      }
      const collapsed = splitParagraphs(docToPlainBody(doc))
      expect(collapsed).toEqual(['Zero.', 'Four.'])
      const descriptors = docToDraftMomentDescriptors(doc)
      expect(descriptors[0].position).toBe(1)
    })

    it('a leading empty paragraph is fully absorbed by the whole-body trim — later positions shift down accordingly', () => {
      const doc: LetterDocJSON = {
        type: 'doc',
        content: [paragraph(), paragraph(text('One.'), postcardMoment('essaouira'))],
      }
      const collapsed = splitParagraphs(docToPlainBody(doc))
      expect(collapsed).toEqual(['One.'])
      const descriptors = docToDraftMomentDescriptors(doc)
      expect(descriptors[0].position).toBe(0)
    })

    it('a Moment on a trailing empty paragraph maps to the last surviving paragraph, never an out-of-range position', () => {
      const doc: LetterDocJSON = {
        type: 'doc',
        content: [paragraph(text('One.')), paragraph(text('Two.')), paragraph(photoMoment('corr-1/a.jpg', null))],
      }
      const collapsed = splitParagraphs(docToPlainBody(doc))
      expect(collapsed).toEqual(['One.', 'Two.'])
      const descriptors = docToDraftMomentDescriptors(doc)
      expect(descriptors[0].position).toBeLessThan(collapsed.length)
      expect(descriptors[0].position).toBe(1)
    })

    it('a standalone Moment between passages remains after the preceding passage', () => {
      const doc: LetterDocJSON = {
        type: 'doc',
        content: [
          paragraph(text('Before.')),
          paragraph(photoMoment('corr-1/gap.jpg', null)),
          paragraph(text('After.')),
        ],
      }
      const collapsed = splitParagraphs(docToPlainBody(doc))
      expect(collapsed).toEqual(['Before.', 'After.'])
      const descriptors = docToDraftMomentDescriptors(doc)
      expect(descriptors[0].position).toBe(0)
      expect(collapsed[descriptors[0].position]).toBe('Before.')
    })

    it('multiple empty gaps between several Moments all resolve to valid, correctly-ordered positions', () => {
      const doc: LetterDocJSON = {
        type: 'doc',
        content: [
          paragraph(text('Zero.'), photoMoment('corr-1/a.jpg', 'blob:http://x/a')),
          paragraph(),
          paragraph(text('Two.'), photoMoment('corr-1/b.jpg', null)),
          paragraph(),
          paragraph(text('Four.'), postcardMoment('bangkokAfterRain')),
        ],
      }
      const collapsed = splitParagraphs(docToPlainBody(doc))
      expect(collapsed).toEqual(['Zero.', 'Two.', 'Four.'])
      const descriptors = docToDraftMomentDescriptors(doc)
      expect(descriptors.map((d) => d.position)).toEqual([0, 1, 2])
      for (const d of descriptors) expect(d.position).toBeLessThan(collapsed.length)
    })
  })
})

// Part D/J — resolveDraftPreviewMoments is the async half: it never
// trusts a resolved photo's `previewUrl` alone (Preview must not depend
// on it being present), resolves every restored photo in parallel via
// an injected resolver, and never drops a Moment when one photo fails.
describe('resolveDraftPreviewMoments', () => {
  function neverCalledResolver() {
    return async (): Promise<{ url: string | null; error: string | null }> => {
      throw new Error('resolver should never be called for a photo that already has a live previewUrl')
    }
  }

  it('Case 1 — a descriptor with a live previewUrl resolves directly, without ever calling the resolver', async () => {
    const descriptors = [
      { id: 'm-1', position: 0, type: 'photo' as const, imagePath: 'corr-1/a.jpg', previewUrl: 'blob:http://x/live' },
    ]
    const moments = await resolveDraftPreviewMoments(descriptors, neverCalledResolver())
    expect(moments).toEqual([{ id: 'm-1', position: 0, type: 'photo', imageUrl: 'blob:http://x/live', postcardKey: null }])
  })

  it('Case 2 — a descriptor with previewUrl null calls the injected resolver against its imagePath', async () => {
    const calls: string[] = []
    const resolver = async (imagePath: string) => {
      calls.push(imagePath)
      return { url: `https://signed.test/${imagePath}`, error: null }
    }
    const descriptors = [
      { id: 'm-1', position: 0, type: 'photo' as const, imagePath: 'corr-1/restored.jpg', previewUrl: null },
    ]
    const moments = await resolveDraftPreviewMoments(descriptors, resolver)
    expect(calls).toEqual(['corr-1/restored.jpg'])
    expect(moments[0]).toMatchObject({ imageUrl: 'https://signed.test/corr-1/restored.jpg' })
  })

  it('a resolution failure substitutes the real, always-loadable fallback image — never null, never dropped (Part H)', async () => {
    const failingResolver = async () => ({ url: null, error: 'RLS denied' })
    const descriptors = [
      { id: 'm-1', position: 0, type: 'photo' as const, imagePath: 'corr-1/gone.jpg', previewUrl: null },
    ]
    const moments = await resolveDraftPreviewMoments(descriptors, failingResolver)
    expect(moments).toHaveLength(1)
    expect(moments[0].imageUrl).toBe(UNAVAILABLE_PHOTO_DATA_URI)
    expect(moments[0].imageUrl).not.toBeNull()
  })

  it('three independent restored photos each resolve on their own — one failing never blocks or drops the others (Part J-C/J)', async () => {
    const resolver = async (imagePath: string) => {
      if (imagePath === 'corr-1/bad.jpg') return { url: null, error: 'denied' }
      return { url: `https://signed.test/${imagePath}`, error: null }
    }
    const descriptors = [
      { id: 'm-1', position: 0, type: 'photo' as const, imagePath: 'corr-1/good1.jpg', previewUrl: null },
      { id: 'm-2', position: 1, type: 'photo' as const, imagePath: 'corr-1/bad.jpg', previewUrl: null },
      { id: 'm-3', position: 2, type: 'photo' as const, imagePath: 'corr-1/good2.jpg', previewUrl: null },
    ]
    const moments = await resolveDraftPreviewMoments(descriptors, resolver)
    expect(moments).toHaveLength(3)
    expect(moments[0].imageUrl).toBe('https://signed.test/corr-1/good1.jpg')
    expect(moments[1].imageUrl).toBe(UNAVAILABLE_PHOTO_DATA_URI)
    expect(moments[2].imageUrl).toBe('https://signed.test/corr-1/good2.jpg')
  })

  it('a postcard descriptor passes straight through with no resolution and no resolver call', async () => {
    const descriptors = [{ id: 'm-1', position: 0, type: 'postcard' as const, postcardKey: 'essaouira' }]
    const moments = await resolveDraftPreviewMoments(descriptors, neverCalledResolver())
    expect(moments).toEqual([{ id: 'm-1', position: 0, type: 'postcard', imageUrl: null, postcardKey: 'essaouira' }])
  })

  // Part J-G — the full live-reported scenario: text + several restored
  // Photos + a Postcard, end to end through descriptor extraction and
  // resolution, landing on the exact positions LetterBody will look up.
  it('restored text + 3 Photos + a Postcard all survive descriptor extraction and resolution together', async () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [
        paragraph(text('Paragraph zero.'), photoMoment('corr-1/a.jpg', null)),
        paragraph(text('Paragraph one.'), photoMoment('corr-1/b.jpg', null)),
        paragraph(text('Paragraph two.'), postcardMoment('bangkokAfterRain')),
        paragraph(text('Paragraph three.'), photoMoment('corr-1/c.jpg', null)),
      ],
    }
    const collapsed = splitParagraphs(docToPlainBody(doc))
    expect(collapsed).toHaveLength(4)

    const descriptors = docToDraftMomentDescriptors(doc)
    expect(descriptors).toHaveLength(4)

    const resolver = async (imagePath: string) => ({ url: `https://signed.test/${imagePath}`, error: null })
    const moments = await resolveDraftPreviewMoments(descriptors, resolver)

    expect(moments).toHaveLength(4)
    expect(moments.map((m) => m.type)).toEqual(['photo', 'photo', 'postcard', 'photo'])
    for (const m of moments) expect(m.position).toBeLessThan(collapsed.length)
    expect(moments.find((m) => m.type === 'postcard')?.postcardKey).toBe('bangkokAfterRain')
    expect(moments.every((m) => m.type !== 'photo' || typeof m.imageUrl === 'string')).toBe(true)
  })

  // Part J-B — a draft saved BEFORE stripTransientPhotoPreviews existed
  // still has a dead blob: reference sitting in localStorage. Reading it
  // back must self-heal (strip the dead value) and still end up
  // resolvable through the exact same pipeline as any other restored
  // photo — never left permanently stuck on the stale blob:.
  it('a stale pre-fix draft (dead blob: previewUrl) is sanitized on read, then resolves fresh via the injected resolver', async () => {
    const staleDraft: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('An old draft.'), photoMoment('corr-1/stale.jpg', 'blob:http://localhost/dead-on-reload'))],
    }
    const sanitized = stripTransientPhotoPreviews(staleDraft)
    const descriptors = docToDraftMomentDescriptors(sanitized)
    expect(descriptors[0]).toMatchObject({ imagePath: 'corr-1/stale.jpg', previewUrl: null })

    const resolver = async (imagePath: string) => ({ url: `https://signed.test/${imagePath}`, error: null })
    const moments = await resolveDraftPreviewMoments(descriptors, resolver)
    expect(moments[0].imageUrl).toBe('https://signed.test/corr-1/stale.jpg')
    expect(moments[0].imageUrl).not.toMatch(/^blob:/)
  })

  // Part J-E — Preview must never depend on previewUrl being present;
  // proven here by a fully-restored descriptor set (every previewUrl
  // null) still producing a complete, correctly-typed Moment[] using
  // only the injected resolver.
  it('resolves an entirely-restored set of descriptors (every previewUrl null) with no dependency on previewUrl at all', async () => {
    const descriptors = [
      { id: 'm-1', position: 0, type: 'photo' as const, imagePath: 'corr-1/a.jpg', previewUrl: null },
      { id: 'm-2', position: 1, type: 'photo' as const, imagePath: 'corr-1/b.jpg', previewUrl: null },
    ]
    const resolver = async (imagePath: string) => ({ url: `https://signed.test/${imagePath}`, error: null })
    const moments = await resolveDraftPreviewMoments(descriptors, resolver)
    expect(moments.every((m) => typeof m.imageUrl === 'string')).toBe(true)
  })
})

// Pre-migration audit correction (2026-09-14), Part 2 — NEW POSTCARDS
// ARE NOT MOMENTS: write_letter/reply_to_letter no longer accept a
// 'postcard'-type entry in p_moments at all. A draft saved before that
// checkpoint may still carry an old inline postcardMoment node; these
// prove the client-side migration halves that make NEW composition
// structurally incapable of resubmitting one.
describe('extractLegacyPostcardMoment', () => {
  it('finds a postcardMoment node anywhere in the document', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('Dear friend,')), paragraph(text('A card.'), postcardMoment('essaouira'))],
    }
    expect(extractLegacyPostcardMoment(doc)).toEqual({ postcardKey: 'essaouira' })
  })

  it('returns null when there is none', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('Just words.'))] }
    expect(extractLegacyPostcardMoment(doc)).toBeNull()
  })

  it('returns the FIRST one when (unexpectedly) more than one exists — never multiple Postcards', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [
        paragraph(postcardMoment('essaouira')),
        paragraph(postcardMoment('bangkokAfterRain')),
      ],
    }
    expect(extractLegacyPostcardMoment(doc)).toEqual({ postcardKey: 'essaouira' })
  })

  it('is unaffected by photoMoment nodes coexisting in the same document', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(text('A photo.'), photoMoment('corr-1/a.jpg'), postcardMoment('essaouira'))],
    }
    expect(extractLegacyPostcardMoment(doc)).toEqual({ postcardKey: 'essaouira' })
  })
})

describe('stripPostcardMoments', () => {
  it('removes every postcardMoment node, leaving text/hardBreak/photoMoment content untouched', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [
        paragraph(text('Dear friend,'), postcardMoment('essaouira')),
        paragraph(text('A photo.'), photoMoment('corr-1/a.jpg', null)),
      ],
    }
    const stripped = stripPostcardMoments(doc)
    const allTypes = (stripped.content ?? []).flatMap((p) => p.content ?? []).map((n) => n.type)
    expect(allTypes).not.toContain('postcardMoment')
    expect(allTypes).toContain('photoMoment')
    expect(allTypes).toContain('text')
  })

  it('removes ALL postcardMoment nodes if more than one exists', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [paragraph(postcardMoment('essaouira')), paragraph(postcardMoment('bangkokAfterRain'))],
    }
    const stripped = stripPostcardMoments(doc)
    const allTypes = (stripped.content ?? []).flatMap((p) => p.content ?? []).map((n) => n.type)
    expect(allTypes).not.toContain('postcardMoment')
  })

  it('is a no-op for a document with no postcardMoment node', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(text('Just words.'))] }
    expect(stripPostcardMoments(doc)).toEqual(doc)
  })

  it('never mutates the original document object', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [paragraph(postcardMoment('essaouira'))] }
    const original = JSON.parse(JSON.stringify(doc))
    stripPostcardMoments(doc)
    expect(doc).toEqual(original)
  })

  // Part 8-C (client-side half): once migrated, docToMomentDrafts on the
  // sanitized document can never produce a 'postcard'-type draft again —
  // the actual mechanism that keeps a NEW send's p_moments Photo-only,
  // independent of and in addition to write_letter's own server-side
  // rejection.
  it('after stripping, docToMomentDrafts never returns a postcard-type draft, even though it originally had one', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [
        paragraph(text('Dear friend,'), postcardMoment('essaouira')),
        paragraph(text('A photo.'), photoMoment('corr-1/a.jpg', null)),
      ],
    }
    const sanitized = stripPostcardMoments(doc)
    const drafts = docToMomentDrafts(sanitized)
    expect(drafts.every((d) => d.type === 'photo')).toBe(true)
    expect(drafts).toEqual([{ position: 1, type: 'photo', imagePath: 'corr-1/a.jpg' }])
  })
})
