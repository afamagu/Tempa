// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { readLetterEditorDraft, writeLetterEditorDraft } from './letter-editor-draft'
import { docToMomentDrafts, docToDraftMomentDescriptors, resolveDraftPreviewMoments, type LetterDocJSON } from './letter-editor-doc'
import { toMomentRpcPayload } from './moments'

describe('attached video survives the letter draft and send boundary', () => {
  it('refresh discards blob URLs but preserves the clip path, position and selected duration', async () => {
    const doc: LetterDocJSON = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'A moment from today.' },
      { type: 'videoMoment', attrs: { imagePath: 'corr/video/selected.mp4', previewUrl: 'blob:old-page', trimStartSeconds: 0, durationSeconds: 10 } },
    ] }] }
    expect(writeLetterEditorDraft('video-fixture', doc)).toBe(true)
    const restored = readLetterEditorDraft('video-fixture')!
    expect(JSON.stringify(restored)).not.toContain('blob:old-page')
    const sign = vi.fn().mockResolvedValue({ url: 'https://storage.test/new-signed-clip', error: null })
    const preview = await resolveDraftPreviewMoments(docToDraftMomentDescriptors(restored), sign)
    expect(sign).toHaveBeenCalledWith('corr/video/selected.mp4')
    expect(preview[0]).toMatchObject({ type: 'video', imageUrl: 'https://storage.test/new-signed-clip', imagePath: 'corr/video/selected.mp4', trimStartSeconds: 0, durationSeconds: 10, position: 0 })
    expect(docToMomentDrafts(restored).map(toMomentRpcPayload)).toEqual([{
      type: 'video', position: 0, image_path: 'corr/video/selected.mp4', postcard_key: null, trim_start_seconds: 0, duration_seconds: 10,
    }])
  })
})
