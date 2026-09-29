// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import AuthoredProse from '@/app/authored-prose'
import LetterBody from '@/app/letters/[letterId]/letter-body'
import DispatchBody from '@/app/board/dispatch-body'
import DiscoveryResults, { type DiscoveryEntry } from '@/app/minds/discovery-results'
import ProfileAnswer from '@/app/minds/[userId]/profile-answer'
import ReadingModeControl from '@/app/reading-mode-control'
import WritingStyleChooser from '@/app/writing-style-chooser'
import { WRITING_STYLE_IDS, READER_VIEW_MIN_CHARS } from '@/lib/writing-style'
import { getLetterWritingStyles, getMemberWritingStyles } from '@/lib/writing-style-data'
import { POSTCARD_CATALOG, type Moment } from '@/lib/moments'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

const ROOT = path.join(__dirname, '..')
const src = (f: string) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')
const dom = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')

const LONG_LETTER = [
  'Dear Mia,',
  `Your letter arrived on a Tuesday. ${'It gave the week a shape. '.repeat(30)}`,
  `“Why write them down?” a friend asked. ${'I did not know then. '.repeat(30)}`,
  'With warmth,\nTomás',
].join('\n\n')

describe('AuthoredProse — the one gate for a member’s style', () => {
  it('renders a known style by its semantic id', () => {
    const d = dom(renderToStaticMarkup(<AuthoredProse styleId="ink"><p>Hi</p></AuthoredProse>))
    const el = d.querySelector('.authored-prose')!
    expect(el.getAttribute('data-writing-style')).toBe('ink')
    expect(el.getAttribute('style')).toContain('--wp-family:var(--font-kalam)')
  })

  it('null, invalid and hostile values render Tempa’s canonical prose and are never echoed', () => {
    for (const bad of [null, undefined, 'Kalam', 'ink;color:red', '"><script>']) {
      const html = renderToStaticMarkup(<AuthoredProse styleId={bad}><p>Hi</p></AuthoredProse>)
      const el = dom(html).querySelector('.authored-prose')!
      expect(el.getAttribute('data-writing-style')).toBe('tempa')
      expect(el.getAttribute('style')).toContain('--wp-family:var(--font-newsreader)')
      expect(html).not.toContain('color:red')
      expect(html).not.toContain('<script>')
    }
  })

  it('Reader view swaps only the typography — identical children', () => {
    const original = renderToStaticMarkup(<AuthoredProse styleId="freehand"><p>Same words.</p></AuthoredProse>)
    const reader = renderToStaticMarkup(<AuthoredProse styleId="freehand" mode="reader"><p>Same words.</p></AuthoredProse>)
    expect(dom(reader).querySelector('.authored-prose')!.getAttribute('data-writing-style')).toBe('tempa')
    expect(dom(original).querySelector('.authored-prose')!.innerHTML).toBe(dom(reader).querySelector('.authored-prose')!.innerHTML)
  })
})

