import { describe, it, expect, afterEach } from 'vitest'
import {
  readLetterEditorDraft,
  writeLetterEditorDraft,
  clearLetterEditorDraft,
  readLetterPostcardDraft,
  writeLetterPostcardDraft,
  clearLetterPostcardDraft,
  readFirstContactDraft,
  writeFirstContactDraft,
  clearFirstContactDraft,
  readDispatchDraft,
  writeDispatchDraft,
  clearDispatchDraft,
  type DispatchDraft,
} from './letter-editor-draft'
import type { LetterPostcardDraft } from './moments'
import { EMPTY_LETTER_DOC, type LetterDocJSON } from './letter-editor-doc'

// This module's read/write/clear functions all go through
// window.localStorage directly. This project's Vitest environment is
// 'node' (see vitest.config.mts, matching the whole codebase's
// renderToStaticMarkup-only convention) — there is no `window` global
// at all by default. A minimal in-memory mock (Map-backed,
// getItem/setItem/removeItem only) is installed here rather than
// pulling in jsdom, specifically so the real key-scoping/isolation
// logic (the actual thing under audit) can be verified directly rather
// than assumed.
function installFakeLocalStorage() {
  const store = new Map<string, string>()
  const fakeStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  }
  ;(globalThis as unknown as { window: { localStorage: typeof fakeStorage } }).window = {
    localStorage: fakeStorage,
  }
}

function uninstallFakeLocalStorage() {
  delete (globalThis as { window?: unknown }).window
}

function doc(text: string): LetterDocJSON {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function docWithPhoto(
  text: string,
  imagePath: string,
  previewUrl: string | null = 'blob:http://localhost:3000/live-preview-abc'
): LetterDocJSON {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text },
          { type: 'photoMoment', attrs: { imagePath, previewUrl } },
        ],
      },
    ],
  }
}

describe('letter-editor-draft — correspondence-scoped (Write Anytime)', () => {
  afterEach(uninstallFakeLocalStorage)

  it('round-trips a draft for one correspondence', () => {
    installFakeLocalStorage()
    writeLetterEditorDraft('corr-1', doc('Hello'))
    expect(readLetterEditorDraft('corr-1')).toEqual(doc('Hello'))
  })

  it('an empty document is not persisted at all', () => {
    installFakeLocalStorage()
    writeLetterEditorDraft('corr-1', EMPTY_LETTER_DOC)
    expect(readLetterEditorDraft('corr-1')).toBeNull()
  })

  it('clearing removes the draft', () => {
    installFakeLocalStorage()
    writeLetterEditorDraft('corr-1', doc('Hello'))
    clearLetterEditorDraft('corr-1')
    expect(readLetterEditorDraft('corr-1')).toBeNull()
  })

  it('two different correspondences never share a draft', () => {
    installFakeLocalStorage()
    writeLetterEditorDraft('corr-1', doc('For corr 1'))
    writeLetterEditorDraft('corr-2', doc('For corr 2'))
    expect(readLetterEditorDraft('corr-1')).toEqual(doc('For corr 1'))
    expect(readLetterEditorDraft('corr-2')).toEqual(doc('For corr 2'))
  })
})

