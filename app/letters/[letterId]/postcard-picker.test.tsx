import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import PostcardPicker from './postcard-picker'
import { POSTCARD_CATALOG } from '@/lib/moments'

// PostcardPicker already iterates Object.entries(POSTCARD_CATALOG)
// generically (see its own source) — adding a second catalog card
// requires zero picker changes. These tests prove that generic behavior
// actually holds now that a second real card exists, rather than
// assuming it from reading the source.
describe('PostcardPicker — Featured section lists every current catalog card', () => {
  it('H. Bangkok is available through the current picker', () => {
    const html = renderToStaticMarkup(<PostcardPicker onSelect={() => {}} onCancel={() => {}} />)
    expect(html).toContain('Bangkok')
    expect(html).toContain(POSTCARD_CATALOG.bangkokAfterRain.frontImagePath)
  })

  it('I. Essaouira is still included alongside Bangkok', () => {
    const html = renderToStaticMarkup(<PostcardPicker onSelect={() => {}} onCancel={() => {}} />)
    expect(html).toContain('Essaouira')
    expect(html).toContain(POSTCARD_CATALOG.essaouira.frontImagePath)
  })

  it('renders exactly two Featured cards, one per current catalog entry, no redesign of the picker itself', () => {
    const html = renderToStaticMarkup(<PostcardPicker onSelect={() => {}} onCancel={() => {}} />)
    // Same PostcardCard button markup for both — one truncated title span
    // per catalog entry.
    const cardCount = (html.match(/text-\[12px\] font-medium text-foreground/g) ?? []).length
    expect(cardCount).toBe(2)
    // The section architecture (Featured/My Postcards/Places/Collections)
    // is unchanged — still present, still just placeholders elsewhere.
    expect(html).toContain('Featured')
    expect(html).toContain('My Postcards')
  })

  it('selecting a card still calls onSelect with that card\'s exact catalog key', () => {
    // Can't simulate a real click via renderToStaticMarkup (no jsdom) —
    // this confirms the wiring is still key-based, generically, by
    // reading the component's own source rather than guessing.
    const source = readFileSync(path.join(__dirname, 'postcard-picker.tsx'), 'utf8')
    expect(source).toContain('onSelect={() => onSelect(key)}')
  })
})
