'use client'

import { useState } from 'react'
import {
  sectionLabelClass,
  systemMarkerClass,
  systemBodyClass,
  proseHeadingClass,
  helperTextClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/app/profile/ui'
import SystemIntro from '@/app/profile/system-intro'
import LetterBody from '@/app/letters/[letterId]/letter-body'
import type { Moment } from '@/lib/moments'

const MOMENTS_MARKER = '⊕ Moments'
const TOTAL_SCREENS = 6

// Five ordinary-life categories for the "start with the world around
// you" carousel — deliberately not the chair (that's the sample
// letter's own Moment, just below in the flow, and repeating it here
// would undercut both). Each now points at its real supplied
// photograph (public/moments-guide/carousel/), used exactly as
// supplied — never retouched, re-cropped, or edited; ordinary
// responsive object-cover framing (see MomentsCarousel below) is the
// only "crop" ever applied, and it's incidental to the layout, never
// aimed at concealing anything in the source image.
const CAROUSEL_ITEMS = [
  { key: 'coffee', label: 'Morning coffee', src: '/moments-guide/carousel/morning-coffee.jpg' },
  { key: 'walk', label: 'A walk by the sea', src: '/moments-guide/carousel/walk-by-the-sea.jpg' },
  { key: 'pets', label: 'Little companions', src: '/moments-guide/carousel/little-companions.jpg' },
  { key: 'city', label: 'A night in the city', src: '/moments-guide/carousel/night-in-the-city.jpg' },
  { key: 'market', label: 'Market day', src: '/moments-guide/carousel/market-day.jpg' },
] as const

// A restrained editorial mark for Screen 2's open lower area — a fine
// hairline interrupted by the existing ⊕ glyph, in the spirit of a
// printer's ornament closing a section in a literary book. Purely
// decorative (aria-hidden): it adds no new information, just a quiet
// visual full stop under "Not attachments at the end. / Part of the
// story itself." No animation, no glow, no gradient, no illustration —
// deliberately the lowest-weight mark this design system has.
function EditorialOrnament() {
  return (
    <div className="mx-auto flex w-full max-w-[200px] items-center justify-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-foreground/12" />
      <span className="text-[13px] leading-none text-accent/80">⊕</span>
      <span className="h-px flex-1 bg-foreground/12" />
    </div>
  )
}

// Each tile is primarily photographic — the image fills the card via
// object-cover (never stretched/distorted, whatever the source photo's
// own orientation), with the label sitting in a small warm-paper
// (bg-background, this design system's own paper tone), translucent
// caption strip along the bottom rather than a dark scrim — deliberately
// not the Instagram/Reels gradient-and-white-text convention. Nothing
// here alters the supplied images themselves; only ordinary responsive
// framing.
function MomentsCarousel() {
  return (
    <div className="no-scrollbar -mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-1 sm:-mx-10 sm:px-10">
      {CAROUSEL_ITEMS.map((item) => (
        <div
          key={item.key}
          className="relative aspect-[3/4] w-[62%] shrink-0 snap-start overflow-hidden rounded-lg border border-foreground/12 sm:w-[36%]"
        >
          <img src={item.src} alt="" className="h-full w-full object-cover object-center" />
          <div className="absolute inset-x-0 bottom-0 border-t border-foreground/10 bg-background/90 px-3 py-2">
            <span className={sectionLabelClass}>{item.label}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// The sample letter is a real body + Moment[] pair, rendered through the
// SAME LetterBody the actual reader uses (app/letters/[letterId]/
// letter-body.tsx) — never a hand-rolled imitation. This is deliberate:
// the tutorial adapts to the production letter grammar, not the other
// way around, so the two can never quietly drift apart again. Photo
// Moments only — Postcards are no longer part of Moments (see the Build
// Guide's Moments/Postcards sections).
const SAMPLE_LETTER_PARAGRAPHS = [
  'I took the long way to get bread this morning.',
  "There's a little street near our house that runs down toward the water. I've walked it so many times that I usually don't notice it anymore.",
  'It had rained during the night, and for some reason I stopped today.',
  'You said something in your last letter about getting used to beautiful things. Maybe writing to someone far away makes you look at home differently.',
  'When I came back, my grandfather was sitting in the courtyard.',
  "That's his chair. It's older than I am, uncomfortable, and has been repaired more than once. We've tried replacing it.",
  'He says this one already knows how he likes to sit.',
  'I think I finally understand.',
]

const SAMPLE_LETTER_BODY = SAMPLE_LETTER_PARAGRAPHS.join('\n\n')

// Position is the 0-based paragraph-gap index LetterBody/lib/moments.ts's
// splitParagraphs already use — Moment 1 follows "the little street"
// paragraph (index 1); Moment 2 follows "my grandfather was sitting in
// the courtyard" (index 4). imageUrl points straight at the public
// sample asset — no signing is needed for a static tutorial image, and
// LetterBody never cares where imageUrl came from, only whether it's set.
const SAMPLE_LETTER_MOMENTS: Moment[] = [
  {
    id: 'sample-moment-street',
    position: 1,
    type: 'photo',
    imageUrl: '/moments-guide/sample-street.jpg',
    postcardKey: null,
  },
  {
    id: 'sample-moment-chair',
    position: 4,
    type: 'photo',
    imageUrl: '/moments-guide/sample-chair.jpg',
    postcardKey: null,
  },
]

// The system-voice screen shell: SystemIntro content plus a Back/Next
// button row. Every screen except the sample-letter screen (which has
// its own layout) uses this.
function Screen({
  children,
  onNext,
  onBack,
  nextLabel = 'Next',
}: {
  children: React.ReactNode
  onNext: () => void
  onBack?: () => void
  nextLabel?: string
}) {
  return (
    <div className="flex min-h-full flex-col justify-between p-6 sm:p-10">
      <div className="mx-auto w-full max-w-lg flex-1 space-y-8 py-10">{children}</div>
      <div className="mx-auto flex w-full max-w-lg gap-3 pb-4">
        {onBack && (
          <button type="button" onClick={onBack} className={secondaryButtonClass}>
            Back
          </button>
        )}
        <button type="button" onClick={onNext} className={primaryButtonClass}>
          {nextLabel}
        </button>
      </div>
    </div>
  )
}

function SampleLetterScreen({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-lg space-y-6">
          {/* Tempa interface/instruction copy — deliberately distinct
              (system marker, sans, compact) from the letter-reading
              surface below it, so the reader never mistakes this for
              part of the fictional letter itself. */}
          <div className="space-y-1.5 border-b border-foreground/10 pb-6">
            <p className={systemMarkerClass}>{MOMENTS_MARKER}</p>
            <p className={sectionLabelClass}>A sample letter with Moments</p>
            <p className={helperTextClass}>See how a photograph can live quietly inside a letter.</p>
            <p className={helperTextClass}>Tap a Moment to look closer.</p>
          </div>

          <p className={proseHeadingClass}>Morning from the Atlantic</p>

          <LetterBody body={SAMPLE_LETTER_BODY} moments={SAMPLE_LETTER_MOMENTS} />
        </div>
      </div>
      <div className="border-t border-foreground/10 px-6 py-4 sm:px-10">
        <div className="mx-auto flex w-full max-w-lg gap-3">
          <button type="button" onClick={onBack} className={secondaryButtonClass}>
            Back
          </button>
          <button type="button" onClick={onNext} className={primaryButtonClass}>
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The one-time, full-screen Moments walkthrough. Same content whether
 * it's showing automatically (first eligible correspondence entered) or
 * being replayed from You → Tempa Guide — neither path ever touches
 * correspondence or consent state — but the two contexts genuinely need
 * different exit/completion behavior, so the caller owns it explicitly
 * rather than one generic `onDone`:
 *
 * - `allowSkip` — false for the auto-triggered, first-time instance:
 *   this is a mandatory instructional sequence. There is no Close/X and
 *   no "Not now" in that mode — the ONLY way through is reaching the
 *   final screen's primary action. Leaving the app/browser mid-tutorial
 *   is naturally still possible (nothing here can prevent that), it
 *   just never marks anything complete, so it shows again next time.
 *   `allowSkip` is true only for the Tempa Guide replay, which already
 *   has nothing left to "complete" and may exit normally at any point.
 * - `onExit` — only used (and only needs to be passed) when
 *   `allowSkip` is true. Close (top-right) and "Not now" (screen 0).
 * - `finalLabel` + `onFinish` — the last screen's primary action, the
 *   only thing that ever marks the tutorial complete. Auto-trigger
 *   passes "Continue writing" and navigates into the actual reply
 *   opportunity that caused the tutorial to open; replay from Tempa
 *   Guide passes "Done" and just returns to the Guide.
 *
 * `otherPseudonym` personalizes the orientation screen when the
 * walkthrough is triggered from a real correspondence; pass null for
 * the Tempa Guide replay, which has no specific correspondence context.
 *
 * Visual refinement (2026-09-08): the platform-mascot pose art
 * (TempaPose) has been removed from this tutorial specifically — Moments
 * is a mature, editorial correspondence feature, not a mascot-led
 * onboarding moment. TempaPose itself is untouched and still shared by
 * the Minds walkthrough (app/guide/minds-walkthrough.tsx); this file
 * simply no longer imports or renders it. A quiet "N / 6" progress
 * label replaces it as the only orientation cue, restrained rather than
 * a dot/carousel-style progress treatment.
 */
export default function MomentsWalkthrough({
  allowSkip,
  onExit,
  finalLabel,
  onFinish,
  otherPseudonym,
}: {
  allowSkip: boolean
  onExit?: () => void
  finalLabel: string
  onFinish: () => void
  otherPseudonym: string | null
}) {
  const [screen, setScreen] = useState(0)

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex items-center justify-between px-6 pt-6 sm:px-10 sm:pt-8">
        <p className={sectionLabelClass}>
          {screen + 1} / {TOTAL_SCREENS}
        </p>
        {allowSkip && (
          <button type="button" onClick={onExit} aria-label="Close" className={helperTextClass}>
            Close
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {screen === 0 && (
          <Screen onNext={() => setScreen(1)} nextLabel="Show me">
            <SystemIntro
              marker={MOMENTS_MARKER}
              heading="Before your next letter"
              body={
                <>
                  <p>
                    {otherPseudonym
                      ? `You and ${otherPseudonym} have both chosen to continue writing.`
                      : 'When two people both choose to continue writing, this moment arrives.'}
                  </p>
                  <p>
                    Before you write your next letter, Tempa would like to show you Moments — a
                    way to let photographs become part of the story you&apos;re telling.
                  </p>
                  <p className="font-medium text-foreground">This will only take a moment.</p>
                </>
              }
            />
            {allowSkip && (
              <button type="button" onClick={onExit} className={`mt-2 ${helperTextClass} underline`}>
                Not now
              </button>
            )}
          </Screen>
        )}

        {screen === 1 && (
          <Screen onNext={() => setScreen(2)} onBack={() => setScreen(0)}>
            <div className="flex h-full flex-col justify-between gap-10">
              <SystemIntro
                marker={MOMENTS_MARKER}
                heading="A new way to write"
                body={
                  <>
                    <p>
                      Your letters can now carry Moments — photographs placed naturally within
                      the flow of your writing.
                    </p>
                    <p className="font-medium text-foreground">
                      Not attachments at the end.
                      <br />
                      Part of the story itself.
                    </p>
                  </>
                }
              />
              <EditorialOrnament />
            </div>
          </Screen>
        )}

        {screen === 2 && (
          <Screen onNext={() => setScreen(3)} onBack={() => setScreen(1)}>
            <SystemIntro
              heading="Let the picture belong to the story."
              body={
                <>
                  <p>
                    A Moment can be the street you walked down that morning. The meal you&apos;ve
                    been trying to perfect. Rain against your window. A place the other person may
                    never otherwise see.
                  </p>
                  <p>It doesn&apos;t have to be a photograph of you.</p>
                  <p>
                    Sometimes the smallest glimpse of someone&apos;s world says more than a
                    portrait ever could.
                  </p>
                  <p className="font-medium text-foreground">Show the life around the letter.</p>
                  <p className={helperTextClass}>Next, see what that looks like inside a letter.</p>
                </>
              }
            />
          </Screen>
        )}

        {screen === 3 && (
          <SampleLetterScreen onNext={() => setScreen(4)} onBack={() => setScreen(2)} />
        )}

        {screen === 4 && (
          <Screen onNext={() => setScreen(5)} onBack={() => setScreen(3)}>
            <SystemIntro
              heading="Start with the world around you."
              body={
                <>
                  <p>Moments are there to deepen a story, not to rush a correspondence.</p>
                  <p>
                    Share the places, objects and little pieces of life that help someone
                    understand what you mean.
                  </p>
                  <p>
                    Photographs of yourself, your family or the people close to you can come
                    later, when trust has grown naturally.
                  </p>
                  <p className={systemBodyClass}>
                    If you add a photo before photo sharing has begun, the other person
                    decides whether they&apos;d like to open it and begin exchanging photos.
                  </p>
                  <p className="font-medium text-foreground">Meet the mind before the person.</p>
                  <p className={helperTextClass}>It doesn&apos;t have to be extraordinary. Just real.</p>
                </>
              }
            />
            <MomentsCarousel />
          </Screen>
        )}

        {screen === 5 && (
          <Screen onNext={onFinish} onBack={() => setScreen(4)} nextLabel={finalLabel}>
            <SystemIntro
              heading="You're ready."
              body={
                <>
                  <p>While writing, look for ⊕ between your paragraphs.</p>
                  <p>Tap it whenever a Moment belongs there.</p>
                  <p className="font-medium text-foreground">Photo</p>
                  <p className={systemBodyClass}>
                    Choose a photograph from your library or take one with your camera.
                    <br />
                    The first Photo you send becomes a quiet invitation — the other person
                    decides whether to open it.
                  </p>
                  <p className={helperTextClass}>
                    You can revisit this guide anytime from You → Tempa Guide.
                  </p>
                </>
              }
            />
          </Screen>
        )}
      </div>
    </div>
  )
}
