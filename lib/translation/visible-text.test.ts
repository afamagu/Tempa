import { describe, expect, it } from 'vitest'
import { RICH_BODY_MARKER } from '@/lib/letter-editor-doc'
import { bodyTextForTranslation } from '@/lib/translation/visible-text'

describe('bodyTextForTranslation', () => {
  it('leaves historical/plain bodies byte-for-byte unchanged', () => {
    const body = 'my_username wrote **this before rich formatting existed**\n\nSecond paragraph.'
    expect(bodyTextForTranslation(body)).toBe(body)
  })

  it('removes Tempa rich-body formatting delimiters before translation', () => {
    const body = `${RICH_BODY_MARKER}**Hello** _there_.\n\nThis is **very _important_**.`
    expect(bodyTextForTranslation(body)).toBe('Hello there.\n\nThis is very important.')
  })

  it('restores escaped literal formatting characters in rich bodies', () => {
    const body = `${RICH_BODY_MARKER}Use \\_underscores\\_ and \\*stars\\* and \\\\slashes.`
    expect(bodyTextForTranslation(body)).toBe('Use _underscores_ and *stars* and \\slashes.')
  })
})