// Draft-integrity checkpoint (2026-09-08) — regression coverage for the
// live-reported bug: a member attaches Photo Moments, autosave fires,
// they refresh, and every photo comes back broken. Root cause: a
// photoMoment's `previewUrl` attr is a `URL.createObjectURL` blob:
// reference that dies with the page; it was being persisted (and
// restored) VERBATIM, which defeated PhotoMomentView's own already-
// correct "re-sign from imagePath when previewUrl is absent" fallback
// (photo-moment-node.tsx) by leaving a present-but-dead value in place.
// These test the actual persistence boundary directly (this module's
// own write/read functions) — the safest level available in this
// harness, since exercising the live Supabase re-signing call itself
// would require a live Storage integration this test suite cannot
// provide (documented limitation, not silently skipped).
describe('letter-editor-draft — Photo Moment draft durability (draft-integrity checkpoint)', () => {
  afterEach(uninstallFakeLocalStorage)

  // A + B: no blob/session-only URL persisted as the durable reference;
  // the durable imagePath survives.
  it('A/B. never persists a blob: previewUrl as the durable reference — imagePath survives, previewUrl does not', () => {
    installFakeLocalStorage()
    writeLetterEditorDraft('corr-1', docWithPhoto('A photo.', 'corr-1/real-upload.jpg'))

    // Reach past this module's own read function to inspect exactly
    // what's sitting in storage — proves the FIX applies at write time,
    // not merely by coincidence of the read path also sanitizing.
    const raw = JSON.parse(window.localStorage.getItem('tempa-letter-editor-draft:corr-1') as string)
    const node = raw.content[0].content.find((n: { type: string }) => n.type === 'photoMoment')
    expect(node.attrs.imagePath).toBe('corr-1/real-upload.jpg')
    expect(node.attrs.previewUrl).toBeNull()
    expect(JSON.stringify(raw)).not.toContain('blob:')
  })

  // C: rehydrating a saved draft reconstructs a usable photo source —
  // "usable" at this boundary means previewUrl is genuinely absent
  // (null) so PhotoMomentView's existing restore effect actually fires
  // and requests a fresh signed URL from the durable imagePath. This
  // test cannot exercise that live Supabase call itself (no live
  // Storage integration available in this harness) — it proves the
  // CONTRACT that effect depends on: imagePath intact, previewUrl null.
  it('C. restoring a draft yields a photoMoment node with imagePath intact and previewUrl explicitly null (the exact contract PhotoMomentView\'s re-sign effect depends on)', () => {
    installFakeLocalStorage()
    writeLetterEditorDraft('corr-1', docWithPhoto('A photo.', 'corr-1/real-upload.jpg'))
    const restored = readLetterEditorDraft('corr-1')
    const node = restored?.content?.[0]?.content?.find((n) => n.type === 'photoMoment')
    expect(node).toEqual({ type: 'photoMoment', attrs: { imagePath: 'corr-1/real-upload.jpg', previewUrl: null } })
  })

  // A draft already saved in a browser BEFORE this fix shipped still has
  // the stale blob: value sitting in localStorage — reading it back must
  // self-heal, not merely prevent the bug going forward.
  it('a draft already corrupted by the old bug (stale blob: previewUrl already on disk) self-heals the moment it is read back', () => {
    installFakeLocalStorage()
    // Bypass writeLetterEditorDraft entirely to simulate a draft that
    // was ALREADY written by the old, buggy code path before this fix.
    window.localStorage.setItem(
      'tempa-letter-editor-draft:corr-1',
      JSON.stringify(docWithPhoto('A photo.', 'corr-1/old-upload.jpg', 'blob:http://localhost:3000/dead-after-reload'))
    )
    const restored = readLetterEditorDraft('corr-1')
    const node = restored?.content?.[0]?.content?.find((n) => n.type === 'photoMoment')
    expect(node).toEqual({ type: 'photoMoment', attrs: { imagePath: 'corr-1/old-upload.jpg', previewUrl: null } })
  })

  // D. multiple Photo Moments survive serialization/restoration.
  it('D. multiple Photo Moments across different paragraphs all survive, each with the correct imagePath and no previewUrl', () => {
    installFakeLocalStorage()
    const multiPhotoDoc: LetterDocJSON = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'First.' },
            { type: 'photoMoment', attrs: { imagePath: 'corr-1/one.jpg', previewUrl: 'blob:http://x/1' } },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second, no photo.' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Third.' },
            { type: 'photoMoment', attrs: { imagePath: 'corr-1/two.jpg', previewUrl: 'blob:http://x/2' } },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Fourth.' },
            { type: 'photoMoment', attrs: { imagePath: 'corr-1/three.jpg', previewUrl: 'blob:http://x/3' } },
          ],
        },
      ],
    }
    writeLetterEditorDraft('corr-1', multiPhotoDoc)
    const restored = readLetterEditorDraft('corr-1')
    const photoNodes = (restored?.content ?? []).flatMap((p) => p.content ?? []).filter((n) => n.type === 'photoMoment')
    expect(photoNodes).toEqual([
      { type: 'photoMoment', attrs: { imagePath: 'corr-1/one.jpg', previewUrl: null } },
      { type: 'photoMoment', attrs: { imagePath: 'corr-1/two.jpg', previewUrl: null } },
      { type: 'photoMoment', attrs: { imagePath: 'corr-1/three.jpg', previewUrl: null } },
    ])
  })

  // E. text + Photo Moments + Postcard Moment coexist across restoration
  // (the exact live-reproduction scenario: "type text; add several Photo
  // Moments; add a Postcard Moment").
  it('E. text, multiple Photo Moments, and a Postcard Moment all coexist correctly across a full write/read cycle', () => {
    installFakeLocalStorage()
    const mixedDoc: LetterDocJSON = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Dear friend,' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Here is a photo.' },
            { type: 'photoMoment', attrs: { imagePath: 'corr-1/a.jpg', previewUrl: 'blob:http://x/a' } },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'And a postcard.' },
            { type: 'postcardMoment', attrs: { postcardKey: 'bangkokAfterRain' } },
          ],
        },
      ],
    }
    writeLetterEditorDraft('corr-1', mixedDoc)
    const restored = readLetterEditorDraft('corr-1')

    // F. Postcard persistence behavior remains completely unchanged —
    // no stripping applied to postcardMoment nodes at all.
    const postcardNode = (restored?.content ?? [])
      .flatMap((p) => p.content ?? [])
      .find((n) => n.type === 'postcardMoment')
    expect(postcardNode).toEqual({ type: 'postcardMoment', attrs: { postcardKey: 'bangkokAfterRain' } })

    const photoNode = (restored?.content ?? []).flatMap((p) => p.content ?? []).find((n) => n.type === 'photoMoment')
    expect(photoNode).toEqual({ type: 'photoMoment', attrs: { imagePath: 'corr-1/a.jpg', previewUrl: null } })

    // Every paragraph's text survives untouched.
    const allText = (restored?.content ?? [])
      .flatMap((p) => p.content ?? [])
      .filter((n): n is { type: 'text'; text: string } => n.type === 'text')
      .map((n) => n.text)
      .join(' | ')
    expect(allText).toBe('Dear friend, | Here is a photo. | And a postcard.')
  })
})

