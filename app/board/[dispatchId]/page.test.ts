import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const PAGE_PATH = path.join(__dirname, 'page.tsx')
const source = readFileSync(PAGE_PATH, 'utf8')
const executable = source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

function sourceBlock(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker)
  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(0)
  const end = text.indexOf(endMarker, start)
  expect(end, `missing end marker after ${startMarker}: ${endMarker}`).toBeGreaterThan(start)
  return text.slice(start, end)
}

describe('Dispatch detail page — Continue Reading shelf', () => {
  it('is absent when there are no continuation cards', () => {
    expect(source).toContain('{continueReadingCards.length > 0 && (')
  })

  it('appears after Replies and uses the shared BoardShelfCard primitive', () => {
    const replies = source.indexOf('<RepliesSection')
    const shelf = source.indexOf('{continueReadingCards.length > 0 && (')
    expect(replies).toBeGreaterThan(-1)
    expect(shelf).toBeGreaterThan(replies)

    const block = source.slice(shelf)
    expect(block).toContain('<BoardShelfCard')
    expect(block).toContain('size="continue"')
  })

  it('keeps the mobile scroll-snap and calm two-column desktop layout', () => {
    expect(source).toContain(
      'no-scrollbar mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:pb-0'
    )
    expect(source).toContain('w-[85%] shrink-0 snap-start sm:w-auto sm:shrink')
  })

  it('carries each continuation item through readingTrailSearchParams', () => {
    expect(source).toContain('nextTrailItems.map((item) => ({')
    expect(source).toContain('trailQuery: readingTrailSearchParams(')
    expect(source).toContain('{ sessionStartedAt: trailContext.sessionStartedAt, seed: trailContext.seed },')
  })

  it('labels the shelf Read next', () => {
    expect(source).toContain('sectionLabelClass}>Read next')
  })
})

describe('Dispatch detail page — correspondence entry point', () => {
  const actionRowMarker = '<div className="flex items-center justify-between gap-3">'
  const actionRowEndMarker = '<div className="border-t border-foreground/10" />'

  function actionRow(text = source) {
    return sourceBlock(text, actionRowMarker, actionRowEndMarker)
  }

  it('reuses the existing structural correspondence predicate rather than creating a separate Dispatch rule', () => {
    expect(source).toContain("import { canWriteToMind } from '@/app/minds/[userId]/page'")
    expect(source).not.toMatch(/function\s+canWriteToMind/)
    expect(source).toContain('canWriteToMind({')
  })

  it('adds the canonical relationship-capacity read instead of calculating capacity locally', () => {
    expect(source).toContain("from '@/lib/relationship-capacity'")
    expect(source).toContain('getRelationshipCapacity(supabase)')
    expect(source).toContain('newCorrespondenceUnavailableMessage(relationshipCapacity)')
    expect(source).not.toMatch(/establishedCount\s*[+\-*/]/)
  })

  it('does not fetch private-entry state for the author or non-member Dispatches', () => {
    expect(source).toContain('isAuthor || !isMemberDispatch ? Promise.resolve([]) : getMyAnswers(supabase, dispatch.authorId)')
    expect(source).toContain('isAuthor || !isMemberDispatch ? Promise.resolve(null) : getRelationshipCapacity(supabase)')
  })

  it('never offers self-correspondence', () => {
    expect(source).toContain('isSelf: isAuthor,')
    expect(source).toContain('{!isAuthor && (')
  })

  it('routes a fresh eligible person into the existing private-write flow', () => {
    expect(source).toContain('href={`/write/${dispatch.authorId}?a=${authorPrimaryAnswer.id}&source=dispatch`}')
  })

  it('opens existing correspondence instead of offering another first letter', () => {
    expect(source).toContain('<Link href="/letters" className={quietLinkClass}>')
    expect(source).toContain('Open your correspondence')
  })

  it('routes an existing first-contact episode to that letter instead of creating a crossed episode', () => {
    expect(source).toContain('getFirstContact(supabase, user.id, dispatch.authorId)')
    expect(source).toContain('getFirstContact(supabase, dispatch.authorId, user.id)')
    expect(source).toContain('href={`/letters/${pendingFirstContact.id}`}')
    expect(source).toContain('View your letter with {dispatch.authorPseudonym}')
  })

  it('uses person language and never exposes the retired mind terminology', () => {
    expect(source).toContain('Write to {dispatch.authorPseudonym}')
    expect(executable).not.toContain('Write to this mind')
  })

  it('shows a quiet capacity explanation rather than a dead-end write action when the circle is unavailable', () => {
    const block = actionRow(executable)
    expect(block).toContain('newCorrespondenceMessage')
    expect(block).toContain('helperTextClass')
    expect(block).not.toContain('primaryButtonClass')
    expect(block).not.toContain('secondaryButtonClass')
  })

  it('keeps Worth Reading and the private action in the same restrained row', () => {
    const block = actionRow()
    expect(block.indexOf('<WorthReadingButton')).toBeGreaterThanOrEqual(0)
    expect(block).toContain('text-right')
    expect(block).toContain('quietLinkClass')
    expect(block).not.toContain('flex-wrap')
  })

  it('keeps Replies outside and after the action row', () => {
    const rowStart = source.indexOf(actionRowMarker)
    const rowEnd = source.indexOf(actionRowEndMarker, rowStart)
    const replies = source.indexOf('<RepliesSection', rowEnd)
    expect(rowEnd).toBeGreaterThan(rowStart)
    expect(replies).toBeGreaterThan(rowEnd)
  })

  it('does not introduce popularity or relationship classification labels', () => {
    const block = actionRow(executable).toLowerCase()
    expect(block).not.toMatch(/\bfollow(ing|er)?\b/)
    expect(block).not.toContain('reaction')
    expect(block).not.toMatch(/\bcount\b/)
    expect(block).not.toMatch(/correspondent/i)
  })
})

describe('Dispatch detail page — attached Postcard', () => {
  it('fetches the Postcard alongside the Dispatch view data', () => {
    expect(source).toContain('getDispatchPostcard(supabase, dispatch.id)')
  })

  it('renders an attached Postcard only when one exists', () => {
    expect(source).toContain('{postcard && (')
    expect(source).toContain('<LetterheadPostcard')
    expect(source).toContain('dispatchPostcardToBaseContent(postcard.version)')
  })

  it('places the attached Postcard above the Dispatch reader', () => {
    const postcard = source.indexOf('{postcard && (')
    const reader = source.indexOf('<DispatchReader')
    expect(postcard).toBeGreaterThan(-1)
    expect(reader).toBeGreaterThan(postcard)
  })
})
