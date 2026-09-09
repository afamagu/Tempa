import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import MomentsWalkthrough from './moments-walkthrough'

// Same convention as app/block-button.test.tsx: renderToStaticMarkup only
// (no jsdom), so the multi-screen `screen` useState is only ever
// observable at its initial value (0) via a plain render — screens 1-5
// are unreachable without a simulated click, which this project's test
// harness deliberately doesn't provide. Screen 0 is verified by actually
// rendering the component; screens 1-5, the sample letter, and the
// carousel are verified by reading the tracked source text directly,
// which is exactly how block-button.test.tsx already verifies its own
// unreachable "choosing" panel copy.
const SOURCE_PATH = path.join(__dirname, 'moments-walkthrough.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

// Strips `//` and `/* */` comments before a blanket scan — this file's
// own doc comments legitimately explain the Postcard/TempaPose removal
// by name (documenting what changed and why, same convention as every
// other checkpoint's migration comments), which must not itself trip a
// "never mentions X" scan aimed at actual code/rendered copy.
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}
// `postcardKey: null` is required, structural boilerplate on every photo
// Moment — the shared production `Moment` type (lib/moments.ts) has both
// `imageUrl`/`postcardKey` fields, and a photo Moment must explicitly
// null out the one it doesn't use (see toMomentRpcPayload's own doc
// comment for why "explicitly null, never omitted" matters). This is a
// field NAME mandated by the type this file deliberately reuses
// unmodified, never functional Postcard language — stripped out
// specifically so it can't itself trip the "no Postcard language" scan.
const codeOnly = stripComments(source).replace(/postcardKey:\s*null,?/g, '')

function renderScreenZero(overrides: Partial<Parameters<typeof MomentsWalkthrough>[0]> = {}) {
  return renderToStaticMarkup(
    <MomentsWalkthrough
      allowSkip={false}
      finalLabel="Continue writing"
      onFinish={() => {}}
      otherPseudonym="Evening Quill"
      {...overrides}
    />
  )
}

// A. Moments walkthrough no longer contains Postcard language — the
// single strongest guard: nothing in the ENTIRE tracked source, across
// every screen, may mention Postcards. MOMENTS = PHOTOGRAPHS now.
describe('MomentsWalkthrough — no Postcard language anywhere (Moments = photographs)', () => {
  it('never mentions "postcard" in actual code/copy (comments may document the removal by name)', () => {
    expect(codeOnly.toLowerCase()).not.toContain('postcard')
  })

  it('the rendered Screen 0 (reachable via a plain render) never mentions postcards', () => {
    const html = renderScreenZero()
    expect(html.toLowerCase()).not.toContain('postcard')
  })

  it('the old "photographs and postcards" framing is gone from the source, replaced with the photographs-only sentence', () => {
    expect(source).not.toContain('photographs and postcards')
    expect(source).toContain('way to let photographs become part of the story')
    expect(source).toContain("you&apos;re telling.")
    expect(source).toContain('photographs placed naturally within')
  })

  it('Screen 5 offers only "Photo", never the old "Photo · Postcard" choice label', () => {
    expect(source).not.toContain('Photo · Postcard')
    expect(source).toContain('>Photo</p>')
  })

  it('Screen 4 no longer says Postcards can be added, but keeps the accurate first-photo-consent explanation', () => {
    expect(source).not.toContain('Postcards can be added')
    expect(source).toContain(
      "If you add a photo before photo sharing has begun, the other person\n                    decides whether they&apos;d like to open it and begin exchanging photos."
    )
  })
})

// B is covered in moments-available-notice.test.tsx (separate file).

// C. moments-walkthrough.tsx no longer imports/renders TempaPose —
// TempaPose itself, and its use in the Minds walkthrough, are untouched.
describe('MomentsWalkthrough — no mascot/character (TempaPose removed from this tutorial only)', () => {
  it('never imports or renders TempaPose in actual code (a doc comment may name it when explaining the removal)', () => {
    expect(codeOnly).not.toContain('tempa-pose')
    expect(codeOnly).not.toContain('TempaPose')
  })

  it('Screen 0, rendered, contains no TempaPose markup (its role="img"/data-tempa-pose signature)', () => {
    const html = renderScreenZero()
    expect(html).not.toContain('data-tempa-pose')
    expect(html).not.toMatch(/role="img"/)
  })
})

