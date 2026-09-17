import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import DispatchComposer from './dispatch-composer'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

const dispatchComposerSource = readFileSync(new URL('./dispatch-composer.tsx', import.meta.url), 'utf8')

// Same structural limitation accepted for every other Tiptap composer
// in this codebase (see moments-composer.test.tsx, first-letter-
// composer.test.tsx): immediatelyRender: false means the editor
// instance doesn't exist on this first render, so this only proves the
// safe pre-mount state — live typing needs a real browser.
describe('DispatchComposer — initial render (editor not yet mounted)', () => {
  // Dispatch Preview checkpoint (WRITE → PREVIEW → PUBLISH) — the
  // primary action in create mode is now "Preview Dispatch," never a
  // direct "Publish Dispatch". A blank title/body starts it disabled,
  // same as before, but now with a visible, understandable reason next
  // to it — the fix for the live "disabled with no explanation" defect.
  it('renders without crashing, starts with Preview disabled, and uses the required button label — never a direct Publish button', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).toContain('Preview Dispatch')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Preview Dispatch<\/button>/)
    expect(html).not.toContain('Publish Dispatch')
  })

  it('shows a visible, understandable reason next to the disabled Preview button — never an unexplained disabled control', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).toContain('A Dispatch needs a title.')
  })

  it('never uses any other composer\'s button vocabulary', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).not.toContain('Send letter')
    // Onboarding & First-Use checkpoint — the Question composer's own
    // button relabeled "Save answer" → "Save response" (terminology
    // pass, Section H); this assertion follows that rename so it keeps
    // proving genuine cross-composer separation rather than trivially
    // passing against retired copy.
    expect(html).not.toContain('Save response')
    expect(html).not.toMatch(/>Post</)
    expect(html).not.toMatch(/>Submit</)
  })

  it('uses the exact required title placeholder', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).toContain('What is this about, in one line?')
  })

  // Smoke-test contract completion checkpoint: 70 -> 140 (the migration
  // this earlier checkpoint deferred, docs/sql/2026-09-28-title-
  // postcard-and-edit-window.sql, has now been prepared for approval).
  it('the title input enforces the 140-character ceiling at the HTML level', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).toMatch(/maxLength="140"/)
  })

  // Post-onboarding corrections checkpoint (Section J) — the title
  // counter, muted at rest, never red from the first character. The
  // counter is written against whatever TITLE_MAX_CHARS currently is,
  // so it picked up the new 140 value automatically once that migration
  // was prepared, with no change to the counter's own logic.
  it('shows a live "N / 140" title counter, muted at rest (an empty title is not an error state)', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).toContain('0 / 140')
    expect(html).not.toContain('text-red-600')
  })

  it('the counter reflects typed length, still muted well below the ceiling', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" existingDispatch={undefined} />)
    // Static render only proves the initial (empty) state — live typing
    // needs a real browser, same limitation as every other Tiptap
    // composer test in this file. The color-escalation rule itself is
    // pinned by source inspection instead.
    expect(html).toContain('0 / 140')
  })

  it('the counter turns the same red used for the field\'s own validation error once length reaches the ceiling — never before', () => {
    expect(dispatchComposerSource).toContain(
      "title.length >= TITLE_MAX_CHARS ? 'text-red-600' : helperTextClass"
    )
  })

  // No product-level length limit for the body — this file never
  // defines a MAX_CHARS constant and always calls canSendLetter with
  // aboveMax: false. There is therefore no character-count/limit
  // indicator to ever render.
  it('never shows a body character-count or over-the-limit indicator', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).not.toMatch(/\/\s*4,?000/)
    expect(html).not.toMatch(/\/\s*2,?000/)
    expect(html).not.toMatch(/\/\s*10,?000/)
  })

  it('never uses like/reaction/comment/follower vocabulary', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html.toLowerCase()).not.toContain('like')
    expect(html.toLowerCase()).not.toContain('follow')
    expect(html.toLowerCase()).not.toContain('comment')
  })

  // Dispatch Postcards Checkpoint 2 — CREATE mode now offers the same
  // "+ Add a postcard" affordance the Letter composer already has,
  // reusing PostcardComposerSlot as-is; nothing is attached yet on this
  // first, pre-mount render, so the empty-slot button is what renders.
  it('offers the "+ Add a postcard" affordance in create mode', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).toContain('Add a postcard')
  })

  it('offers a topics input, capped at 3', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).toContain('Topics (optional, up to 3)')
  })
})

