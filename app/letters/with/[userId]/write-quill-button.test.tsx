// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import WriteQuillButton from './write-quill-button'
import { quillReplyToId, resolveReplyToId } from '@/lib/letters'

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

// The visible label beside the quill names the action in context. The
// three reader contexts are driven through the SAME quillReplyToId the
// single-letter page uses, so the label can never disagree with href.
function mount(props: Parameters<typeof WriteQuillButton>[0]) {
  document.body.innerHTML = renderToStaticMarkup(<WriteQuillButton {...props} />)
  const links = document.querySelectorAll('a')
  expect(links).toHaveLength(1)
  return links[0]
}

const CORRESPONDENCE = 'corr-me-mia'

describe('WriteQuillButton — contextual visible label', () => {
  it('archive (no letter open): "Write to Mia", fresh Write Anytime', () => {
    const link = mount({ otherUserId: MIA, otherPseudonym: 'Mia' })
    expect(link.textContent).toBe('Write to Mia')
    expect(link.getAttribute('aria-label')).toBe('Write to Mia')
    expect(link.getAttribute('href')).toBe(`/letters/with/${MIA}/write`)
  })

  it('incoming letter from Mia: "Reply to this letter", replying to that exact letter', () => {
    const replyToId = quillReplyToId({ id: LETTER, recipientId: ME }, ME)
    const link = mount({ otherUserId: MIA, otherPseudonym: 'Mia', replyToId })
    expect(link.textContent).toBe('Reply to this letter')
    expect(link.textContent).not.toContain('Mia')
    expect(link.getAttribute('aria-label')).toBe('Reply to this letter')
    expect(link.getAttribute('href')).toBe(`/letters/with/${MIA}/write?replyTo=${LETTER}`)

    // The composer resolves that ?replyTo= back to the same letter —
    // which is the id its "View Mia's letter" source panel opens.
    const requested = new URL(link.getAttribute('href')!, 'https://tempa.test').searchParams.get('replyTo')
    expect(resolveReplyToId(requested, { id: LETTER, correspondenceId: CORRESPONDENCE }, CORRESPONDENCE)).toBe(LETTER)
  })

  it('own sent letter to Mia: "Write to Mia", never a reply to the viewer’s own letter', () => {
    const replyToId = quillReplyToId({ id: LETTER, recipientId: MIA }, ME)
    const link = mount({ otherUserId: MIA, otherPseudonym: 'Mia', replyToId })
    expect(link.textContent).toBe('Write to Mia')
    expect(link.textContent).not.toContain('Reply')
    expect(link.getAttribute('aria-label')).toBe('Write to Mia')
    expect(link.getAttribute('href')).toBe(`/letters/with/${MIA}/write`)
    expect(link.getAttribute('href')).not.toContain(LETTER)
  })

  it('uses the real correspondent name, not a hardcoded one', () => {
    expect(mount({ otherUserId: 'user-x', otherPseudonym: 'Quiet Harbour' }).textContent).toBe('Write to Quiet Harbour')
  })

  it('label pill and quill are one control: both inside the single link, no nested interactive element', () => {
    const link = mount({ otherUserId: MIA, otherPseudonym: 'Mia', replyToId: LETTER })
    const [pill, quill] = Array.from(link.children)
    expect(pill.textContent).toBe('Reply to this letter')
    expect(quill.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    // Clicking either part resolves to this same anchor → same destination.
    expect(pill.closest('a')).toBe(link)
    expect(quill.closest('a')).toBe(link)
    expect(link.querySelector('a, button')).toBeNull()
  })

  it('long names truncate inside the pill rather than dropping the label or overflowing', () => {
    const name = 'A Very Long Pseudonym That Keeps Going Well Past Any Phone Width'
    const link = mount({ otherUserId: MIA, otherPseudonym: name })
    const [pill, quill] = Array.from(link.children)
    expect(pill.textContent).toBe(`Write to ${name}`)
    expect(pill.className).toMatch(/\btruncate\b/)
    expect(pill.className).toMatch(/\bmin-w-0\b/)
    expect(pill.className).toContain('max-w-[16rem]')
    expect(quill.className).toMatch(/\bshrink-0\b/)
    expect(link.className).toContain('max-w-[calc(100vw-2rem)]')
  })

  it('keeps the existing circular quill and its bottom-right placement above the mobile nav', () => {
    const link = mount({ otherUserId: MIA, otherPseudonym: 'Mia' })
    for (const c of ['fixed', 'bottom-20', 'right-4', 'z-40', 'sm:bottom-8', 'sm:right-8']) {
      expect(link.className.split(' ')).toContain(c)
    }
    const quill = link.children[1]
    for (const c of ['h-14', 'w-14', 'rounded-full', 'bg-accent', 'text-accent-foreground', 'shadow-lg']) {
      expect(quill.className.split(' ')).toContain(c)
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
