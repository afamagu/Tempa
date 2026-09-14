import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import PostcardEditor from './postcard-editor'
import { REVEAL_LINE_MAX_LENGTH, POSTCARD_BACK_MESSAGE_MAX_LENGTH } from '@/lib/moments'
import type { PostcardCatalogEntry } from '@/lib/postcards'

const SOURCE_PATH = path.join(__dirname, 'postcard-editor.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

const ESSAOUIRA: PostcardCatalogEntry = {
  key: 'essaouira',
  title: 'Essaouira',
  countryCode: 'MA',
  location: 'Atlantic Morocco',
  collection: 'Atlantic Morocco Collection',
  postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
  footerText: 'Tempa Postcard · Atlantic Morocco Collection',
  frontImagePath: '/postcards/essaouira.jpg',
  motionSrc: '/postcards/essaouira-living.mp4',
  durationSeconds: 10.04,
  revealLineAlignment: null,
}

function render(overrides: Partial<Parameters<typeof PostcardEditor>[0]> = {}) {
  return renderToStaticMarkup(
    <PostcardEditor
      draft={{ postcardKey: 'essaouira', revealLine: '', backMessage: '' }}
      catalogEntry={ESSAOUIRA}
      senderPseudonym="Morning Larch"
      onChange={() => {}}
      onChangePostcard={() => {}}
      onRemove={() => {}}
      onDone={() => {}}
      {...overrides}
    />
  )
}

// Part 7 — reuses the real Postcard visual shell: the unmodified
// PostcardObject for the front/flip/Living-Reveal preview, and the
// exported PostcardBack (with `editable`) for the actual writing
// surface — never a generic "Message: [input]" form.
describe('PostcardEditor — Part 7. reuses the real Postcard visual shell', () => {
  it('renders the real, unmodified PostcardObject for the front/flip preview', () => {
    const html = render()
    expect(html).toContain(ESSAOUIRA.frontImagePath)
    expect(html).toContain('postcard-perspective')
    expect(html).toContain('Turn over')
  })

  it('provides a restrained reveal-line input with a hard 32-character maximum, no formatting/emoji-picker controls', () => {
    const html = render()
    expect(html).toContain('A few words for the reveal')
    expect(html).toContain(`maxLength="${REVEAL_LINE_MAX_LENGTH}"`)
    // No formatting toolbar or emoji picker control anywhere in this
    // view — "italic" legitimately appears as CSS styling on the back's
    // sender-name/postmark text, so this checks for an actual CONTROL
    // (an aria-label or a WritingToolbar import), never a bare substring.
    expect(html.toLowerCase()).not.toContain('emoji')
    expect(html).not.toMatch(/aria-label="[^"]*(bold|italic|emoji)[^"]*"/i)
    expect(source).not.toContain('WritingToolbar')
    expect(source).not.toContain('emoji-picker')
  })

  // Live UX repair (2026-09-14), Part 3 — "the Reveal Line also needs
  // an obvious editable entry point": the field already existed; what
  // was missing was a brief explanation of what it actually does.
  it('supports the Reveal Line field with a brief, restrained explanation of what it does', () => {
    const html = render()
    expect(html).toContain('Appears while the postcard comes alive.')
  })

  it('a blank Reveal Line remains valid — the input has no required attribute and no non-empty validation', () => {
    const html = render({ draft: { postcardKey: 'essaouira', revealLine: '', backMessage: '' } })
    expect(html).not.toMatch(/id="postcard-reveal-line"[^>]*required/)
  })

  it('never overlays the Reveal Line control permanently on the front artwork — it is a plain field below the preview, not an absolutely-positioned overlay', () => {
    const revealFieldStart = source.indexOf('id="postcard-reveal-line"')
    const before = source.slice(0, revealFieldStart)
    // The input sits in ordinary document flow alongside PostcardObject
    // — never inside FrontVisual/the flip container, and never styled
    // with absolute positioning of its own.
    expect(before).not.toContain('className="absolute')
  })

  // Live UX repair (2026-09-14) — root cause was that the writable back
  // used to be a SEPARATE, disconnected PostcardBack rendered below the
  // preview, never reachable via the card's own "Turn over" control
  // (which flipped to a plain, non-editable back instead). Fixed by
  // forwarding a single `editableBack` prop into the ONE PostcardObject
  // call — these tests confirm that wiring, not a second parallel one.
  it('passes editableBack into the single PostcardObject call — no second, separate PostcardBack rendered below it', () => {
    expect(source).toContain('editableBack={{')
    expect(source).not.toContain('<PostcardBack')
    expect(source).not.toContain("import PostcardObject, { PostcardBack }")
  })

  it('the writable back (reached via Turn over) carries the current backMessage, capped at 200 characters — never a generic "Message: [input]" label', () => {
    const html = render({ draft: { postcardKey: 'essaouira', revealLine: '', backMessage: 'Made it here at last.' } })
    expect(html).toContain('<textarea')
    expect(html).toContain('Made it here at last.')
    expect(html).toContain(`maxLength="${POSTCARD_BACK_MESSAGE_MAX_LENGTH}"`)
    expect(html).not.toMatch(/Message:\s*<input/i)
    // The real back's own stamp/postmark chrome still renders alongside
    // the writing surface.
    expect(html).toContain('ESSAOUIRA')
  })

  it('a restrained caption documents that Turn over is how to reach the writable back — no undocumented gesture', () => {
    const html = render()
    expect(html).toContain('Turn over to write on the back.')
  })
})

// Part 8 — calm controls: Change postcard / Remove / Done. Nothing here
// sends, and none of these require payment/ownership behavior.
describe('PostcardEditor — Part 8. calm actions, nothing sends from here', () => {
  it('exposes exactly Change postcard, Remove, and Done', () => {
    const html = render()
    expect(html).toContain('Change postcard')
    expect(html).toContain('Remove')
    expect(html).toContain('Done')
  })

  // Release Polish Pass — Remove is reversible (an unsent draft can
  // simply be re-attached), so it must never use the red/destructive
  // treatment reserved for genuinely destructive, consequential
  // actions elsewhere.
  it('Remove is toned down — no red/destructive styling', () => {
    const html = render()
    const removeIndex = html.indexOf('>Remove<')
    const buttonStart = html.lastIndexOf('<button', removeIndex)
    const buttonMarkup = html.slice(buttonStart, removeIndex)
    expect(buttonMarkup).not.toMatch(/text-red|border-red/)
  })

  it('has no RPC/Supabase send logic of its own', () => {
    expect(source).not.toContain('supabase')
    expect(source).not.toContain('.rpc(')
    expect(source).not.toContain('write_letter')
  })

  it('Done is pushed to the far edge of the actions row via an ordinary flex spacer, never absolute positioning', () => {
    expect(source).toContain('ml-auto')
    expect(source).not.toContain('className="absolute')
  })
})

// Production back-editing UX defect (2026-09-15) — this editor can now
// be opened while LetterPreview is also mounted underneath it (z-50 vs
// Preview's z-40), and Preview has its own document-level Escape
// listener. Without its own handler + stopPropagation, Escape would
// bubble to Preview and close IT instead of this editor.
describe('PostcardEditor — startOnBack (production back-editing UX defect)', () => {
  it('forwards startOnBack to PostcardObject as initialShowingBack', () => {
    expect(source).toContain('initialShowingBack={startOnBack}')
  })

  it('when true, the initial render already shows the writable back — no redundant "Turn over" tap needed for the sender who came here specifically to write it', () => {
    const html = render({ startOnBack: true })
    expect(html).toContain('aria-label="Postcard message"')
    expect(html).toContain('Back of postcard')
  })

  it('when omitted, the editor opens on the front exactly as before — the ordinary composer-slot edit path is unaffected', () => {
    const html = render()
    expect(html).toContain('Front of postcard')
    expect(html).not.toContain('Back of postcard')
  })
})

describe('PostcardEditor — Escape-to-close (production back-editing UX defect)', () => {
  it('registers its own keydown listener that closes via onDone on Escape', () => {
    expect(source).toContain("if (e.key === 'Escape')")
    expect(source).toContain('e.stopPropagation()')
    expect(source).toContain('onDone()')
    expect(source).toContain("document.addEventListener('keydown', handleKeyDown)")
  })

  it('cleans up its listener on unmount', () => {
    expect(source).toContain("document.removeEventListener('keydown', handleKeyDown)")
  })
})

describe('PostcardEditor — senderPseudonym (pre-migration audit correction, Part 5)', () => {
  it('shows the real sending member\'s pseudonym', () => {
    const html = render({ senderPseudonym: 'Evening Quill' })
    expect(html).toContain('Evening Quill')
  })
})

// Living Postcard final interaction verification (2026-09-15) — D/E/F/G
// LIVE browser-verified in this checkpoint's own report (real click into
// the writing region → visible caret on the real textarea → typed text
// appears → survives Turn over/Turn back → survives Done/reopen, since
// the draft lives in the caller's own state, not a local copy here).
// These source-level checks pin the wiring that made that possible.
describe('PostcardEditor — D/G. writing surfaces are real controlled inputs, not read-only mirrors', () => {
  it('D. the back textarea forwards every keystroke via onChange({ ...draft, backMessage: value }) — no local draft copy of its own', () => {
    expect(source).toContain("onChange: (value) => onChange({ ...draft, backMessage: value })")
  })

  it('G. the Reveal Line input forwards every keystroke via onChange({ ...draft, revealLine: e.target.value })', () => {
    expect(source).toContain("onChange={(e) => onChange({ ...draft, revealLine: e.target.value })}")
  })

  it('neither input keeps its own useState — both are fully controlled by the draft prop the caller owns, which is what makes F (survives Done/reopen) possible: the parent never discards this state when the editor unmounts', () => {
    expect(source).not.toContain('useState')
  })
})

describe('PostcardEditor — Admin Phase 2A-2: a catalogEntry of null shows an honest unavailable message rather than crashing', () => {
  it('renders a plain message and no PostcardObject when the active catalogue no longer has this key', () => {
    const html = render({
      draft: { postcardKey: 'no-longer-active', revealLine: '', backMessage: '' },
      catalogEntry: null,
    })
    expect(html).toContain('no longer available')
    expect(html).not.toContain('postcard-perspective')
  })
})
