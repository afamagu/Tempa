import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SOURCE_PATH = path.join(__dirname, 'photo-moment-node.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

// This file's own doc comments legitimately mention "localStorage" in
// prose (explaining the session-hydration race this checkpoint fixes) —
// stripped before the negative-assertion scan below so that prose,
// never actual code, is what's being checked for.
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}
const codeOnly = stripComments(source)

// Live-repair checkpoint (2026-09-08), second pass — this NodeView's
// restore effect only ever fires inside a real Tiptap/ProseMirror editor
// instance mounted in a DOM, which this project's Vitest environment
// deliberately doesn't provide (see every other *.test.tsx in this
// directory). The actual async resolution/retry/backoff LOGIC is now
// extracted into lib/resolve-restored-photo.ts and tested directly there
// (lib/resolve-restored-photo.test.ts), with a real injected fake
// resolver and a real injected fake clock — never source-text inspection
// for that part. What's left to pin here is this file's own CONTRACT:
// that it delegates to that one shared retry function rather than
// reimplementing its own loop, that a failure is always logged, that a
// failed photo is genuinely user-recoverable (not just auto-retried),
// and that persistence is never touched from here.
describe('PhotoMomentView — restore contract (source-level, see doc comment)', () => {
  it('delegates to the one shared retry/backoff function — never a second, ad-hoc resolution loop of its own', () => {
    expect(source).toContain("import { resolveRestoredPhotoWithRetries } from '@/lib/resolve-restored-photo'")
    expect(source).toContain(
      'resolveRestoredPhotoWithRetries(imagePath, (path) => resolveLetterPhotoUrl(supabase, path)'
    )
    expect(source).not.toContain('.createSignedUrl(')
    expect(source).not.toContain('window.setTimeout')
  })

  it('a failure is never silently discarded — every exhausted attempt is logged', () => {
    expect(source).toContain(
      "console.error('[moments] could not resolve a restored photo Moment after retries'"
    )
  })

  it('Part I-D — a failed photo is genuinely user-recoverable: a real button, a distinct retry handler, and a state reset that re-arms the resolution effect', () => {
    expect(source).toContain('function handleRetry()')
    expect(source).toContain('setResolveFailed(false)')
    expect(source).toContain('setRetryToken((n) => n + 1)')
    expect(source).toContain('aria-label="Retry loading this photo"')
    // The retry token must actually be part of the effect's own
    // dependency array, or clicking retry would never re-run it.
    expect(source).toContain('}, [imagePath, previewUrl, retryToken])')
  })

  it('cancellation is tracked so a stale async result from a torn-down attempt is never applied', () => {
    expect(source).toContain('cancelledRef.current = true')
    expect(source).toContain("if (result.status === 'cancelled') return")
  })

  it('a resolved URL is only ever placed in local node attrs via updateAttributes — never written to localStorage/draft persistence from here', () => {
    expect(source).toContain('updateAttributes({ previewUrl: result.url })')
    expect(codeOnly).not.toContain('localStorage')
    expect(codeOnly).not.toContain('writeLetterEditorDraft')
  })

  it('shows a restrained, non-alarming distinction once resolution has genuinely failed, with an explanatory tooltip — never a raw broken-image glyph', () => {
    expect(source).toContain('bg-red-600/10')
    expect(source).toContain('still attached and will still send')
  })

  it('the remove control remains present regardless of resolve state', () => {
    expect(source).toContain('aria-label="Remove this photo"')
  })
})