// Board usability checkpoint (2026-09-09): the SAME composer also
// serves editing (mode="edit" + existingDispatch), reusing this
// architecture rather than a parallel edit form. Title/topics are
// plain React state (unlike the editor's own body content, which lives
// inside Tiptap and — per this file's own pre-mount limitation above —
// never appears in this first, editor-not-yet-mounted render), so they
// alone are what this SSR-only render can prove pre-filled correctly.
describe('DispatchComposer — edit mode (item 11)', () => {
  const existingDispatch = {
    id: 'dispatch-1',
    title: 'An existing title',
    body: 'Some existing body.',
    topics: ['fashion', 'tailor'],
    moments: [],
    postcard: null,
  }

  it('uses "Save changes", never "Publish Dispatch" or "Preview Dispatch" — edit mode has no Preview step at all', () => {
    const html = renderToStaticMarkup(
      <DispatchComposer authorId="author-1" mode="edit" existingDispatch={existingDispatch} />
    )
    expect(html).toContain('Save changes')
    expect(html).not.toContain('Publish Dispatch')
    expect(html).not.toContain('Preview Dispatch')
    expect(html).not.toContain('Preview')
  })

  it('pre-fills the title input with the existing Dispatch\'s title', () => {
    const html = renderToStaticMarkup(
      <DispatchComposer authorId="author-1" mode="edit" existingDispatch={existingDispatch} />
    )
    expect(html).toMatch(/value="An existing title"/)
  })

  it('pre-fills the existing topics as chips', () => {
    const html = renderToStaticMarkup(
      <DispatchComposer authorId="author-1" mode="edit" existingDispatch={existingDispatch} />
    )
    expect(html).toContain('fashion')
    expect(html).toContain('tailor')
  })

  it('Back returns to the Dispatch itself, not the Board list', () => {
    const html = renderToStaticMarkup(
      <DispatchComposer authorId="author-1" mode="edit" existingDispatch={existingDispatch} />
    )
    expect(html).toContain('href="/board/dispatch-1"')
  })

  it('labels the screen "Edit Dispatch"', () => {
    const html = renderToStaticMarkup(
      <DispatchComposer authorId="author-1" mode="edit" existingDispatch={existingDispatch} />
    )
    expect(html).toContain('Edit Dispatch')
  })
})

// Dispatch Postcards Checkpoint 2.
describe('DispatchComposer — Postcard (Checkpoint 2)', () => {
  it('edit mode never offers the "Add a postcard" picker affordance — an existing Postcard is immutable, and there is none to add after publication', () => {
    const html = renderToStaticMarkup(
      <DispatchComposer
        authorId="author-1"
        mode="edit"
        existingDispatch={{
          id: 'dispatch-1',
          title: 'An existing title',
          body: 'Some existing body.',
          topics: [],
          moments: [],
          postcard: null,
        }}
      />
    )
    expect(html).not.toContain('Add a postcard')
  })

  it('edit mode shows an already-attached Postcard read-only, with no change/remove control', () => {
    const html = renderToStaticMarkup(
      <DispatchComposer
        authorId="author-1"
        mode="edit"
        existingDispatch={{
          id: 'dispatch-1',
          title: 'An existing title',
          body: 'Some existing body.',
          topics: [],
          moments: [],
          postcard: {
            revealLine: 'A little something.',
            backMessage: 'Written for this Dispatch.',
            senderPseudonymSnapshot: 'Evening Quill',
            version: {
              title: 'Essaouira',
              location: 'Atlantic Morocco',
              collection: 'Atlantic Morocco Collection',
              postmarkText: 'ESSAOUIRA',
              footerText: 'Tempa Postcard',
              frontImagePath: '/postcards/essaouira.jpg',
              motionSrc: null,
              durationSeconds: null,
              revealLineAlignment: null,
            },
          },
        }}
      />
    )
    expect(html).toContain('/postcards/essaouira.jpg')
    expect(html).not.toContain('Change postcard')
    expect(html).not.toContain('>Remove<')
    expect(html).not.toContain('Add a postcard')
  })
})

