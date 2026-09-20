'use client'

// Your Mark — Checkpoint 1 (engine audit + visual prototype), extended
// in Checkpoint 1B ("Show structure" toggle), extended again after the
// v2-vs-reference visual audit (v2 vs v3 side by side), and extended
// again for the "Choose Your Mark" checkpoint: v2 and v3 are no longer
// treated as one algorithm superseding another — they are independent
// artistic FAMILIES, alongside three new candidates (WEAVE, CONTOUR,
// GLYPH),
// that a member will eventually choose between. This page runs a
// single source photo through all four and displays them side by side
// so that choice can actually be evaluated, not just described.
//
// Deliberately NOT linked from AppShell/nav, NOT wired to any
// production identity surface, and NOT touching Supabase in any way —
// this route exists purely so the product owner can load real photos
// and evaluate the transformation itself. Chosen files never leave the
// browser; nothing here reads or writes a profiles row, an auth
// session, or any storage bucket.
//
// "Do NOT propagate the prototype into People, Board, Letters, Replies,
// Home, etc. yet" — this page is the entire footprint of this
// checkpoint's UI. Reachable only by someone who navigates to
// /prototypes/your-mark directly.
//
// "Show structure" swaps every Mark preview (all four columns) to
// structureDataUrl — the same geometry with texture/stroke/seam
// decoration omitted — a diagnostic tool only, so the underlying
// abstraction can be judged on its own rather than disguised by
// decoration. It is a page-level toggle affecting every sample at
// once, never shown in production.

import { useEffect, useRef, useState } from 'react'
import {
  generateMarkContour,
  generateMarkGlyph,
  generateMarkV2,
  generateMarkWeave,
  type MarkResult,
} from '@/lib/mark/mark-engine'

type Sample = {
  id: string
  fileName: string
  sourcePreviewUrl: string
  v2: MarkResult
  weave: MarkResult
  contour: MarkResult
  glyph: MarkResult
}

const SQUIRCLE_RADIUS = '26%'

function MarkThumb({ dataUrl, size, label }: { dataUrl: string; size: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <img
        src={dataUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: SQUIRCLE_RADIUS }}
        className="block object-cover"
      />
      <p className="text-[12px] text-muted">{label}</p>
    </div>
  )
}

function MarkColumn({
  label,
  mark,
  showStructure,
}: {
  label: string
  mark: MarkResult
  showStructure: boolean
}) {
  const url = showStructure ? mark.structureDataUrl : mark.dataUrl
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-foreground/80">{label}</p>
      <div className="flex flex-wrap items-end gap-4">
        <MarkThumb dataUrl={url} size={160} label="Full" />
        <MarkThumb dataUrl={url} size={72} label="Medium" />
        <MarkThumb dataUrl={url} size={40} label="Small (avatar)" />
      </div>
      <p className="text-[12px] text-muted">
        pieces {mark.regionCount} · seed {mark.seed}
      </p>
    </div>
  )
}

export default function YourMarkPrototypePage() {
  const [samples, setSamples] = useState<Sample[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showStructure, setShowStructure] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const sourcePreviewUrlsRef = useRef(new Set<string>())

  // Every object URL this page itself creates (for the SOURCE preview
  // only — each engine's own internal object URL is created and
  // revoked entirely inside its own generateMark* function, before
  // this component ever sees anything) is revoked when the prototype
  // page unmounts. A ref holds the live set so cleanup never captures
  // the initial empty samples array.
  useEffect(() => {
    return () => {
      for (const url of sourcePreviewUrlsRef.current) URL.revokeObjectURL(url)
      sourcePreviewUrlsRef.current.clear()
    }
  }, [])

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const files = Array.from(fileList)
      const next: Sample[] = []
      for (const file of files) {
        // All four families run against the SAME decoded pixels — "one
        // member photo, several private interpretations," the actual
        // product concept this checkpoint is testing.
        const [v2, weave, contour, glyph] = await Promise.all([
          generateMarkV2(file),
          generateMarkWeave(file),
          generateMarkContour(file),
          generateMarkGlyph(file),
        ])
        const sourcePreviewUrl = URL.createObjectURL(file)
        sourcePreviewUrlsRef.current.add(sourcePreviewUrl)
        next.push({
          id: `${file.name}-${file.lastModified}-${Math.round(performance.now())}`,
          fileName: file.name,
          // A LOCAL, this-page-only preview of the original — never
          // sent anywhere, revoked on cleanup above. Distinct from each
          // engine's own internal handling of the file, none of which
          // persists the source at all (see mark-engine.ts).
          sourcePreviewUrl,
          v2,
          weave,
          contour,
          glyph,
        })
      }
      setSamples((prev) => [...next, ...prev])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate a Mark from that image.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <main className="min-h-screen bg-background p-6 sm:p-10">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div className="space-y-2">
          <p className="text-[13px] font-medium uppercase tracking-wider text-muted">Prototype — not production</p>
          <h1 className="text-2xl font-semibold text-foreground">Choose Your Mark — family comparison</h1>
          <p className="text-[15px] leading-relaxed text-foreground/80">
            Choose a photo. It is processed entirely in this browser tab — never uploaded, never sent to any
            server. Each photo runs through four independent artistic families (V2, WEAVE, CONTOUR, GLYPH) so they can be
            compared directly, at full, medium, and small (avatar-scale) size — the "choose your Mark" experience
            this checkpoint is testing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-md bg-accent text-accent-foreground px-4 py-2.5 text-[15px] font-medium transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? 'Generating…' : 'Choose photo(s)'}
          </button>

          <label className="flex items-center gap-2 text-[14px] text-foreground/80">
            <input
              type="checkbox"
              checked={showStructure}
              onChange={(e) => setShowStructure(e.target.checked)}
            />
            Show structure
          </label>
        </div>

        {showStructure && (
          <p className="text-[13px] text-muted">
            Diagnostic view: geometry only — no texture, no outline/seam decoration. Judges the abstraction
            itself, not the decoration on top of it. Applies to all four columns.
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        {samples.length === 0 && !busy && (
          <p className="text-[14px] text-muted">No photos loaded yet.</p>
        )}

        <div className="space-y-12">
          {samples.map((sample) => (
            <div key={sample.id} className="space-y-5 border-t border-foreground/10 pt-6">
              <p className="text-[13px] text-muted">{sample.fileName}</p>

              <div className="flex flex-col items-start gap-2">
                <img
                  src={sample.sourcePreviewUrl}
                  alt=""
                  style={{ width: 160, height: 160, borderRadius: SQUIRCLE_RADIUS }}
                  className="block object-cover"
                />
                <p className="text-[12px] text-muted">Source</p>
              </div>

              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
                <MarkColumn label="V2" mark={sample.v2} showStructure={showStructure} />
                <MarkColumn label="WEAVE" mark={sample.weave} showStructure={showStructure} />
                <MarkColumn label="CONTOUR" mark={sample.contour} showStructure={showStructure} />
                <MarkColumn label="GLYPH" mark={sample.glyph} showStructure={showStructure} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
