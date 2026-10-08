import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DRAFT_PERSISTENCE_WARNING } from './draft-persistence-warning'

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8')

describe('draft persistence failure messaging', () => {
  it('uses one restrained warning instead of a noisy autosave badge', () => {
    expect(DRAFT_PERSISTENCE_WARNING).toBe(
      'This browser can’t save this draft right now. Keep this page open until you finish.'
    )
  })

  it.each([
    'app/write/[recipientId]/first-letter-composer.tsx',
    'app/letters/[letterId]/first-contact-response.tsx',
    'app/letters/[letterId]/moments-composer.tsx',
    'app/board/dispatch-composer.tsx',
    'app/question/question-answer.tsx',
  ])('%s wires an actual failed local write to the shared warning', (file) => {
    const source = read(file)
    expect(source).toContain('draftStorageFailed')
    expect(source).toContain('setDraftStorageFailed(true)')
    expect(source).toContain('<DraftPersistenceWarning />')
  })
})