// Letter-Level Postcards V1 (2026-09-13) — the whole letter's one
// optional Postcard, held entirely SEPARATE from the ProseMirror doc
// draft above: its own localStorage key, its own read/write/clear
// functions. These prove exactly that isolation (Part A/B of the
// checkpoint's own test list) — a Postcard survives/clears completely
// independently of the letter's own text and Photo Moments.
function postcardDraft(overrides: Partial<LetterPostcardDraft> = {}): LetterPostcardDraft {
  return { postcardKey: 'essaouira', revealLine: '', backMessage: '', ...overrides }
}

describe('letter-editor-draft — letter-level Postcard draft (Letter-Level Postcards V1)', () => {
  afterEach(uninstallFakeLocalStorage)

  it('A. round-trips a Postcard draft for one correspondence', () => {
    installFakeLocalStorage()
    writeLetterPostcardDraft('corr-1', postcardDraft({ revealLine: 'Keep a little sea with you.' }))
    expect(readLetterPostcardDraft('corr-1')).toEqual(
      postcardDraft({ revealLine: 'Keep a little sea with you.' })
    )
  })

  it('is null when nothing has ever been saved', () => {
    installFakeLocalStorage()
    expect(readLetterPostcardDraft('corr-never-saved')).toBeNull()
  })

  it('removing it (writing null) clears the draft entirely', () => {
    installFakeLocalStorage()
    writeLetterPostcardDraft('corr-1', postcardDraft())
    writeLetterPostcardDraft('corr-1', null)
    expect(readLetterPostcardDraft('corr-1')).toBeNull()
  })

  it('clearLetterPostcardDraft also removes it', () => {
    installFakeLocalStorage()
    writeLetterPostcardDraft('corr-1', postcardDraft())
    clearLetterPostcardDraft('corr-1')
    expect(readLetterPostcardDraft('corr-1')).toBeNull()
  })

  it('B. the Postcard draft lives at a key entirely separate from the ProseMirror doc draft, for the SAME correspondence — removing one never touches the other', () => {
    installFakeLocalStorage()
    writeLetterEditorDraft('corr-1', docWithPhoto('Some text.', 'corr-1/a.jpg', 'blob:http://x/a'))
    writeLetterPostcardDraft('corr-1', postcardDraft({ backMessage: 'Dear friend,' }))

    clearLetterPostcardDraft('corr-1')

    expect(readLetterPostcardDraft('corr-1')).toBeNull()
    // The letter's text and Photo Moment survive untouched.
    const restoredDoc = readLetterEditorDraft('corr-1')
    const photoNode = (restoredDoc?.content ?? []).flatMap((p) => p.content ?? []).find((n) => n.type === 'photoMoment')
    expect(photoNode).toEqual({ type: 'photoMoment', attrs: { imagePath: 'corr-1/a.jpg', previewUrl: null } })
  })

  it('the reverse also holds: clearing the letter\'s own doc draft never touches its Postcard draft', () => {
    installFakeLocalStorage()
    writeLetterEditorDraft('corr-1', doc('Some text.'))
    writeLetterPostcardDraft('corr-1', postcardDraft({ backMessage: 'Still here.' }))

    clearLetterEditorDraft('corr-1')

    expect(readLetterEditorDraft('corr-1')).toBeNull()
    expect(readLetterPostcardDraft('corr-1')).toEqual(postcardDraft({ backMessage: 'Still here.' }))
  })

  it('two different correspondences never share a Postcard draft', () => {
    installFakeLocalStorage()
    writeLetterPostcardDraft('corr-1', postcardDraft({ postcardKey: 'essaouira' }))
    writeLetterPostcardDraft('corr-2', postcardDraft({ postcardKey: 'bangkokAfterRain' }))
    expect(readLetterPostcardDraft('corr-1')?.postcardKey).toBe('essaouira')
    expect(readLetterPostcardDraft('corr-2')?.postcardKey).toBe('bangkokAfterRain')
  })
})