describe('Letters — the snapshotted style, composed', () => {
  it('renders the letter in the style it was sent in, with greeting, opening and sign-off roles', () => {
    const d = dom(renderToStaticMarkup(<LetterBody body={LONG_LETTER} moments={[]} writingStyleId="correspondence" />))
    const prose = d.querySelector('.authored-prose')!
    expect(prose.getAttribute('data-writing-style')).toBe('correspondence')
    expect(prose.getAttribute('data-opening')).toBe('dropcap')
    const blocks = [...prose.querySelectorAll('.wp-block')]
    expect(blocks.map((b) => b.getAttribute('data-wp-role'))).toEqual(['salutation', 'opening', 'body', 'signoff'])
    // The opening treatment sits on "Your", never on the D of "Dear".
    expect(prose.querySelector('.wp-opening')!.textContent!.startsWith('Your letter')).toBe(true)
  })

  it('opening treatments add no duplicate text node (assistive technology reads each letter once)', () => {
    const html = renderToStaticMarkup(<LetterBody body={LONG_LETTER} moments={[]} writingStyleId="literary" />)
    expect(html.match(/Your letter arrived/g)).toHaveLength(1)
    expect(html).not.toMatch(/aria-hidden="true">Y</)
    expect(dom(html).body.textContent).toContain('Your letter arrived on a Tuesday.')
  })

  it('a letter sent before Writing Styles (no snapshot) keeps Tempa’s classic prose with no opening or Reader view', () => {
    const d = dom(renderToStaticMarkup(<LetterBody body={LONG_LETTER} moments={[]} />))
    expect(d.querySelector('.authored-prose')!.getAttribute('data-writing-style')).toBe('tempa')
    expect(d.querySelector('.authored-prose')!.getAttribute('data-opening')).toBe('none')
    expect(d.querySelector('[aria-label="Reading typography"]')).toBeNull()
  })

  it('offers Original · Reader view only on long styled letters, as keyboard-operable toggle buttons outside the prose', () => {
    const d = dom(renderToStaticMarkup(<LetterBody body={LONG_LETTER} moments={[]} writingStyleId="freehand" />))
    const control = d.querySelector('[role="group"][aria-label="Reading typography"]')!
    expect(control).not.toBeNull()
    expect(control.closest('.authored-prose')).toBeNull()
    const buttons = [...control.querySelectorAll('button')]
    expect(buttons.map((b) => [b.textContent, b.getAttribute('type'), b.getAttribute('aria-pressed')])).toEqual([
      ['Original', 'button', 'true'],
      ['Reader view', 'button', 'false'],
    ])
    const short = dom(renderToStaticMarkup(<LetterBody body="Short note." moments={[]} writingStyleId="freehand" />))
    expect(short.querySelector('[aria-label="Reading typography"]')).toBeNull()
    expect(LONG_LETTER.length).toBeGreaterThan(READER_VIEW_MIN_CHARS)
  })

  it('an inline historical Postcard keeps Tempa’s own postcard typography, never the writer’s style', () => {
    const moments: Moment[] = [{ id: 'm1', position: 1, type: 'postcard', imageUrl: null, postcardKey: Object.keys(POSTCARD_CATALOG)[0] }]
    const d = dom(renderToStaticMarkup(<LetterBody body={LONG_LETTER} moments={moments} writingStyleId="typewriter" />))
    const blocks = d.querySelectorAll('.wp-block')
    const postcardWrapper = blocks[1].querySelector(':scope > .wp-interface')
    expect(postcardWrapper).not.toBeNull()
  })

  it('a photo token among the words is interface, not prose', () => {
    const moments: Moment[] = [{ id: 'm1', position: 0, type: 'photo', imageUrl: 'https://example.test/p.jpg', postcardKey: null }]
    const d = dom(renderToStaticMarkup(<LetterBody body="Hello there." moments={moments} writingStyleId="ink" />))
    const token = d.querySelector('[aria-label="Open this photo"]')
    expect(token?.closest('.wp-interface')).not.toBeNull()
  })
})

describe('Dispatches — authored prose only', () => {
  it('renders the published style and keeps Moment controls in Tempa’s interface type', () => {
    const d = dom(
      renderToStaticMarkup(
        <DispatchBody
          body={'First paragraph of the Dispatch.\n\nSecond.'}
          moments={[{ id: 'd1', position: 0, imageUrl: 'https://example.test/x.jpg' } as never]}
          writingStyleId="notebook"
        />
      )
    )
    expect(d.querySelector('.authored-prose')!.getAttribute('data-writing-style')).toBe('notebook')
    expect(d.querySelector('.wp-opening')!.textContent).toContain('First paragraph')
    expect(d.querySelector('[aria-label="Open this photo"]')!.closest('.wp-interface')).not.toBeNull()
  })

  it('the Dispatch reader and composer pass the snapshot, never the author’s live style', () => {
    const page = src('app/board/[dispatchId]/page.tsx')
    expect(page).toContain('getDispatchWritingStyles(supabase, [dispatch.id])')
    expect(page).not.toContain('getMemberWritingStyles')
    // Titles, identity labels, dates and actions are untouched by the style.
    expect(src('app/board/dispatch-card.tsx')).toMatch(/<p className="text-\[16px\] font-medium text-foreground">\{dispatch\.title\}<\/p>/)
  })
})

