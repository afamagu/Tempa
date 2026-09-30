import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const page = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const editor = readFileSync(path.join(__dirname, 'reading-language-editor.tsx'), 'utf8')
const picker = readFileSync(path.join(__dirname, '..', '..', 'reading-language-picker.tsx'), 'utf8')
const you = readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')

describe('You → Reading language', () => {
  it('sits under Your presence on the You page, beside Writing style', () => {
    const presence = you.slice(you.indexOf('Your presence'), you.indexOf('>Tempa<'))
    expect(presence).toContain('href="/you/reading-language"')
    expect(presence).toContain('<span>Reading language</span>')
  })

  it('uses Tempa’s compact system-voice copy, with no provider or locale jargon', () => {
    expect(page).toContain('Reading language')
    expect(page).toContain('Choose the language Tempa should use when you translate someone&rsquo;s writing.')
    expect(page).toContain('This does not change')
    for (const source of [page, editor, picker]) {
      const visibleCopy = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(visibleCopy).not.toMatch(/azure|microsoft|\bAI\b|machine|locale|preferred locale/i)
    }
  })

  it('requires a signed-in member with a profile; not an onboarding step', () => {
    expect(page).toContain("redirect('/sign-in')")
    expect(page).toContain("redirect('/profile')")
    const proxy = readFileSync(path.join(__dirname, '..', '..', '..', 'proxy.ts'), 'utf8')
    expect(proxy).not.toContain('reading-language')
  })

  it('a read failure never renders as "not chosen"', () => {
    expect(page).toContain('preference.ok ?')
    expect(page).toContain('Could not load your reading language right now.')
  })

  it('the picker is searchable, flag-free, and never saves the browser suggestion by itself', () => {
    expect(picker).toContain('type="search"')
    const pickerCode = picker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(pickerCode).not.toMatch(/flag|emoji|country/i)
    // The suggestion only highlights an option; selecting still requires a tap.
    expect(picker).toContain('setSuggested(code)')
    expect(picker).not.toMatch(/setSuggested[\s\S]{0,80}onSelect\(/)
    expect(picker).not.toMatch(/localStorage|sessionStorage|document\.cookie/)
  })
})
