// Shared browser-side image processing for every photo-Moment upload
// surface (private letters, Dispatches) — extracted from
// moments-composer.tsx unchanged during the Dispatches/Board checkpoint
// so both composers use the exact same re-encode/EXIF-strip/compress
// behavior rather than two copies that could quietly drift.

/**
 * Strips EXIF (a canvas re-encode never carries source metadata
 * forward) and resizes/compresses to a sensible upper bound, preserving
 * aspect ratio exactly — no cropping, no distortion.
 */
export async function processImageForUpload(file: File): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Could not read image'))
    el.src = dataUrl
  })

  const MAX_DIMENSION = 1600
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot process images.')
  ctx.drawImage(img, 0, 0, width, height)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process image'))),
      'image/jpeg',
      0.85
    )
  })
}