describe('letter-editor-draft — letter-level Postcard draft, no window/localStorage available', () => {
  it('read fails safely to null rather than throwing', () => {
    expect(() => readLetterPostcardDraft('corr-1')).not.toThrow()
    expect(readLetterPostcardDraft('corr-1')).toBeNull()
  })

  it('write fails safely without throwing', () => {
    expect(() => writeLetterPostcardDraft('corr-1', postcardDraft())).not.toThrow()
  })

  it('clear fails safely without throwing', () => {
    expect(() => clearLetterPostcardDraft('corr-1')).not.toThrow()
  })
})

// Writing-essentials compatibility audit (2026-09-05) — Letter 1
// previously had no draft persistence at all. It now reuses this exact
// same rich-JSON architecture, scoped by recipientId instead of
// correspondenceId (no correspondence exists yet before Letter 1 is
// sent). These prove the actual product requirement: a draft begun for
// one recipient must never surface in a different recipient's composer.
describe('letter-editor-draft — first-contact-scoped (Letter 1, before any correspondence exists)', () => {
  afterEach(uninstallFakeLocalStorage)

  it('round-trips a draft for one recipient', () => {
    installFakeLocalStorage()
    writeFirstContactDraft('recipient-a', doc('Hello A'))
    expect(readFirstContactDraft('recipient-a')).toEqual(doc('Hello A'))
  })

  it('a draft begun for one recipient never appears for a different recipient', () => {
    installFakeLocalStorage()
    writeFirstContactDraft('recipient-a', doc('For A'))
    expect(readFirstContactDraft('recipient-b')).toBeNull()
  })

  it('two different recipients keep fully independent drafts', () => {
    installFakeLocalStorage()
    writeFirstContactDraft('recipient-a', doc('For A'))
    writeFirstContactDraft('recipient-b', doc('For B'))
    expect(readFirstContactDraft('recipient-a')).toEqual(doc('For A'))
    expect(readFirstContactDraft('recipient-b')).toEqual(doc('For B'))
  })

  it("clearing one recipient's draft does not affect a different recipient's draft", () => {
    installFakeLocalStorage()
    writeFirstContactDraft('recipient-a', doc('For A'))
    writeFirstContactDraft('recipient-b', doc('For B'))
    clearFirstContactDraft('recipient-a')
    expect(readFirstContactDraft('recipient-a')).toBeNull()
    expect(readFirstContactDraft('recipient-b')).toEqual(doc('For B'))
  })

  it('an empty document is not persisted at all', () => {
    installFakeLocalStorage()
    writeFirstContactDraft('recipient-a', EMPTY_LETTER_DOC)
    expect(readFirstContactDraft('recipient-a')).toBeNull()
  })

  it('first-contact and correspondence-scoped drafts use entirely separate keys — a colliding literal id never resolves to the wrong draft', () => {
    installFakeLocalStorage()
    const sameId = 'shared-id-123'
    writeFirstContactDraft(sameId, doc('First contact draft'))
    writeLetterEditorDraft(sameId, doc('Correspondence draft'))
    expect(readFirstContactDraft(sameId)).toEqual(doc('First contact draft'))
    expect(readLetterEditorDraft(sameId)).toEqual(doc('Correspondence draft'))
  })
})

