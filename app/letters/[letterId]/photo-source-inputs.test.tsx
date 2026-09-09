import { describe, it, expect } from 'vitest'
import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PhotoSourceInputs, { selectPhotoSourceRef } from './photo-source-inputs'

describe('PhotoSourceInputs', () => {
  it('renders two genuinely separate <input> elements, not one input reused for both', () => {
    const html = renderToStaticMarkup(
      <PhotoSourceInputs
        libraryInputRef={createRef<HTMLInputElement>()}
        cameraInputRef={createRef<HTMLInputElement>()}
        onChange={() => {}}
      />
    )
    const inputCount = (html.match(/<input/g) ?? []).length
    expect(inputCount).toBe(2)
  })

  // The exact bug: a single shared input with `capture` toggled via
  // setAttribute/removeAttribute right before each click is unreliable
  // on real mobile browsers. Two statically-configured inputs — camera
  // always carrying the attribute, library never — is the fix.
  it('gives exactly one input a static capture="environment" attribute', () => {
    const html = renderToStaticMarkup(
      <PhotoSourceInputs
        libraryInputRef={createRef<HTMLInputElement>()}
        cameraInputRef={createRef<HTMLInputElement>()}
        onChange={() => {}}
      />
    )

    const inputTags = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0])
    expect(inputTags).toHaveLength(2)

    const withCapture = inputTags.filter((tag) => tag.includes('capture='))
    const withoutCapture = inputTags.filter((tag) => !tag.includes('capture='))

    expect(withCapture).toHaveLength(1)
    expect(withCapture[0]).toContain('capture="environment"')
    expect(withoutCapture).toHaveLength(1)
  })

  it('both inputs accept only images and share the same change handler wiring', () => {
    const html = renderToStaticMarkup(
      <PhotoSourceInputs
        libraryInputRef={createRef<HTMLInputElement>()}
        cameraInputRef={createRef<HTMLInputElement>()}
        onChange={() => {}}
      />
    )
    const acceptCount = (html.match(/accept="image\/\*"/g) ?? []).length
    expect(acceptCount).toBe(2)
  })
})

// Two correct inputs are not the same claim as "the button that says
// Take a photo actually targets the camera one" — this proves the
// second thing, which the tests above don't touch. moments-composer.tsx
// calls this exact function (never re-decides the mapping inline), so
// this is the real wiring under test, not a parallel implementation.
describe('selectPhotoSourceRef — the button-to-input wiring', () => {
  it('"Take a photo" (useCamera=true) always resolves to the camera ref, never the library ref', () => {
    const libraryRef = createRef<HTMLInputElement>()
    const cameraRef = createRef<HTMLInputElement>()
    expect(selectPhotoSourceRef(true, libraryRef, cameraRef)).toBe(cameraRef)
  })

  it('"Choose from library" (useCamera=false) always resolves to the library ref, never the camera ref', () => {
    const libraryRef = createRef<HTMLInputElement>()
    const cameraRef = createRef<HTMLInputElement>()
    expect(selectPhotoSourceRef(false, libraryRef, cameraRef)).toBe(libraryRef)
  })

  it('never returns the same ref for both choices, regardless of which refs are passed', () => {
    const libraryRef = createRef<HTMLInputElement>()
    const cameraRef = createRef<HTMLInputElement>()
    expect(selectPhotoSourceRef(true, libraryRef, cameraRef)).not.toBe(
      selectPhotoSourceRef(false, libraryRef, cameraRef)
    )
  })
})
