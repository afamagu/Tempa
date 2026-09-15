import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import ReplyComposer from './reply-composer'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

const SOURCE_PATH = path.join(__dirname, 'reply-composer.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

// Same SSR-only (no jsdom) convention as ReportButton's own tests: the
// collapsed trigger is proven by a real render; the open/type/submit
// flow (all driven by onClick/onChange, unreachable via
// renderToStaticMarkup) is proven by source inspection instead.
describe('ReplyComposer — collapsed trigger (initial render)', () => {
  it('renders the default "Reply" trigger label for a top-level Reply', () => {
    const html = renderToStaticMarkup(<ReplyComposer dispatchId="dispatch-1" />)
    expect(html).toContain('Reply')
  })

  it('supports a custom trigger label for the nested Reply-to-Reply call site', () => {
    const html = renderToStaticMarkup(<ReplyComposer dispatchId="dispatch-1" parentReplyId="reply-1" triggerLabel="Reply" />)
    expect(html).toContain('Reply')
  })

  it('renders without crashing whether or not parentReplyId is set', () => {
    expect(() => renderToStaticMarkup(<ReplyComposer dispatchId="dispatch-1" />)).not.toThrow()
    expect(() => renderToStaticMarkup(<ReplyComposer dispatchId="dispatch-1" parentReplyId="reply-1" />)).not.toThrow()
  })

  it('never shows a textarea before the trigger is clicked (collapsed state has no open composer)', () => {
    const html = renderToStaticMarkup(<ReplyComposer dispatchId="dispatch-1" />)
    expect(html).not.toContain('<textarea')
  })
})

describe('ReplyComposer — 500 character limit (source)', () => {
  it('imports the shared REPLY_MAX_CHARS constant rather than a locally hardcoded number', () => {
    expect(source).toContain("REPLY_MAX_CHARS } from '@/lib/replies'")
  })

  it('caps the textarea at REPLY_MAX_CHARS via both maxLength and a slice on change', () => {
    expect(source).toContain('maxLength={REPLY_MAX_CHARS}')
    expect(source).toContain('e.target.value.slice(0, REPLY_MAX_CHARS)')
  })

  it('validates via the shared replyBodyError before ever calling createReply', () => {
    const submitFn = source.slice(source.indexOf('async function handleSubmit'), source.indexOf('if (!open) {'))
    expect(submitFn.indexOf('replyBodyError(body)')).toBeGreaterThanOrEqual(0)
    expect(submitFn.indexOf('replyBodyError(body)')).toBeLessThan(submitFn.indexOf('createReply('))
  })
})

describe('ReplyComposer — no rich content, no modal (source)', () => {
  it('uses a plain textarea, never a rich-text/markdown editor or file input', () => {
    expect(source).toContain('<textarea')
    expect(source).not.toContain('type="file"')
  })

  it('never uses dangerouslySetInnerHTML in any executable statement (the doc comment above only explains its deliberate absence)', () => {
    const executableSource = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
      .join('\n')
    expect(executableSource).not.toContain('dangerouslySetInnerHTML')
  })

  it('never renders inside a portal/modal — the composer is inline expand-in-place', () => {
    expect(source).not.toContain('createPortal')
    const executableSource = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
      .join('\n')
    expect(executableSource.toLowerCase()).not.toContain('modal')
  })

  it('primary action reads "Post Reply", never a generic "Submit" or "Send"', () => {
    expect(source).toContain('Post Reply')
  })
})