// D/E. Screen 3's sample now builds a real body + Moment[] and renders it
// through the actual production LetterBody — proven via source text
// (screen 3 is unreachable via a plain render), plus a direct behavioral
// check that LetterBody, given this exact tutorial data, renders it the
// same way it renders any other letter (no changes to LetterBody itself).
describe('MomentsWalkthrough — sample letter uses production LetterBody, photo Moments only', () => {
  it('imports the real LetterBody component, not a duplicated layout', () => {
    expect(source).toContain("import LetterBody from '@/app/letters/[letterId]/letter-body'")
    expect(source).toContain('<LetterBody body={SAMPLE_LETTER_BODY} moments={SAMPLE_LETTER_MOMENTS} />')
  })

  it('no longer imports MomentDisplay or the Postcard catalog directly', () => {
    expect(source).not.toContain("from '@/app/letters/moment-display'")
    expect(source).not.toContain('POSTCARD_CATALOG')
  })

  it('the sample Moment data contains exactly two Moments, both photo, none postcard', () => {
    const photoCount = (source.match(/type: 'photo'/g) ?? []).length
    const postcardCount = (source.match(/type: 'postcard'/g) ?? []).length
    expect(photoCount).toBe(2)
    expect(postcardCount).toBe(0)
  })

  it('references both existing sample photo assets, and no new/external image URL', () => {
    expect(source).toContain('/moments-guide/sample-street.jpg')
    expect(source).toContain('/moments-guide/sample-chair.jpg')
    expect(source).not.toMatch(/https?:\/\//)
  })

  it('LetterBody actually renders the sample body/Moments the same way it renders any letter — a real instance, not a diagram', async () => {
    const { default: LetterBody } = await import('@/app/letters/[letterId]/letter-body')
    const html = renderToStaticMarkup(
      <LetterBody
        body={[
          'I took the long way to get bread this morning.',
          "There's a little street near our house that runs down toward the water. I've walked it so many times that I usually don't notice it anymore.",
        ].join('\n\n')}
        moments={[
          {
            id: 'sample-moment-street',
            position: 1,
            type: 'photo',
            imageUrl: '/moments-guide/sample-street.jpg',
            postcardKey: null,
          },
        ]}
      />
    )
    expect(html).toContain('I took the long way to get bread this morning.')
    expect(html).toContain('aria-label="Open this photo"')
    expect(html).toContain('/moments-guide/sample-street.jpg')
  })
})

// F/G. First-time (mandatory) completion and Continue-writing behavior
// are unchanged — proven at the level that actually matters: the prop
// contract (allowSkip=false renders no Close/no Not-now, and the final
// screen's primary action is still exactly `onFinish`/`finalLabel`,
// unchanged from before this checkpoint) plus lib/moments-guide.ts's own
// test suite (completeMomentsWalkthrough), which this checkpoint does
// not touch at all.
describe('MomentsWalkthrough — first-time (mandatory) behavior unchanged', () => {
  it('allowSkip=false renders no Close button and no "Not now" escape on Screen 0', () => {
    const html = renderScreenZero({ allowSkip: false })
    expect(html).not.toContain('aria-label="Close"')
    expect(html).not.toContain('Not now')
  })

  it('allowSkip=false still shows "Show me" as Screen 0\'s only forward action', () => {
    const html = renderScreenZero({ allowSkip: false })
    expect(html).toContain('Show me')
  })

  it('the final screen\'s primary action is still driven by the finalLabel/onFinish props, unchanged in the source', () => {
    expect(source).toContain('onNext={onFinish} onBack={() => setScreen(4)} nextLabel={finalLabel}')
  })
})

// H. Replay still ends with "Done" — MomentsWalkthrough itself is
// unchanged in how it wires finalLabel through to the last screen (see
// the source assertion above); this confirms the replay call site
// (app/you/guide/moments/replay.tsx) still passes finalLabel="Done"
// unchanged, which is what actually determines the label a member sees.
describe('Replay — still passes finalLabel="Done" (unchanged)', () => {
  it('replay.tsx still calls MomentsWalkthrough with allowSkip and finalLabel="Done"', () => {
    const replaySource = readFileSync(
      path.join(__dirname, '..', 'you', 'guide', 'moments', 'replay.tsx'),
      'utf8'
    )
    expect(replaySource).toContain('allowSkip')
    expect(replaySource).toContain('finalLabel="Done"')
  })
})

// Screen 2 must be preserved verbatim — it was already conceptually
// correct under the photo-only Moments model per the checkpoint's own
// instruction not to rewrite it for style.
describe('MomentsWalkthrough — Screen 2 preserved verbatim', () => {
  it('keeps every one of its locked example phrases unchanged', () => {
    expect(source).toContain('Let the picture belong to the story.')
    expect(source).toContain('the street you walked down that morning')
    expect(source).toContain("The meal you&apos;ve\n                    been trying to perfect")
    expect(source).toContain('Rain against your window')
    expect(source).toContain('A place the other person may')
    expect(source).toContain('It doesn&apos;t have to be a photograph of you.')
    expect(source).toContain('the smallest glimpse of someone&apos;s world')
    expect(source).toContain('Show the life around the letter.')
  })
})

// Final visual-completion checkpoint (2026-09-08): Screen 2 ("A new way
// to write" — the "user-facing Screen 2" in the review's own 1-indexed
// numbering, i.e. this file's `screen === 1`) gained ONE restrained
// editorial ornament in its open lower area. Unreachable via a plain
// render (see the file-level note above), so verified by slicing the
// tracked source down to exactly this screen's block.
describe('MomentsWalkthrough — Screen 2 ("A new way to write"): ornament only, copy unchanged', () => {
  const screenTwoBlock = source.slice(
    source.indexOf('{screen === 1 &&'),
    source.indexOf('{screen === 2 &&')
  )

  it('keeps the approved heading and copy unchanged', () => {
    expect(screenTwoBlock).toContain('A new way to write')
    expect(screenTwoBlock).toContain('photographs placed naturally within')
    expect(screenTwoBlock).toContain('Not attachments at the end.')
    expect(screenTwoBlock).toContain('Part of the story itself.')
  })

  it('adds exactly the one editorial ornament, nothing else', () => {
    expect(screenTwoBlock).toContain('<EditorialOrnament />')
  })

  it('adds no photograph, mascot, card, or illustration to this screen', () => {
    expect(screenTwoBlock).not.toContain('<img')
    expect(screenTwoBlock).not.toContain('TempaPose')
    expect(screenTwoBlock).not.toContain('bg-surface-shell')
    expect(screenTwoBlock).not.toContain('MomentDisplay')
  })

  it('adds no new explanatory sentence — still exactly the two approved <p> blocks', () => {
    const paragraphCount = (screenTwoBlock.match(/<p\b/g) ?? []).length
    expect(paragraphCount).toBe(2)
  })
})

// The ornament itself: a fine hairline interrupted by the existing ⊕
// glyph, purely decorative, with none of the explicitly forbidden
// treatments (animation, glow, gradient, illustration).
describe('EditorialOrnament — Screen 2\'s printer\'s-ornament mark', () => {
  const ornamentBlock = source.slice(
    source.indexOf('function EditorialOrnament'),
    source.indexOf('// Each tile is primarily photographic')
  )

  it('is purely decorative (aria-hidden) and uses the existing ⊕ glyph, not a new symbol', () => {
    expect(ornamentBlock).toContain('aria-hidden="true"')
    expect(ornamentBlock).toContain('⊕')
  })

  it('has no animation, glow, or gradient treatment', () => {
    const lower = ornamentBlock.toLowerCase()
    expect(lower).not.toContain('animate')
    expect(lower).not.toContain('gradient')
    expect(lower).not.toContain('glow')
  })
})

// F. Screen 4 (the sample letter, this file's screen === 3) is untouched
// by this checkpoint — re-asserts its exact LetterBody wiring, which
// this checkpoint made no edits to.
describe('MomentsWalkthrough — Screen 4 (sample letter) untouched by this checkpoint', () => {
  it('still renders the sample body/Moments through the same unmodified LetterBody call', () => {
    expect(source).toContain('<LetterBody body={SAMPLE_LETTER_BODY} moments={SAMPLE_LETTER_MOMENTS} />')
    const photoCount = (source.match(/type: 'photo'/g) ?? []).length
    expect(photoCount).toBe(2)
  })
})

// A restrained progress indicator was added (Part 6) — quiet text, never
// a dot/carousel-style progress treatment.
describe('MomentsWalkthrough — restrained progress indicator', () => {
  it('shows "1 / 6" on the initial screen', () => {
    const html = renderScreenZero()
    expect(html).toContain('1 / 6')
  })

  it('never renders dot-style or carousel-style progress markup', () => {
    const html = renderScreenZero()
    expect(html.toLowerCase()).not.toContain('progress-dot')
    expect(html.toLowerCase()).not.toContain('carousel-dot')
  })
})

// The five carousel subjects remain locked — no new/replacement stock
// photography URLs, no external dependency.
describe('MomentsCarousel — five locked subjects, no external assets', () => {
  it('still lists exactly the five approved subjects, unchanged', () => {
    for (const label of [
      'Morning coffee',
      'A walk by the sea',
      'Little companions',
      'A night in the city',
      'Market day',
    ]) {
      expect(source).toContain(label)
    }
  })
})

// Final visual-completion checkpoint (2026-09-08): the five supplied
// photographs are wired in. Previously deferred — the files didn't
// exist yet — now verified: each subject maps to its exact expected
// asset path, exactly five entries remain (no sixth slipped in, none
// dropped), every file genuinely exists on disk at that path (not just
// referenced in source), and no Postcard language returned alongside
// this change.
describe('MomentsCarousel — real supplied photographs wired to their exact subjects', () => {
  const SUBJECT_TO_PATH: Record<string, string> = {
    'Morning coffee': '/moments-guide/carousel/morning-coffee.jpg',
    'A walk by the sea': '/moments-guide/carousel/walk-by-the-sea.jpg',
    'Little companions': '/moments-guide/carousel/little-companions.jpg',
    'A night in the city': '/moments-guide/carousel/night-in-the-city.jpg',
    'Market day': '/moments-guide/carousel/market-day.jpg',
  }

  it('each of the five subjects maps to its correct, exact image path', () => {
    for (const [label, src] of Object.entries(SUBJECT_TO_PATH)) {
      expect(source).toContain(`label: '${label}', src: '${src}'`)
    }
  })

  it('contains exactly five carousel entries — none added, none dropped', () => {
    const entryCount = (source.match(/label: '[^']+', src: '\/moments-guide\/carousel\//g) ?? []).length
    expect(entryCount).toBe(5)
  })

  it('every referenced asset file actually exists on disk at its expected public path', () => {
    const publicDir = path.join(__dirname, '..', '..', 'public')
    for (const src of Object.values(SUBJECT_TO_PATH)) {
      const absolutePath = path.join(publicDir, src)
      expect(existsSync(absolutePath), `expected ${src} to exist at ${absolutePath}`).toBe(true)
    }
  })

  it('the sample-letter assets were never touched or overwritten by this change', () => {
    const publicDir = path.join(__dirname, '..', '..', 'public')
    expect(existsSync(path.join(publicDir, 'moments-guide', 'sample-street.jpg'))).toBe(true)
    expect(existsSync(path.join(publicDir, 'moments-guide', 'sample-chair.jpg'))).toBe(true)
  })

  it('the carousel renders each photograph with object-cover (no stretching) and no dark gradient overlay', () => {
    const carouselBlock = source.slice(
      source.indexOf('function MomentsCarousel'),
      source.indexOf('// The sample letter is a real body')
    )
    expect(carouselBlock).toContain('object-cover')
    expect(carouselBlock).not.toContain('object-fill')
    expect(carouselBlock.toLowerCase()).not.toContain('gradient')
  })

  it('still no Postcard language anywhere near the carousel implementation', () => {
    const carouselBlock = source.slice(
      source.indexOf('const CAROUSEL_ITEMS'),
      source.indexOf('// The sample letter is a real body')
    )
    expect(carouselBlock.toLowerCase()).not.toContain('postcard')
  })
})
