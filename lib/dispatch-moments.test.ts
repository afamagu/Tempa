import { describe, expect, it } from 'vitest'
import { groupDispatchMoments } from './dispatch-moments'
import { dispatchBodyToDoc, docToMomentDrafts, docToPlainBody, type LetterDocJSON } from './letter-editor-doc'

describe('multiple Dispatch Moments', () => {
  it('preserves all attachments and their order through editing and serialization', () => {
    const moments = ['first', 'second', 'third'].map(name => ({ position: 0, imagePath: `${name}.jpg`, previewUrl: null }))
    const doc = dispatchBodyToDoc('One passage.', moments)
    expect(docToPlainBody(doc)).toBe('One passage.')
    expect(docToMomentDrafts(doc)).toEqual(moments.map(m => ({ position: m.position, type: 'photo', imagePath: m.imagePath })))
  })
  it('keeps repeated attachments and photo-only paragraphs without a per-passage count limit', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before.' }] },
      { type: 'paragraph', content: Array.from({ length: 100 }, () => ({ type: 'photoMoment', attrs: { imagePath: 'same.jpg' } })) },
      { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] },
    ] }
    const moments = docToMomentDrafts(doc)
    expect(moments).toHaveLength(100)
    expect(groupDispatchMoments(moments).get(0)).toHaveLength(100)
    expect(docToPlainBody(doc)).toBe('Before.\n\n\n\nAfter.')
  })
  it('groups nonadjacent rows without mutating the input', () => {
    const rows = [{ position: 1, id: 'a' }, { position: 0, id: 'b' }, { position: 1, id: 'c' }]
    expect(groupDispatchMoments(rows).get(1)?.map(m => m.id)).toEqual(['a', 'c'])
    expect(rows.map(m => m.id)).toEqual(['a', 'b', 'c'])
  })
})
