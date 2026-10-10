/** Re-encode, never stream-copy: keyframe preroll must not expose unselected footage. */
export const VIDEO_SOURCE_MAX_BYTES = 100 * 1024 * 1024
export const VIDEO_CLIP_MAX_BYTES = 5 * 1024 * 1024
export function videoClipArgs(start: number, duration: number): string[] {
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0 || duration > 10) {
    throw new Error('Choose a video segment of up to 10 seconds.')
  }
  return ['-ss', String(start), '-i', 'source', '-t', String(duration), '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', "scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-maxrate', '1800k', '-bufsize', '3600k',
    '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-ar', '44100',
    '-map_metadata', '-1', '-movflags', '+faststart', 'clip.mp4']
}

export async function extractVideoClip(file: File, start: number, duration: number, signal: AbortSignal): Promise<Blob> {
  const args = videoClipArgs(start, duration)
  if (file.size > VIDEO_SOURCE_MAX_BYTES) throw new Error('Choose a video smaller than 100 MB. You can shorten it in your phone’s Photos app first.')
  const { FFmpeg } = await import('@ffmpeg/ffmpeg')
  const ffmpeg = new FFmpeg()
  const cancel = () => ffmpeg.terminate()
  signal.addEventListener('abort', cancel, { once: true })
  const deadline = setTimeout(cancel, 180_000)
  try {
    signal.throwIfAborted()
    await ffmpeg.load({
      classWorkerURL: `${location.origin}/video-codec/wrapper/worker.js`,
      coreURL: `${location.origin}/video-codec/ffmpeg-core.js`,
      wasmURL: `${location.origin}/video-codec/ffmpeg-core.wasm`,
    }, { signal })
    await ffmpeg.writeFile('source', new Uint8Array(await file.arrayBuffer()), { signal })
    const exit = await ffmpeg.exec(args, 120_000, { signal })
    if (exit !== 0) throw new Error('This video could not be prepared. Try a shorter video or export it as MP4 in your Photos app.')
    const bytes = await ffmpeg.readFile('clip.mp4', undefined, { signal })
    if (typeof bytes === 'string' || !bytes.length || bytes.length > VIDEO_CLIP_MAX_BYTES) {
      throw new Error('The selected clip is too large. Try another video.')
    }
    return new Blob([new Uint8Array(bytes)], { type: 'video/mp4' })
  } finally {
    clearTimeout(deadline)
    signal.removeEventListener('abort', cancel)
    ffmpeg.terminate()
  }
}
