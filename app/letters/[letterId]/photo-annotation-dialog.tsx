'use client'

import { useEffect, useRef, useState } from 'react'

type Stroke = { points: { x: number; y: number }[] }
const MAX_EDGE = 1600

/** Private, client-side, nondestructive editor. Nothing uploads until Apply. */
export default function PhotoAnnotationDialog({
  image,
  onApply,
  onCancel,
}: {
  image: Blob
  onApply: (photo: Blob) => void | Promise<void>
  onCancel: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourceRef = useRef<HTMLImageElement | null>(null)
  const strokesRef = useRef<Stroke[]>([])
  const currentRef = useRef<Stroke | null>(null)
  const [version, setVersion] = useState(0)
  const [ready, setReady] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function render() {
    const canvas = canvasRef.current
    const photo = sourceRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !photo || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(photo, 0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#f43f5e'
    ctx.fillStyle = '#f43f5e'
    ctx.lineWidth = Math.max(4, canvas.width / 175)
    for (const stroke of [...strokesRef.current, ...(currentRef.current ? [currentRef.current] : [])]) {
      if (!stroke.points.length) continue
      ctx.beginPath()
      ctx.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height)
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x * canvas.width, point.y * canvas.height)
      if (stroke.points.length === 1) {
        ctx.arc(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height, ctx.lineWidth / 3, 0, 2 * Math.PI)
        ctx.fill()
      } else ctx.stroke()
    }
  }

  useEffect(() => {
    let cancelled = false
    const url = URL.createObjectURL(image)
    const photo = new Image()
    photo.onload = () => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      const ratio = Math.min(1, MAX_EDGE / Math.max(photo.naturalWidth, photo.naturalHeight))
      canvas.width = Math.max(1, Math.round(photo.naturalWidth * ratio))
      canvas.height = Math.max(1, Math.round(photo.naturalHeight * ratio))
      sourceRef.current = photo
      render()
      setReady(true)
    }
    photo.onerror = () => { if (!cancelled) setError('Could not load this image for marking.') }
    photo.src = url
    return () => {
      cancelled = true
      photo.onload = null
      photo.onerror = null
      sourceRef.current = null
      URL.revokeObjectURL(url)
    }
    // The source Blob does not change during one annotation session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image])

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (e.clientY - bounds.top) / bounds.height)),
    }
  }

  function endStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!currentRef.current) return
    strokesRef.current.push(currentRef.current)
    currentRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setVersion((value) => value + 1)
    render()
  }

  async function apply() {
    if (working || !ready) return
    if (strokesRef.current.length === 0) { onApply(image); return }
    const canvas = canvasRef.current
    if (!canvas) return
    setWorking(true)
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Image export failed')), 'image/jpeg', 0.88)
      })
      await onApply(blob)
    } catch {
      setError('Could not prepare the marked photo. Your original is unchanged.')
      setWorking(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Mark your photo" className="fixed inset-0 z-[120] overflow-y-auto bg-black/90 p-4 text-white">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-3">
        <h2 className="font-serif text-xl">Mark your photo</h2>
        <p className="text-sm text-white/75">Draw with a finger or mouse. You can also include the photo without making marks.</p>
        <canvas
          ref={canvasRef}
          aria-label="Photo annotation drawing surface"
          className="block max-h-[65vh] w-full touch-none rounded object-contain"
          style={{ height: 'auto', width: '100%' }}
          onPointerDown={(e) => {
            if (!ready || working) return
            e.currentTarget.setPointerCapture(e.pointerId)
            currentRef.current = { points: [point(e)] }
            render()
          }}
          onPointerMove={(e) => {
            if (!currentRef.current) return
            currentRef.current.points.push(point(e))
            render()
          }}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!ready || !version || working} onClick={() => {
            strokesRef.current.pop()
            setVersion((value) => value + 1)
            render()
          }} className="min-h-11 rounded border border-white/30 px-4 disabled:opacity-40">Undo mark</button>
          <button type="button" disabled={!ready || !version || working} onClick={() => {
            strokesRef.current = []
            setVersion((value) => value + 1)
            render()
          }} className="min-h-11 rounded border border-white/30 px-4 disabled:opacity-40">Clear marks</button>
          <div className="flex-1" />
          <button type="button" disabled={working} onClick={onCancel} className="min-h-11 rounded border border-white/30 px-4">Cancel</button>
          <button type="button" disabled={!ready || working} onClick={apply} className="min-h-11 rounded bg-white px-5 font-semibold text-black disabled:opacity-40">{working ? 'Preparing…' : 'Include photo'}</button>
        </div>
      </div>
    </div>
  )
}