// Onboarding & First-Use checkpoint — the Dispatch composer + Postcard
// FeatureIntroductions, server-resolved and passed down as plain
// booleans (app/board/write/page.tsx), so both ARE directly
// prop-testable here without needing a mounted editor.
describe('DispatchComposer — FeatureIntroduction wiring', () => {
  it('shows the composer introduction only when showComposerIntro is true', () => {
    const shown = renderToStaticMarkup(<DispatchComposer authorId="author-1" showComposerIntro />)
    expect(shown).toContain('Leave something on the Board')
    expect(shown).toContain('Start writing')

    const hidden = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(hidden).not.toContain('Leave something on the Board')
  })

  // Post-onboarding corrections checkpoint (Section G) — a live smoke
  // test found the Postcard introduction stacked directly below the
  // Dispatch-writing introduction the instant the composer opened, too
  // much teaching at once. showPostcardIntro alone (still-unseen, per
  // guide_completions) is no longer sufficient to render it — only
  // actually activating the Postcard slot does (postcardIntroActive,
  // covered by source inspection below, since renderToStaticMarkup
  // can't exercise a click).
  it('never renders the Postcard introduction on initial render, even when showPostcardIntro is true — it needs a genuine slot activation first', () => {
    const shown = renderToStaticMarkup(<DispatchComposer authorId="author-1" showPostcardIntro />)
    expect(shown).not.toContain('Postcards')
    expect(shown).not.toContain('Choose a postcard')
    // The empty slot itself is what's shown instead, waiting to be
    // activated.
    expect(shown).toContain('Add a postcard')
  })

  it('does not stack the Postcard introduction under the Dispatch-writing introduction — only one lesson shows at a time on open', () => {
    const html = renderToStaticMarkup(
      <DispatchComposer authorId="author-1" showComposerIntro showPostcardIntro />
    )
    expect(html).toContain('Leave something on the Board')
    expect(html).not.toContain('Postcards')
  })

  it('the Postcard slot activation is gated on showPostcardIntro, and its CTA opens the real picker, not just a dismissal (Section G/H)', () => {
    expect(dispatchComposerSource).toContain('function handleAddPostcard() {')
    const fnStart = dispatchComposerSource.indexOf('function handleAddPostcard() {')
    const fnEnd = dispatchComposerSource.indexOf('\n  }', fnStart)
    const fnBody = dispatchComposerSource.slice(fnStart, fnEnd)
    expect(fnBody).toContain('if (showPostcardIntro) {')
    expect(fnBody).toContain('setPostcardIntroActive(true)')
    expect(fnBody).toContain('setPostcardPickerOpen(true)')

    expect(dispatchComposerSource).toContain('onAdd={handleAddPostcard}')
    const normalized = dispatchComposerSource.replace(/\s+/g, ' ')
    expect(normalized).toContain('onCta={() => { setPostcardIntroActive(false) setPostcardPickerOpen(true) }}')
  })

  it('neither introduction renders in edit mode — an author editing an existing Dispatch already knows how this works', () => {
    const html = renderToStaticMarkup(
      <DispatchComposer
        authorId="author-1"
        mode="edit"
        showComposerIntro
        showPostcardIntro
        existingDispatch={{
          id: 'd-1',
          title: 'A title',
          body: 'A body.',
          topics: [],
          moments: [],
          postcard: null,
        }}
      />
    )
    expect(html).not.toContain('Leave something on the Board')
    expect(html).not.toContain('Postcards')
  })

  it('the composer introduction uses the shared FeatureIntroduction card (clay-free, accent-bordered), never inline TempaNote treatment', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" showComposerIntro />)
    expect(html).toMatch(/rounded-lg border border-accent\/20/)
  })
})
