'use client'

import { useState } from 'react'
import { WRITING_STYLE_LIST, type WritingStyleId } from '@/lib/writing-style'
import LetterBody from '@/app/letters/[letterId]/letter-body'
import DispatchBody from '@/app/board/dispatch-body'
import AuthoredProse from '@/app/authored-prose'
import WritingStyleChooser from '@/app/writing-style-chooser'
import { contextQuestionClass, helperTextClass, metadataTextClass, pillClass } from '@/app/profile/ui'
import { SPECIMEN_GLYPHS, SPECIMEN_LETTER, SPECIMEN_PASSAGE, SPECIMEN_SHORT } from './specimen-text'

const SPECIMEN_CHOOSER_SAMPLE = SPECIMEN_PASSAGE.split('\n\n').slice(0, 2).join('\n\n')

type Sample = 'letter' | 'passage' | 'short' | 'glyphs' | 'chooser'

const SAMPLES: { id: Sample; label: string }[] = [
  { id: 'letter', label: 'Letter (~1,000 words)' },
  { id: 'passage', label: 'Dispatch (~250 words)' },
  { id: 'short', label: 'Short answer' },
  { id: 'glyphs', label: 'Glyph coverage' },
  { id: 'chooser', label: 'Chooser' },
]

const ROWS: { id: WritingStyleId | null; label: string }[] = [
  { id: null, label: 'Tempa (canonical / Reader view / legacy)' },
  ...WRITING_STYLE_LIST.map((s) => ({ id: s.id, label: `${s.name} — ${s.face}` })),
]

export default function WritingStyleSpecimen() {
  const [sample, setSample] = useState<Sample>('letter')
  const [only, setOnly] = useState<WritingStyleId | 'all' | 'tempa'>('all')
  const rows = ROWS.filter((r) => only === 'all' || (only === 'tempa' ? r.id === null : r.id === only))

  return (
    <main className="min-h-screen bg-surface-shell px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-3">
          <p className={metadataTextClass}>Development only · Writing Style specimen</p>
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <button key={s.id} type="button" className={pillClass(sample === s.id)} onClick={() => setSample(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(['all', 'tempa', ...WRITING_STYLE_LIST.map((s) => s.id)] as const).map((id) => (
              <button key={id} type="button" className={pillClass(only === id)} onClick={() => setOnly(id)}>
                {id}
              </button>
            ))}
          </div>
        </header>

        {sample === 'chooser' && (
          <div className="rounded-md bg-background px-4 py-8 sm:px-8">
            <WritingStyleChooser
              mode="onboarding"
              heading="Give your words a shape."
              intro="Choose how your writing appears when it reaches someone."
              sample={SPECIMEN_CHOOSER_SAMPLE}
              sampleIsOwn
            />
          </div>
        )}

        {sample !== 'chooser' && rows.map((row) => (
          <section key={row.id ?? 'tempa'} className="space-y-2" data-specimen={row.id ?? 'tempa'}>
            <p className={helperTextClass}>{row.label}</p>

            {sample === 'letter' && (
              <div className="rounded-md bg-background p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[15px] font-semibold text-foreground">Tomás</p>
                    <p className={metadataTextClass}>to Mia</p>
                  </div>
                  <span className={metadataTextClass}>29 Sep 2026, 18:04</span>
                </div>
                <div className="mt-4">
                  <LetterBody body={SPECIMEN_LETTER} moments={[]} writingStyleId={row.id} />
                </div>
              </div>
            )}

            {sample === 'passage' && (
              <div className="space-y-4 rounded-md bg-background p-5 sm:p-6">
                <p className="text-[20px] font-semibold leading-snug text-foreground">A list of small things</p>
                <div className="rounded-md bg-surface-shell p-4 sm:p-6">
                  <DispatchBody body={SPECIMEN_PASSAGE} moments={[]} writingStyleId={row.id} />
                </div>
              </div>
            )}

            {sample === 'short' && (
              <div className="rounded-md border border-foreground/10 bg-background p-4">
                <p className={contextQuestionClass}>Where did you learn something that stayed with you?</p>
                <div className="mt-3 rounded-md bg-surface-shell p-4">
                  <AuthoredProse styleId={row.id}>
                    <p className="line-clamp-4 whitespace-pre-wrap">{SPECIMEN_SHORT}</p>
                  </AuthoredProse>
                </div>
              </div>
            )}

            {sample === 'glyphs' && (
              <div className="rounded-md bg-background p-5">
                <AuthoredProse styleId={row.id}>
                  <p className="whitespace-pre-wrap">{SPECIMEN_GLYPHS}</p>
                </AuthoredProse>
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  )
}
