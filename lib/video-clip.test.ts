import { describe, expect, it, vi } from 'vitest'
import { videoClipArgs, extractVideoClip } from './video-clip'
const mocks = vi.hoisted(() => ({ load: vi.fn(), writeFile: vi.fn(), exec: vi.fn(), readFile: vi.fn(), terminate: vi.fn() }))
vi.mock('@ffmpeg/ffmpeg', () => ({ FFmpeg: class {
  load = mocks.load; writeFile = mocks.writeFile; exec = mocks.exec; readFile = mocks.readFile; terminate = mocks.terminate
} }))

describe('selected clip extraction', () => {
  it('rejects invalid windows before loading a codec', () => {
    for (const [start, duration] of [[-1, 10], [0, 11], [NaN, 10], [0, 0], [0, Infinity]]) {
      expect(() => videoClipArgs(start, duration)).toThrow()
    }
  })
  it('decodes at the selected start and produces H264/AAC MP4 without original metadata', () => {
    const args = videoClipArgs(12.5, 10)
    expect(args.slice(0, 6)).toEqual(['-ss', '12.5', '-i', 'source', '-t', '10'])
    expect(args).toContain('libx264')
    expect(args).toContain('aac')
    expect(args).not.toContain('copy')
    expect(args.slice(-5)).toEqual(['-map_metadata', '-1', '-movflags', '+faststart', 'clip.mp4'])
  })
  it('uploads can only receive encoded output, never the source File', async () => {
    vi.stubGlobal('location', { origin: 'https://tempa.test' })
    mocks.exec.mockResolvedValue(0)
    mocks.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const source = new File(['original footage'], 'source.mov', { type: 'video/quicktime' })
    const clip = await extractVideoClip(source, 3, 10, new AbortController().signal)
    expect(clip.type).toBe('video/mp4')
    expect(new Uint8Array(await clip.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(mocks.terminate).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
  it('never returns the original when encoding fails', async () => {
    vi.stubGlobal('location', { origin: 'https://tempa.test' })
    mocks.exec.mockResolvedValue(1)
    await expect(extractVideoClip(new File(['original'], 'x.mp4'), 0, 10, new AbortController().signal)).rejects.toThrow('could not be prepared')
    vi.unstubAllGlobals()
  })
})
