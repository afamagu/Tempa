import { describe, it, expect, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import BlockButton, { resolvePostBlockNavigation } from './block-button'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, replace: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

// Same SSR-only convention as RemoveFromLetterbox — the confirmation
// step is internal useState, not exercisable via renderToStaticMarkup;
// this proves the default (unconfirmed) shape and the exact locked
// copy, per Safety & Trust Checkpoint 1B.
describe('BlockButton — default shape, no confirmation until activated', () => {
  it('renders a plain trigger naming the person, no confirmation copy yet', () => {
    const html = renderToStaticMarkup(
      <BlockButton blockedId="user-1" blockedPseudonym="Evening Quill" triggerClassName="item" />
    )
    expect(html).toContain('Block Evening Quill')
    expect(html).not.toContain('neither of you will be able to write')
    expect(html).not.toContain('Cancel')
  })

  it('never notifies or references the blocked member being told anything — no "notify" wording anywhere', () => {
    const html = renderToStaticMarkup(
      <BlockButton blockedId="user-1" blockedPseudonym="Evening Quill" triggerClassName="item" />
    )
    expect(html.toLowerCase()).not.toContain('notify')
    expect(html.toLowerCase()).not.toContain('they will be told')
  })

  it('never shows a block count or "blocked by" language', () => {
    const html = renderToStaticMarkup(
      <BlockButton blockedId="user-1" blockedPseudonym="Evening Quill" triggerClassName="item" />
    )
    expect(html.toLowerCase()).not.toContain('blocked by')
    expect(html).not.toMatch(/\d+\s*block/i)
  })
})

// Checkpoint 1C — two levels of blocking. initialScope drives which of
// the three states renders; the "choosing" (post-click) state itself
// relies on internal useState and isn't reachable via
// renderToStaticMarkup, so it isn't covered here (same SSR-only
// limitation noted above) — its exact copy is instead verified as a
// pair of string constants directly.
describe('BlockButton — scoped states (Checkpoint 1C)', () => {
  it('a "letters" initialScope shows the letters-stopped state with both a restore and an escalate action, no window.confirm', () => {
    const html = renderToStaticMarkup(
      <BlockButton blockedId="user-1" blockedPseudonym="Evening Quill" triggerClassName="item" initialScope="letters" />
    )
    expect(html).toContain('Letters are stopped with Evening Quill.')
    expect(html).toContain('Restore letters')
    expect(html).toContain('Block everywhere')
  })

  it('a "full" initialScope shows the full-block state with only an Unblock action', () => {
    const html = renderToStaticMarkup(
      <BlockButton blockedId="user-1" blockedPseudonym="Evening Quill" triggerClassName="item" initialScope="full" />
    )
    expect(html).toContain('Evening Quill is blocked everywhere.')
    expect(html).toContain('Unblock')
    expect(html).not.toContain('Restore letters')
  })

  it('never calls window.confirm anywhere in the component source (only mentioned in a doc comment explaining why not)', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./block-button.tsx', import.meta.url), 'utf8'))
    // The doc comment references the literal, argument-less
    // "window.confirm()" to explain why it's NOT used — an actual call
    // site always passes a message string, so requiring an opening
    // quote after "(" distinguishes a real call from that mention.
    expect(source).not.toMatch(/window\.confirm\(\s*['"`]/)
  })

  // The "choosing" panel (post-click, before a scope is picked) relies
  // on internal useState and isn't reachable via renderToStaticMarkup —
  // verified here as exact source text instead, since the checkpoint
  // locks this copy word-for-word.
  it('carries the exact locked copy for both block-choice options', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./block-button.tsx', import.meta.url), 'utf8'))
    expect(source).toContain(
      "Neither of you will be able to start or continue letters while this is active. You can still see each other’s public writing on TEMPA. Mail already on the way will still arrive."
    )
    expect(source).toContain(
      "You won’t be shown to each other across TEMPA, and neither of you will be able to write to the other. Existing letters remain in your Letterbox unless you remove them."
    )
  })
})

// Live-test correction (2026-09-13): a real full block from the public
// profile succeeded in the database, then the app immediately
// router.refresh()'d the current (now-invisible-to-this-viewer)
// /minds/[userId] route, which correctly resolved to a Next.js 404 —
// a successful action reading as a broken one. resolvePostBlockNavigation
// is the pure decision this fix hinges on: it's exercised directly here
// (no DOM needed, matching canWriteToMind's own extracted-pure-function
// pattern in app/minds/[userId]/page.tsx) rather than through a
// simulated click, per this codebase's renderToStaticMarkup-only/no-jsdom
// testing convention (see share-dispatch-button.test.tsx's own note).
describe('resolvePostBlockNavigation — post-full-block navigation (live-test regression fix)', () => {
  it('A. "letters" never redirects, even when a fullBlockRedirect is configured for this call site — a letters-only block never affects page visibility', () => {
    expect(resolvePostBlockNavigation('letters', '/minds')).toEqual({ kind: 'refresh' })
  })

  it('A. "full" with a fullBlockRedirect configured replaces navigation to that path — the public-profile call site', () => {
    expect(resolvePostBlockNavigation('full', '/minds')).toEqual({ kind: 'replace', path: '/minds' })
  })

  it('B. "full" with NO fullBlockRedirect configured just refreshes in place — the existing-letter call site, where the page remains a valid historical record', () => {
    expect(resolvePostBlockNavigation('full', undefined)).toEqual({ kind: 'refresh' })
  })
})

describe('BlockButton source — failed blockUser never reaches navigation (Checkpoint 1C test category C)', () => {
  it('handleChoose returns immediately on a blockError, before computing or acting on any post-block navigation', async () => {
    const source = await readFile(new URL('./block-button.tsx', import.meta.url), 'utf8')
    const handleChooseStart = source.indexOf('async function handleChoose')
    const handleChooseEnd = source.indexOf('\n  }', source.indexOf('resolvePostBlockNavigation', handleChooseStart))
    const body = source.slice(handleChooseStart, handleChooseEnd)

    const errorCheckIndex = body.indexOf('if (blockError)')
    const navigationCallIndex = body.indexOf('resolvePostBlockNavigation(')
    expect(errorCheckIndex).toBeGreaterThan(-1)
    expect(navigationCallIndex).toBeGreaterThan(-1)
    expect(errorCheckIndex).toBeLessThan(navigationCallIndex)

    // The blockError branch itself must return before falling through
    // to the navigation logic.
    const errorBranch = body.slice(errorCheckIndex, navigationCallIndex)
    expect(errorBranch).toMatch(/if \(blockError\) \{\s*setError\([^)]*\)\s*return\s*\}/)
  })
})

// Call-site wiring — proves the ONE place that should redirect after a
// full block actually does, and the one place that must not (never
// guessed from pathname; an explicit prop per the component's own doc
// comment).
describe('BlockButton call-site wiring — fullBlockRedirect', () => {
  it('the public profile page passes fullBlockRedirect="/minds" (its own route becomes invalid after a full block)', async () => {
    const source = await readFile(new URL('./minds/[userId]/page.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/<BlockButton[\s\S]*?fullBlockRedirect="\/minds"[\s\S]*?\/>/)
  })

  it('the existing-letter action menu does NOT pass fullBlockRedirect — the historical letter page stays valid regardless of block scope', async () => {
    const source = await readFile(new URL('./letters/[letterId]/letter-action-menu.tsx', import.meta.url), 'utf8')
    const blockButtonCall = source.slice(source.indexOf('<BlockButton'), source.indexOf('/>', source.indexOf('<BlockButton')) + 2)
    expect(blockButtonCall).not.toContain('fullBlockRedirect')
  })
})
