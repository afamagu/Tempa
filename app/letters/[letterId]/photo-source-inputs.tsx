'use client'

import type { RefObject } from 'react'

/**
 * The two hidden file inputs behind "Choose from library" / "Take a
 * photo" — deliberately two SEPARATE, statically-configured inputs
 * rather than one shared input with `capture` toggled on/off right
 * before each click. The latter is a known-unreliable pattern: several
 * mobile browsers decide which picker UI to show based on the input's
 * state at a point that doesn't reliably line up with "immediately
 * before this specific click," so a late-added `capture` attribute can
 * silently be ignored and fall through to the ordinary library picker.
 * A `capture="environment"` input that has always had that attribute,
 * never mutated, is the safe, standard approach — and pulling both
 * inputs into their own component (rather than inline in the composer)
 * lets this exact contract be rendered and checked in isolation,
 * without needing to mount the full editor.
 *
 * On desktop browsers that don't implement the capture hint (most of
 * them today), the camera input simply falls back to the same ordinary
 * file browser as the library input — that's the browser's own
 * fallback for an unsupported hint, not something this component
 * aliases in code.
 */
export default function PhotoSourceInputs({
  libraryInputRef,
  cameraInputRef,
  onChange,
}: {
  libraryInputRef: RefObject<HTMLInputElement | null>
  cameraInputRef: RefObject<HTMLInputElement | null>
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <>
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        onChange={onChange}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onChange}
        className="hidden"
      />
    </>
  )
}

/**
 * Pure: which of the two inputs a photo-source choice maps to — camera
 * always means the capture="environment" input, library always means
 * the plain one. Extracted out of moments-composer.tsx's chooseSource
 * specifically so this mapping (button click -> correct ref) is
 * provably correct on its own, not just "the two inputs individually
 * have the right attributes" — the two facts are different claims, and
 * only this one rules out a shared-ref/mixed-up-wiring regression.
 */
export function selectPhotoSourceRef(
  useCamera: boolean,
  libraryInputRef: RefObject<HTMLInputElement | null>,
  cameraInputRef: RefObject<HTMLInputElement | null>
): RefObject<HTMLInputElement | null> {
  return useCamera ? cameraInputRef : libraryInputRef
}
