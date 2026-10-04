import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const page = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const editor = readFileSync(path.join(__dirname, 'rhythm-editor.tsx'), 'utf8')

describe('You → Correspondence', () => {
  it('reads the canonical caller rhythm RPC helper', () => {
    expect(page).toContain('getMyWritingRhythm(supabase)')
    expect(page).toContain('<RhythmEditor initialRhythm={rhythmState?.rhythm ?? null} />')
  })

  it('treats legacy NULL as unset rather than assigning a default', () => {
    expect(page).toContain('You have not chosen a rhythm yet.')
    expect(page).toContain('Tempa will not treat a gap in your replies as being beyond your usual pace.')
    expect(page).not.toMatch(/initialRhythm=\{['"](?:few_days|one_week|two_weeks|one_month)['"]\}/)
  })

  it('states that rhythm is not a deadline or score', () => {
    expect(page).toContain('It is not a deadline, a promise to reply on a particular day, or a score.')
  })

  it('saves through the canonical RPC helper and does not write profiles directly', () => {
    expect(editor).toContain('setMyWritingRhythm(supabase, selected)')
    expect(editor).not.toContain(".from('profiles')")
  })

  it('does not overwrite per-correspondence choices when the default changes', () => {
    expect(page).toContain('Changing your usual rhythm here does not overwrite those individual choices.')
  })
})
