'use client'

import { useState } from 'react'
import { helperTextClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'
import SystemIntro from '@/app/profile/system-intro'
import TempaPose from '@/app/tempa-pose'

const MINDS_MARKER = '◎ People'

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
      <div className="mx-auto w-full max-w-lg flex-1 space-y-6 py-10">{children}</div>
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

/**
 * The one-time Minds orientation — concise, three screens, separate
 * from the Moments guide entirely (own guide_key, own completion
 * tracking; see lib/guide.ts). Unlike the Moments walkthrough, this
 * isn't gating a decision the member is about to make — it's a short
 * introduction — so it allows a normal Close/skip at any point; `onExit`
 * and `onFinish` both simply mark it complete and are otherwise
 * interchangeable here.
 */
export default function MindsWalkthrough({
  onExit,
  onFinish,
}: {
  onExit: () => void
  onFinish: () => void
}) {
  const [screen, setScreen] = useState(0)

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex justify-end px-4 pt-4 sm:px-6">
        <button type="button" onClick={onExit} aria-label="Close" className={helperTextClass}>
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {screen === 0 && (
          <Screen onNext={() => setScreen(1)}>
            <TempaPose pose="welcome" />
            <SystemIntro
              marker={MINDS_MARKER}
              heading="Welcome to People"
              body={
                <>
                  <p>
                    People is where you discover one another through what you think, not how you
                    look.
                  </p>
                  <p className="font-medium text-foreground">
                    Answer a Question to give other people something meaningful to discover about
                    you.
                  </p>
                </>
              }
            />
          </Screen>
        )}

        {screen === 1 && (
          <Screen onNext={() => setScreen(2)} onBack={() => setScreen(0)}>
            <SystemIntro
              heading="Explore and My answers"
              body={
                <>
                  <p>
                    <span className="font-medium text-foreground">Explore</span> shows other
                    members&apos; current answers — a glimpse of how they think, before you decide
                    whether to write.
                  </p>
                  <p>
                    <span className="font-medium text-foreground">My answers</span> holds
                    everything you&apos;ve published. Only one of your answers appears in People at
                    a time, and you choose which one represents you.
                  </p>
                </>
              }
            />
          </Screen>
        )}

        {screen === 2 && (
          <Screen onNext={onFinish} onBack={() => setScreen(1)} nextLabel="Done">
            <TempaPose pose="ready" />
            <SystemIntro
              heading="Answer a Question"
              body={
                <>
                  <p>
                    Three Questions are offered at a time, drawn from different kinds of
                    reflection. Answer whichever gives you the best opportunity to express
                    yourself.
                  </p>
                  <p className={helperTextClass}>You can revisit this anytime from You → Tempa Guide.</p>
                </>
              }
            />
          </Screen>
        )}
      </div>
    </div>
  )
}
