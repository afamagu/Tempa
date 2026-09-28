import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import WriteQuillButton from './write-quill-button'
import { quillReplyToId } from '@/lib/letters'

// The floating quill while reading an INCOMING letter replies to that
// exact letter (?replyTo=), which is what gives the composer its
// "View [name]'s letter" reference panel (SourceLetterPanel). The
// archive's quill, and the quill on the viewer's own sent letter, stay a
// fresh Write Anytime.

const ME = 'user-me'
const MIA = 'user-mia'
const LETTER = '11111111-2222-4333-8444-555555555555'
const read = (p: string) => readFileSync(path.resolve(import.meta.dirname, p), 'utf8')

describe('quillReplyToId', () => {
  it('an incoming letter is the source the quill replies to', () => {
    expect(quillReplyToId({ id: LETTER, recipientId: ME }, ME)).toBe(LETTER)
  })

  it('the viewer’s own sent letter is never treated as the letter being replied to', () => {
    expect(quillReplyToId({ id: LETTER, recipientId: MIA }, ME)).toBeNull()
  })
})

describe('WriteQuillButton', () => {
  it('from an incoming letter, links to the composer with that exact replyTo id', () => {
    const html = renderToStaticMarkup(<WriteQuillButton otherUserId={MIA} otherPseudonym="Mia" replyToId={LETTER} />)
    expect(html).toContain(`href="/letters/with/${MIA}/write?replyTo=${LETTER}"`)
  })

  it('without a reply id (archive / own sent letter), links to a fresh Write Anytime', () => {
    for (const html of [
      renderToStaticMarkup(<WriteQuillButton otherUserId={MIA} otherPseudonym="Mia" />),
      renderToStaticMarkup(<WriteQuillButton otherUserId={MIA} otherPseudonym="Mia" replyToId={null} />),
    ]) {
      expect(html).toContain(`href="/letters/with/${MIA}/write"`)
      expect(html).not.toContain('replyTo')
    }
  })
})

describe('call sites', () => {
  it('the single-letter reader passes the reply id only via quillReplyToId(target, viewer)', () => {
    const page = read('../../[letterId]/page.tsx')
    expect(page).toMatch(/<WriteQuillButton[\s\S]{0,200}replyToId=\{quillReplyToId\(target, user\.id\)\}/)
  })

  it('the person archive keeps a fresh Write Anytime (no reply id)', () => {
    const archive = read('./page.tsx')
    const call = archive.slice(archive.indexOf('<WriteQuillButton'), archive.indexOf('/>', archive.indexOf('<WriteQuillButton')))
    expect(call).not.toContain('replyToId')
  })

  it('the first-contact reply flow is untouched: the quill only shows for an established correspondence', () => {
    const page = read('../../[letterId]/page.tsx')
    expect(page).toContain('{showWriteQuill && (')
    expect(page).toContain('showFirstContactResponse')
  })
})