const ENTRY: DiscoveryEntry = {
  userId: 'user-1',
  pseudonym: 'Evening Quill',
  country: 'South Africa',
  genderDisplay: 'Woman',
  ageRange: '25-34',
  markUrl: null,
  response: { id: 'a1', body: 'A short answer about ordinary things.', prompt: 'What matters?' },
  writingStyleId: 'typewriter',
}

describe('Profile & discovery — current style on the words only', () => {
  it('discovery cards style the response and nothing else, for all six styles, with no card-shape change', () => {
    const classesPerStyle = new Set<string>()
    for (const id of [...WRITING_STYLE_IDS, null]) {
      const d = dom(renderToStaticMarkup(<DiscoveryResults entries={[{ ...ENTRY, writingStyleId: id }]} />))
      const prose = d.querySelector('.authored-prose')!
      expect(prose.getAttribute('data-writing-style')).toBe(id ?? 'tempa')
      expect(prose.textContent).toBe(ENTRY.response.body)
      expect(prose.querySelector('.line-clamp-4')).not.toBeNull()
      // Pseudonym and identity line stay interface metadata.
      const name = [...d.querySelectorAll('p')].find((p) => p.textContent === 'Evening Quill')!
      expect(name.closest('.authored-prose')).toBeNull()
      classesPerStyle.add(d.querySelector('.rounded-md.border')!.getAttribute('class')!)
    }
    expect(classesPerStyle.size).toBe(1)
  })

  it('profile answers use the member’s current style; Read more stays interface', () => {
    const long = 'word '.repeat(120)
    const d = dom(renderToStaticMarkup(<ProfileAnswer id="a" prompt="Q?" body={long} showReport={false} writingStyleId="literary" />))
    expect(d.querySelector('.authored-prose')!.getAttribute('data-writing-style')).toBe('literary')
    const readMore = [...d.querySelectorAll('button')].find((b) => b.textContent === 'Read more')!
    expect(readMore.closest('.authored-prose')).toBeNull()
  })

  it('profile surfaces read the CURRENT style; letters read the SEND-TIME snapshot', () => {
    expect(src('app/minds/[userId]/page.tsx')).toContain('getMemberWritingStyles(supabase, [userId])')
    const letterPage = src('app/letters/[letterId]/page.tsx')
    expect(letterPage).toContain('getLetterWritingStyles(supabase, [target.id])')
    expect(letterPage).not.toContain('getMemberWritingStyles')
    expect(letterPage).not.toContain('getMyWritingStyle')
  })
})

describe('Postcards are separate', () => {
  it('postcard components never know about Writing Styles', () => {
    for (const f of ['app/letters/postcard-object.tsx', 'app/letters/letterhead-postcard.tsx', 'app/letters/moment-display.tsx']) {
      const s = src(f)
      expect(s).not.toMatch(/writing-?style|AuthoredProse|authored-prose/i)
    }
  })

  it('the letter page renders the letter-level Postcard outside the styled letter body', () => {
    const page = src('app/letters/[letterId]/page.tsx')
    expect(page.indexOf('<LetterheadPostcard')).toBeGreaterThan(-1)
    expect(page.indexOf('<LetterheadPostcard')).toBeLessThan(page.indexOf('<LetterReader'))
  })
})

