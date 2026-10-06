import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const page = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const control = readFileSync(path.join(__dirname, 'private-memory-control.tsx'), 'utf8')

describe('Phase 13 Private Memory correspondence surface', () => {
  it('appears only after the lifecycle has been established', () => {
    expect(page).toContain('lifecycle?.establishedAt && (')
    expect(page).toContain('<PrivateMemoryControl')
  })

  it('uses the lifecycle correspondence id so a later episode starts clean', () => {
    expect(page).toContain('correspondenceId={lifecycle.correspondenceId}')
    expect(page).toContain('getCorrespondencePrivateMemory(supabase, lifecycle.correspondenceId)')
  })

  it('uses existing visible letter data for recent context instead of AI summaries', () => {
    expect(page).toContain('const latestLetter = letters[0] ?? null')
    expect(page).toContain('letterPreviewText(latestLetter.body)')
    expect(control).toContain('Recent letter')
    expect(control.toLowerCase()).not.toContain('ai summary')
  })

  it('states the privacy boundary directly', () => {
    expect(control).toContain('Only you can see this')
    expect(control).toContain('cannot see it')
  })

  it('keeps memory manual and editable', () => {
    expect(control).toContain('Add a private note')
    expect(control).toContain('Save private note')
    expect(control).toContain('Clear note')
    expect(control).toContain('maxLength={MAX_NOTE_LENGTH}')
  })
})