// Dispatches and The Board checkpoint (2026-09-07) — there is no
// server-side draft row for a Dispatch at all (see docs/sql/2026-09-07-
// dispatches-and-board.sql), so this localStorage scope IS the entire
// draft lifecycle. Scoped by authorId, same isolation principle as the
// other two scopes above. Carries title + topics alongside the
// document, unlike the other scopes.
function dispatchDraft(title: string, text: string, topics: string[] = []): DispatchDraft {
  return { title, doc: doc(text), topics }
}

describe('letter-editor-draft — Dispatch-scoped (before publish)', () => {
  afterEach(uninstallFakeLocalStorage)

  it('14. round-trips a draft for one author, including title and topics', () => {
    installFakeLocalStorage()
    writeDispatchDraft('author-a', dispatchDraft('A one-line title', 'A Dispatch draft', ['ritual']))
    expect(readDispatchDraft('author-a')).toEqual(dispatchDraft('A one-line title', 'A Dispatch draft', ['ritual']))
  })

  it('two different authors on the same device keep fully isolated drafts', () => {
    installFakeLocalStorage()
    writeDispatchDraft('author-a', dispatchDraft('From A', 'Body A'))
    writeDispatchDraft('author-b', dispatchDraft('From B', 'Body B'))
    expect(readDispatchDraft('author-a')).toEqual(dispatchDraft('From A', 'Body A'))
    expect(readDispatchDraft('author-b')).toEqual(dispatchDraft('From B', 'Body B'))
  })

  it('15. clearing after a successful publish removes the draft', () => {
    installFakeLocalStorage()
    writeDispatchDraft('author-a', dispatchDraft('Ready', 'Ready to publish'))
    clearDispatchDraft('author-a')
    expect(readDispatchDraft('author-a')).toBeNull()
  })

  it("16. clearing one author's draft never touches a different author's draft (a failed publish for one author must never look like it cleared another's)", () => {
    installFakeLocalStorage()
    writeDispatchDraft('author-a', dispatchDraft('From A', 'Body A'))
    writeDispatchDraft('author-b', dispatchDraft('From B', 'Body B'))
    clearDispatchDraft('author-a')
    expect(readDispatchDraft('author-a')).toBeNull()
    expect(readDispatchDraft('author-b')).toEqual(dispatchDraft('From B', 'Body B'))
  })

  it('a draft with no title, no body content, and no topics is not persisted at all', () => {
    installFakeLocalStorage()
    writeDispatchDraft('author-a', { title: '   ', doc: EMPTY_LETTER_DOC, topics: [] })
    expect(readDispatchDraft('author-a')).toBeNull()
  })

  it('a title alone (no body yet) is still worth persisting', () => {
    installFakeLocalStorage()
    writeDispatchDraft('author-a', { title: 'Just a title so far', doc: EMPTY_LETTER_DOC, topics: [] })
    expect(readDispatchDraft('author-a')?.title).toBe('Just a title so far')
  })

  it('Dispatch and first-contact drafts use entirely separate keys — a colliding literal id never resolves to the wrong draft', () => {
    installFakeLocalStorage()
    const sameId = 'shared-id-456'
    writeDispatchDraft(sameId, dispatchDraft('Dispatch title', 'Dispatch draft'))
    writeFirstContactDraft(sameId, doc('First contact draft'))
    expect(readDispatchDraft(sameId)).toEqual(dispatchDraft('Dispatch title', 'Dispatch draft'))
    expect(readFirstContactDraft(sameId)).toEqual(doc('First contact draft'))
  })
})

describe('letter-editor-draft — no window/localStorage available (SSR or storage failure)', () => {
  it('read fails safely to null rather than throwing', () => {
    expect(() => readFirstContactDraft('recipient-a')).not.toThrow()
    expect(readFirstContactDraft('recipient-a')).toBeNull()
  })

  it('write fails safely without throwing', () => {
    expect(() => writeFirstContactDraft('recipient-a', doc('Hello'))).not.toThrow()
  })

  it('clear fails safely without throwing', () => {
    expect(() => clearFirstContactDraft('recipient-a')).not.toThrow()
  })
})