describe('interface isolation (CSS)', () => {
  const css = src('app/globals.css')
  it('the style class is opt-in only and the interface boundary restores Geist', () => {
    expect(css).not.toMatch(/(^|\n)\s*(body|html)[^{]*\{[^}]*--wp-family/)
    const iface = css.slice(css.indexOf('.authored-prose .wp-interface {'))
    expect(iface.slice(0, iface.indexOf('}'))).toContain('font-family: var(--font-geist-sans)')
  })

  it('sizes are in px/em custom properties, so browser zoom scales everything', () => {
    expect(css).toContain('font-size: var(--wp-size-sm);')
    expect(css).not.toMatch(/\.authored-prose[^{]*\{[^}]*user-scalable/)
  })
})

describe('ReadingModeControl', () => {
  it('is two real buttons with pressed state', () => {
    const d = dom(renderToStaticMarkup(<ReadingModeControl mode="reader" onChange={() => {}} />))
    expect([...d.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  })
})

describe('WritingStyleChooser — six equal choices over the member’s own words', () => {
  const OWN = 'The kitchen at my grandmother’s house, where I learnt to be patient with bread.'

  it('shows all six styles as one native radio group, each carrying the member’s own words', () => {
    const d = dom(
      renderToStaticMarkup(
        <WritingStyleChooser mode="onboarding" heading="Give your words a shape." intro="Choose how your writing appears when it reaches someone." sample={OWN} sampleIsOwn destination="/minds" />
      )
    )
    const radios = [...d.querySelectorAll('input[type="radio"]')]
    expect(radios).toHaveLength(6)
    expect(new Set(radios.map((r) => r.getAttribute('name'))).size).toBe(1)
    expect(radios.map((r) => r.getAttribute('value'))).toEqual([...WRITING_STYLE_IDS])
    expect(radios.every((r) => !r.hasAttribute('checked'))).toBe(true)
    // Each option's accessible text is its name; the repeated excerpt is presentation.
    for (const r of radios) {
      const label = r.closest('label')!
      expect(label.querySelector('[aria-hidden="true"] .authored-prose')!.textContent).toContain('grandmother’s house')
    }
    expect([...d.querySelectorAll('.authored-prose')].map((e) => e.getAttribute('data-writing-style'))).toEqual([...WRITING_STYLE_IDS])
    expect(d.body.textContent).not.toMatch(/quick brown fox|lorem|font/i)
    expect(d.querySelector('fieldset legend')!.textContent).toBe('How your writing appears')
    const continueBtn = [...d.querySelectorAll('button')].find((b) => b.textContent === 'Continue')!
    expect(continueBtn.hasAttribute('disabled')).toBe(true)
  })

  it('settings mode starts from the current style and offers Save', () => {
    const d = dom(
      renderToStaticMarkup(
        <WritingStyleChooser mode="settings" heading="Your writing style" intro="…" sample={OWN} sampleIsOwn initialStyleId="literary" />
      )
    )
    expect(d.querySelector('input[value="literary"]')!.hasAttribute('checked')).toBe(true)
    expect([...d.querySelectorAll('button')].some((b) => b.textContent === 'Save')).toBe(true)
    expect(d.body.textContent).toContain('Preview · Literary')
  })

  it('never offers size, colour, spacing or custom-font controls', () => {
    const s = src('app/writing-style-chooser.tsx')
    expect(s).not.toMatch(/type="range"|type="color"|font-size slider|upload/i)
  })

  it('selection transitions respect reduced motion', () => {
    expect(src('app/writing-style-chooser.tsx')).toContain('motion-reduce:transition-none')
  })
})

describe('fail-soft data reads', () => {
  const rpc = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) }) as unknown as SupabaseClient

  it('snapshot lookups drop invalid ids and swallow errors', async () => {
    const map = await getLetterWritingStyles(
      rpc([
        { letter_id: 'l1', author_writing_style_id: 'ink' },
        { letter_id: 'l2', author_writing_style_id: 'comic-sans' },
      ]),
      ['l1', 'l2']
    )
    expect([...map]).toEqual([['l1', 'ink']])
    expect((await getLetterWritingStyles(rpc(null, { message: 'missing function' }), ['l1'])).size).toBe(0)
    expect((await getMemberWritingStyles(rpc(null, { message: 'x' }), ['u1'])).size).toBe(0)
    expect((await getMemberWritingStyles(rpc([]), [])).size).toBe(0)
  })
})
