import { docToMomentDrafts, paragraphCollapsedPositions, type LetterDocJSON } from './letter-editor-doc'

/** Uses the actual RPC positions, including collapsed photo-only paragraphs.
 * Never moves or removes a photo to make a Dispatch pass validation. */
export function dispatchMomentPlacementError(doc: LetterDocJSON): string | null {
  const occupied = new Set<number>()
  for (const moment of docToMomentDrafts(doc)) {
    if (moment.type !== 'photo') continue
    if (occupied.has(moment.position)) {
      return `Two photos are attached to written passage ${moment.position + 1}. A Dispatch can have one photo per passage. Move one photo to a different paragraph containing text, then preview again. A blank line alone does not separate them. Your draft is saved.`
    }
    occupied.add(moment.position)
  }
  return null
}

export function isDispatchMomentCollision(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '23505' && Boolean(error.message?.includes('dispatch_moments_unique_gap'))
}

export function dispatchMomentMoveTargets(doc: LetterDocJSON): { rawIndex: number; label: string }[] {
  const paragraphs = doc.content ?? []
  const positions = paragraphCollapsedPositions(paragraphs)
  const occupied = new Set(docToMomentDrafts(doc).filter(m => m.type === 'photo').map(m => m.position))
  return paragraphs.flatMap((p, rawIndex) => {
    const text = (p.content ?? []).map(n => n.type === 'text' ? n.text : n.type === 'hardBreak' ? '\n' : '').join('').trim()
    return text && !occupied.has(positions[rawIndex])
      ? [{ rawIndex, label: `${positions[rawIndex] + 1}. ${text.replace(/\s+/g, ' ').slice(0, 80)}` }]
      : []
  })
}

/** Moves only the first overlapping photo, and only to the writer's chosen
 * unoccupied text paragraph. Revalidate against the current doc on every click. */
export function moveOverlappingDispatchPhoto(doc: LetterDocJSON, targetRawIndex: number): LetterDocJSON | null {
  if (!dispatchMomentMoveTargets(doc).some(t => t.rawIndex === targetRawIndex)) return null
  const paragraphs = doc.content ?? []
  const positions = paragraphCollapsedPositions(paragraphs)
  const occupied = new Set<number>()
  for (let rawIndex = 0; rawIndex < paragraphs.length; rawIndex++) {
    const content = paragraphs[rawIndex].content ?? []
    for (let nodeIndex = 0; nodeIndex < content.length; nodeIndex++) {
      const node = content[nodeIndex]
      if (node.type !== 'photoMoment') continue
      if (occupied.has(positions[rawIndex])) {
        return { ...doc, content: paragraphs.map((p, i) => i === rawIndex
          ? { ...p, content: (p.content ?? []).filter((_, j) => j !== nodeIndex) }
          : i === targetRawIndex ? { ...p, content: [...(p.content ?? []), node] } : p) }
      }
      occupied.add(positions[rawIndex])
    }
  }
  return null
}
