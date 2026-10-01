import { describe, expect, it } from 'vitest'
import { dispatchMomentPlacementError, isDispatchMomentCollision, dispatchMomentMoveTargets, moveOverlappingDispatchPhoto } from './dispatch-moment-placement'
import { docToMomentDrafts, docToPlainBody, type LetterDocJSON, type ParagraphNodeJSON } from './letter-editor-doc'

const photo = (path: string) => ({ type: 'photoMoment' as const, attrs: { imagePath: path } })
const passage = (value: string, paths: string[] = []): ParagraphNodeJSON => ({
  type: 'paragraph', content: [{ type: 'text', text: value }, ...paths.map(photo)],
})

describe('Dispatch Moment placement', () => {
  it('identifies the reported duplicate at position 38 without changing the draft', () => {
    const doc: LetterDocJSON = { type: 'doc', content: Array.from({ length: 39 }, (_, i) => passage(`Passage ${i}`, i === 38 ? ['a.jpg', 'b.jpg'] : [])) }
    const original = JSON.stringify(doc)
    expect(dispatchMomentPlacementError(doc)).toContain('written passage 39')
    expect(JSON.stringify(doc)).toBe(original)
    expect(docToMomentDrafts(doc)).toHaveLength(2)
  })
  it('detects a photo-only paragraph collapsing onto an already occupied passage', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [passage('Before', ['a.jpg']), { type: 'paragraph', content: [photo('b.jpg')] }, passage('After')] }
    expect(dispatchMomentPlacementError(doc)).toContain('written passage 1')
  })
  it('accepts both photos once attached to distinct written passages', () => {
    expect(dispatchMomentPlacementError({ type: 'doc', content: [passage('Before', ['a.jpg']), passage('After', ['b.jpg'])] })).toBeNull()
  })
  it('accepts a standalone photo when its collapsed passage is unoccupied', () => {
    expect(dispatchMomentPlacementError({ type: 'doc', content: [passage('Before'), { type: 'paragraph', content: [photo('a.jpg')] }, passage('After')] })).toBeNull()
  })
  it('recognizes only the Moment-gap conflict, not unrelated unique violations', () => {
    expect(isDispatchMomentCollision({ code: '23505', message: 'duplicate key value violates unique constraint "dispatch_moments_unique_gap"' })).toBe(true)
    expect(isDispatchMomentCollision({ code: '23505', message: 'another_constraint' })).toBe(false)
    expect(isDispatchMomentCollision({ code: '23514', message: 'dispatch_moments_unique_gap' })).toBe(false)
  })
  it('moves the overlapping photo to the selected passage, preserving text, both photos and the original draft', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [passage('Before', ['a.jpg', 'b.jpg']), passage('After')] }
    const original = JSON.stringify(doc)
    expect(dispatchMomentMoveTargets(doc)).toEqual([{ rawIndex: 1, label: '2. After' }])
    const moved = moveOverlappingDispatchPhoto(doc, 1)!
    expect(docToPlainBody(moved)).toBe(docToPlainBody(doc))
    expect(docToMomentDrafts(moved)).toEqual([{ position: 0, type: 'photo', imagePath: 'a.jpg' }, { position: 1, type: 'photo', imagePath: 'b.jpg' }])
    expect(dispatchMomentPlacementError(moved)).toBeNull()
    expect(JSON.stringify(doc)).toBe(original)
  })
  it('rejects occupied, blank, stale or missing destinations without dropping a photo', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [passage('Before', ['a.jpg', 'b.jpg']), passage(''), passage('After', ['c.jpg'])] }
    for (const target of [0, 1, 2, 10]) expect(moveOverlappingDispatchPhoto(doc, target)).toBeNull()
  })
  it('repairs successive collisions one at a time, including standalone photo paragraphs', () => {
    const doc: LetterDocJSON = { type: 'doc', content: [passage('Before', ['a.jpg']), { type: 'paragraph', content: [photo('b.jpg'), photo('c.jpg')] }, passage('Middle'), passage('After')] }
    const first = moveOverlappingDispatchPhoto(doc, 2)!
    expect(dispatchMomentPlacementError(first)).not.toBeNull()
    const second = moveOverlappingDispatchPhoto(first, 3)!
    expect(dispatchMomentPlacementError(second)).toBeNull()
    expect(docToPlainBody(second)).toBe(docToPlainBody(doc))
    expect(docToMomentDrafts(second)).toHaveLength(3)
  })
})
