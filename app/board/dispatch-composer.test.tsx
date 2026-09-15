import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DispatchComposer from './dispatch-composer'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

// Same structural limitation accepted for every other Tiptap composer
// in this codebase (see moments-composer.test.tsx, first-letter-
// composer.test.tsx): immediatelyRender: false means the editor
// instance doesn't exist on this first render, so this only proves the
// safe pre-mount state — live typing needs a real browser.
describe('DispatchComposer — initial render (editor not yet mounted)', () => {
  it('renders without crashing, starts with Publish disabled, and uses the required button label', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).toContain('Publish Dispatch')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Publish Dispatch<\/button>/)
  })

  it('never uses any other composer\'s button vocabulary', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).not.toContain('Send letter')
    expect(html).not.toContain('Save answer')
    expect(html).not.toMatch(/>Post</)
    expect(html).not.toMatch(/>Submit</)
  })

  it('uses the exact required title placeholder', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).toContain('What is this about, in one line?')
  })

  it('the title input enforces the 70-character ceiling at the HTML level', () => {
    const html = renderToStaticMarkup(<DispatchComposer authorId="author-1" />)
    expect(html).toMatch(/maxLength="70"/)
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

  it('uses "Save changes", never "Publish Dispatch", and starts disabled until a real edit is made', () => {
    const html = renderToStaticMarkup(
      <DispatchComposer authorId="author-1" mode="edit" existingDispatch={existingDispatch} />
    )
    expect(html).toContain('Save changes')
    expect(html).not.toContain('Publish Dispatch')
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
