import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
describe('private letters never offer public correspondent tagging', () => {
  for (const path of ['app/write/[recipientId]/first-letter-composer.tsx','app/letters/[letterId]/first-contact-response.tsx','app/letters/[letterId]/moments-composer.tsx','app/letters/[letterId]/postcard-editor.tsx','app/letters/postcard-object.tsx']) {
    it(path, () => expect(readFileSync(path,'utf8')).not.toContain('CorrespondentPicker'))
  }
})
