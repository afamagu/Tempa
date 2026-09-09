import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PeopleGrid from './people-grid'
import type { LetterboxPerson } from '@/lib/letters'

function person(overrides: Partial<LetterboxPerson> = {}): LetterboxPerson {
  return {
    userId: 'user-1',
    pseudonym: 'Evening Quill',
    country: 'South Africa',
    ageRange: '25-34',
    activityAt: Date.now(),
    unreadCount: 0,
    latestExcerpt: 'A short excerpt of the most recent letter.',
    hasSentAny: false,
    ...overrides,
  }
}

describe('PeopleGrid — row content', () => {
  it('shows pseudonym and the latest visible excerpt', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[person()]} hasAnyPeopleAtAll filter="all" mailInTransitPersonIds={new Set()} />
    )
    expect(html).toContain('Evening Quill')
    expect(html).toContain('A short excerpt of the most recent letter.')
  })

  // Board usability visual follow-up (2026-09-09): every excerpt of
  // member-authored writing sits on the same bg-surface-shell surface
  // as the full letter/Dispatch/answer readers — identity/date/badges
  // stay on the ordinary card background.
  it('wraps the excerpt in the shared bg-surface-shell authored-paper surface', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[person()]} hasAnyPeopleAtAll filter="all" mailInTransitPersonIds={new Set()} />
    )
    expect(html).toMatch(/class="[^"]*bg-surface-shell[^"]*"[^>]*>[\s\S]*A short excerpt of the most recent letter\./)
  })

  it('the row itself links to the archive, never the public profile', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[person()]} hasAnyPeopleAtAll filter="all" mailInTransitPersonIds={new Set()} />
    )
    expect(html).toContain('href="/letters/with/user-1"')
    expect(html).not.toContain('href="/minds/user-1"')
  })
})

// Live-test regression: a card is a preview/navigation surface, never a
// reading surface — a long, multi-paragraph letter must not grow the
// card, and short/long letters must produce approximately the same
// card height.
describe('PeopleGrid — excerpt stays a preview, never an unrestricted body', () => {
  const longMultiParagraphBody =
    'This is the first paragraph of a fairly long letter, long enough on its own to wrap across more ' +
    'than two visual lines in a compact card, which is exactly the case this test exists for.\n\n' +
    'SECOND_PARAGRAPH_MARKER — this text must never appear on a Letterbox card, only in the full reader.\n\n' +
    'THIRD_PARAGRAPH_MARKER — same requirement.'

  it('receives the two-line CSS clamp, not single-line truncation', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ latestExcerpt: longMultiParagraphBody })]}
        hasAnyPeopleAtAll
        filter="all"
        mailInTransitPersonIds={new Set()}
      />
    )
    expect(html).toContain('line-clamp-2')
    // The old, buggy combination (`truncate` fighting `whitespace-pre-wrap`)
    // must be gone entirely — truncate is single-line only and conflicts
    // with preserving paragraph breaks.
    expect(html).not.toMatch(/class="[^"]*\btruncate\b[^"]*"[^>]*>[^<]*first paragraph/)
  })

  it('shows only the first paragraph — a long, multi-paragraph letter never renders as an unrestricted body', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ latestExcerpt: longMultiParagraphBody })]}
        hasAnyPeopleAtAll
        filter="all"
        mailInTransitPersonIds={new Set()}
      />
    )
    expect(html).toContain('first paragraph of a fairly long letter')
    expect(html).not.toContain('SECOND_PARAGRAPH_MARKER')
    expect(html).not.toContain('THIRD_PARAGRAPH_MARKER')
  })

  it('a short excerpt and a long one both render inside the same card structure — approximately consistent card height', () => {
    const shortHtml = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ userId: 'short', latestExcerpt: 'Hi!' })]}
        hasAnyPeopleAtAll
        filter="all"
        mailInTransitPersonIds={new Set()}
      />
    )
    const longHtml = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ userId: 'long', latestExcerpt: longMultiParagraphBody })]}
        hasAnyPeopleAtAll
        filter="all"
        mailInTransitPersonIds={new Set()}
      />
    )
    // Same excerpt-paragraph class on both — no special-cased "long body"
    // markup that could grow one card taller than the other.
    expect(shortHtml).toContain('line-clamp-2')
    expect(longHtml).toContain('line-clamp-2')
  })

  it('does not mutate the person object\'s own latestExcerpt while rendering the clamped preview', () => {
    const thePerson = person({ latestExcerpt: longMultiParagraphBody })
    renderToStaticMarkup(
      <PeopleGrid people={[thePerson]} hasAnyPeopleAtAll filter="all" mailInTransitPersonIds={new Set()} />
    )
    expect(thePerson.latestExcerpt).toBe(longMultiParagraphBody)
  })
})

describe('PeopleGrid — unread vs Mail on the way stay distinct', () => {
  it('unread badge and transit badge can both render for the same person without merging into one', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ unreadCount: 2 })]}
        hasAnyPeopleAtAll
        filter="all"
        mailInTransitPersonIds={new Set(['user-1'])}
      />
    )
    expect(html).toContain('2 unread letters')
    expect(html).toContain('Mail on the way')
  })

  it('a person with no unread and no transit mail shows neither badge', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[person()]} hasAnyPeopleAtAll filter="all" mailInTransitPersonIds={new Set()} />
    )
    expect(html).not.toContain('unread letter')
    expect(html).not.toContain('Mail on the way')
  })

  it('one person with mail in transit produces exactly one "Mail on the way" line, never one per travelling letter', () => {
    // PeopleGrid receives one row per PERSON already (getLetterboxPeople's
    // own per-person collapse) — this proves rendering that one row with
    // the person present in mailInTransitPersonIds never duplicates the
    // system-message line regardless of how many letters are actually in
    // transit.
    const html = renderToStaticMarkup(
      <PeopleGrid people={[person()]} hasAnyPeopleAtAll filter="all" mailInTransitPersonIds={new Set(['user-1'])} />
    )
    expect((html.match(/Mail on the way/g) ?? []).length).toBe(1)
  })

  it('the Mail-on-the-way line is a distinct system-voice element from the excerpt paragraph, not merged into it', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ latestExcerpt: 'A short excerpt of the most recent letter.' })]}
        hasAnyPeopleAtAll
        filter="all"
        mailInTransitPersonIds={new Set(['user-1'])}
      />
    )
    // The excerpt keeps its own serif preview styling; the system line is
    // a separate element carrying the sans SystemMessage markup.
    expect(html).toContain('A short excerpt of the most recent letter.')
    expect(html).toContain('Mail on the way')
    expect(html).not.toMatch(/A short excerpt of the most recent letter\.[^<]*Mail on the way/)
  })
})

describe('PeopleGrid — empty states', () => {
  it('no correspondents at all: address-book empty state', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[]} hasAnyPeopleAtAll={false} filter="all" mailInTransitPersonIds={new Set()} />
    )
    expect(html).toContain("don&#x27;t have any letters yet")
  })

  it('New filter with nothing new: distinct, calm copy — never "Inbox zero"', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[]} hasAnyPeopleAtAll filter="new" mailInTransitPersonIds={new Set()} />
    )
    expect(html).toContain('Nothing new right now.')
    expect(html.toLowerCase()).not.toContain('inbox zero')
  })

  it('Sent filter with nothing sent: distinct, correspondence-language copy', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[]} hasAnyPeopleAtAll filter="sent" mailInTransitPersonIds={new Set()} />
    )
    expect(html).toContain("haven&#x27;t sent a letter yet")
  })
})
