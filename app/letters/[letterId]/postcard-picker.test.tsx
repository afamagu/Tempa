import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import PostcardPicker from './postcard-picker'
import type { PostcardCatalogEntry } from '@/lib/postcards'

const ESSAOUIRA: PostcardCatalogEntry = {
  key: 'essaouira',
  title: 'Essaouira',
  countryCode: 'MA',
  location: 'Atlantic Morocco',
  collection: 'Atlantic Morocco Collection',
  postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
  footerText: 'Tempa Postcard · Atlantic Morocco Collection',
  frontImagePath: '/postcards/essaouira.jpg',
  motionSrc: '/postcards/essaouira-living.mp4',
  durationSeconds: 10.04,
  revealLineAlignment: null,
}

const BANGKOK: PostcardCatalogEntry = {
  key: 'bangkokAfterRain',
  title: 'Bangkok',
  countryCode: 'TH',
  location: 'Thailand after rain',
  collection: 'Thailand After Rain Collection',
  postmarkText: 'BANGKOK\nTHAILAND',
  footerText: 'Tempa Postcard · Thailand After Rain Collection',
  frontImagePath: '/postcards/bangkok-after-rain.jpg',
  motionSrc: '/postcards/bangkok-after-rain-living.mp4',
  durationSeconds: 10.04,
  revealLineAlignment: null,
}

const SOURCE_PATH = path.join(__dirname, 'postcard-picker.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

// Release Polish Pass — the picker no longer iterates a hard-coded
// TypeScript catalog and no longer shows Featured/My Postcards/Places/
// Collections roadmap sections; it renders whatever the caller
// (moments-composer.tsx, from lib/postcards.ts's getActivePostcards)
// passes in as `postcards`, filtered by its own restrained search.
describe('PostcardPicker — an honest catalogue, no roadmap placeholders', () => {
  it('renders a card for each entry in the active catalogue it receives', () => {
    const html = renderToStaticMarkup(
      <PostcardPicker postcards={[ESSAOUIRA, BANGKOK]} onSelect={() => {}} onCancel={() => {}} />
    )
    expect(html).toContain('Bangkok')
    expect(html).toContain(BANGKOK.frontImagePath)
    expect(html).toContain('Essaouira')
    expect(html).toContain(ESSAOUIRA.frontImagePath)
  })

  it('never renders the retired Featured/My Postcards/Places/Collections sections', () => {
    const html = renderToStaticMarkup(
      <PostcardPicker postcards={[ESSAOUIRA, BANGKOK]} onSelect={() => {}} onCancel={() => {}} />
    )
    expect(html).not.toContain('Featured')
    expect(html).not.toContain('My Postcards')
    expect(html).not.toContain('Places')
    expect(html).not.toContain('Collections')
    expect(html).not.toContain("don't have any Postcards yet")
    expect(html).not.toContain('More coming soon')
  })

  it('carries a plain "Postcards" label instead', () => {
    const html = renderToStaticMarkup(
      <PostcardPicker postcards={[ESSAOUIRA, BANGKOK]} onSelect={() => {}} onCancel={() => {}} />
    )
    expect(html).toContain('Postcards')
  })

  it('does not expose the internal Living Reveal term on catalogue cards', () => {
    const html = renderToStaticMarkup(
      <PostcardPicker postcards={[ESSAOUIRA]} onSelect={() => {}} onCancel={() => {}} />
    )
    expect(html).not.toContain('Living')
  })

  it('shows an honest empty state when the active catalogue is empty (fetch still pending, or genuinely nothing active)', () => {
    const html = renderToStaticMarkup(<PostcardPicker postcards={[]} onSelect={() => {}} onCancel={() => {}} />)
    expect(html).toContain('No postcards available right now.')
  })

  it('renders no search field at all when the catalogue is empty — nothing to search yet', () => {
    const html = renderToStaticMarkup(<PostcardPicker postcards={[]} onSelect={() => {}} onCancel={() => {}} />)
    expect(html).not.toContain('aria-label="Search Postcards"')
  })

  it('a deactivated Postcard is simply absent — the caller only ever passes the active list', () => {
    const html = renderToStaticMarkup(
      <PostcardPicker postcards={[ESSAOUIRA]} onSelect={() => {}} onCancel={() => {}} />
    )
    expect(html).not.toContain('Bangkok')
  })

  it('selecting a card still calls onSelect with that card\'s exact catalog key', () => {
    // Can't simulate a real click via renderToStaticMarkup (no jsdom) —
    // this confirms the wiring is still key-based, generically, by
    // reading the component's own source rather than guessing.
    expect(source).toContain('onSelect={() => onSelect(postcard.key)}')
  })
})

describe('PostcardPicker — search field', () => {
  it('renders a restrained search field with the specified placeholder when the catalogue is non-empty', () => {
    const html = renderToStaticMarkup(
      <PostcardPicker postcards={[ESSAOUIRA, BANGKOK]} onSelect={() => {}} onCancel={() => {}} />
    )
    expect(html).toContain('placeholder="Search Postcards…"')
    expect(html).toContain('aria-label="Search Postcards"')
  })

  it('with an empty query, every Postcard renders — no filtering has happened yet', () => {
    const html = renderToStaticMarkup(
      <PostcardPicker postcards={[ESSAOUIRA, BANGKOK]} onSelect={() => {}} onCancel={() => {}} />
    )
    expect(html).toContain('Essaouira')
    expect(html).toContain('Bangkok')
  })

  it('filters via the shared filterPostcardCatalog helper, matching Admin\'s own search fields', () => {
    expect(source).toContain('filterPostcardCatalog(postcards, query)')
  })
})
