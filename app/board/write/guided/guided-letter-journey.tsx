'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { readDispatchDraft, writeDispatchDraft } from '@/lib/letter-editor-draft'
import {
  GUIDED_THEMES,
  assembleGuidedDraft,
  guidedDraftStorageKey,
  newGuidedProgress,
  normalizeGuidedProgress,
  type GuidedProgress,
  type GuidedThemeId,
} from '@/lib/guided-board-letter'
import { helperTextClass, primaryButtonClass, secondaryButtonClass, quietLinkClass } from '@/app/profile/ui'

export default function GuidedLetterJourney({ userId }: { userId: string }) {
  const router = useRouter()
  const [progress, setProgress] = useState<GuidedProgress | null>(null)
  const [existingDraft, setExistingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const storageKey = guidedDraftStorageKey(userId)

  useEffect(() => {
    // Restore from the browser where the existing Board composer also keeps drafts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExistingDraft(Boolean(readDispatchDraft(userId)))
    try {
      const raw = window.localStorage.getItem(storageKey)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgress(raw ? normalizeGuidedProgress(JSON.parse(raw)) : newGuidedProgress())
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgress(newGuidedProgress())
    }
  }, [storageKey, userId])

  const update = useCallback((next: GuidedProgress) => {
    setProgress(next)
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)) }
    catch { setError('Your browser cannot save these answers. Keep this page open until you finish.') }
  }, [storageKey])

  if (progress === null) return <main className="mx-auto max-w-xl px-5 py-20" role="status">Opening your writing space…</main>

  const selectedTheme = GUIDED_THEMES.find(t => t.id === progress.theme)
  const questions: readonly string[] = selectedTheme?.questions ?? [
    'What would you like someone to know?',
    'What made you think of it?',
    'What would you be curious to hear in return?',
  ]
  const assembled = assembleGuidedDraft(progress)

  function selectTheme(theme: GuidedThemeId) {
    setError(null)
    update({ theme, step: 0, answers: ['', '', ''] })
  }
  function answer(value: string) {
    const answers: GuidedProgress['answers'] = [...progress!.answers] as GuidedProgress['answers']
    answers[progress!.step] = value.slice(0, 1500)
    update({ ...progress!, answers })
  }
  function advance() { update({ ...progress!, step: Math.min(3, progress!.step + 1) }) }
  function retreat() { update({ ...progress!, step: Math.max(0, progress!.step - 1) }) }
  function openComposer() {
    if (busy || !assembled) return
    setBusy(true)
    try {
      // Never replace an existing draft, including a draft created in another tab.
      if (readDispatchDraft(userId)) {
        setExistingDraft(true)
        setError('You already have a saved letter. Open it first; we will not replace your words.')
        return
      }
      if (!writeDispatchDraft(userId, assembled)) {
        setError('Your browser could not save this letter. Try freeing browser storage, then continue.')
        return
      }
      try { window.localStorage.removeItem(storageKey) } catch { /* the actual editor draft is safe */ }
      router.push('/board/write')
    } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto flex min-h-[100svh] max-w-3xl flex-col px-5 pb-20 pt-12 sm:px-9 sm:pt-20">
      <Link href="/board" className="text-[15px] text-foreground/60 underline-offset-4 hover:underline">← The Board</Link>
      <div className="mt-12">
        <p className="text-[11px] font-semibold uppercase tracking-[.22em] text-[#94745f]">A LETTER FROM YOU</p>
        <h1 className="mt-4 font-serif text-[clamp(2.3rem,5vw,3.7rem)] leading-[1.12] tracking-[-.03em]">
          {existingDraft ? 'Your words are already waiting.' : progress.theme === null ? 'Every letter begins somewhere.' : progress.step === 3 ? 'You have something to say.' : 'Just a little at a time.'}
        </h1>
        <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-foreground/70">
          {existingDraft ? 'You have an unfinished letter. We will keep it exactly as you left it.' :
            progress.theme === null ? 'Choose a thought that feels familiar. You can change every word before it reaches The Board.' :
              progress.step === 3 ? 'These are your own words. Read them, then make them yours in the letter editor.' :
                'You do not need the perfect words. Start with what you remember.'}
        </p>
      </div>

      {existingDraft ? (
        <section className="mt-11 rounded-xl border border-foreground/10 bg-surface-shell px-6 py-7">
          <p className="font-serif text-xl">Continue the letter you began.</p>
          <Link className={`mt-6 ${primaryButtonClass}`} href="/board/write">Open my saved letter ↗</Link>
        </section>
      ) : progress.theme === null ? (
        <section className="mt-10 grid gap-3 sm:grid-cols-2" aria-label="Choose a letter beginning">
          {GUIDED_THEMES.map(theme => (
            <button key={theme.id} type="button" onClick={() => selectTheme(theme.id)} className="min-h-36 rounded-xl border border-foreground/15 bg-surface-shell p-5 text-left transition-colors hover:border-accent/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <span className="block font-serif text-[23px] leading-tight">{theme.label}</span>
              <span className="mt-3 block font-serif text-[15px] italic leading-relaxed text-foreground/65">{theme.beginning}</span>
            </button>
          ))}
          <button type="button" onClick={() => selectTheme('other')} className={`sm:col-span-2 ${secondaryButtonClass}`}>Something else ↗</button>
          <Link className={`sm:col-span-2 text-center ${quietLinkClass}`} href="/board/write">Or write freely in the letter editor</Link>
        </section>
      ) : progress.step < 3 ? (
        <section className="mt-10 max-w-xl rounded-xl border border-foreground/10 bg-surface-shell p-5 sm:p-8">
          <div className="flex items-center justify-between text-[12px] uppercase tracking-[.13em] text-foreground/50">
            <span>{selectedTheme?.label ?? 'Your own beginning'}</span>
            <span>{progress.step + 1} / 3</span>
          </div>
          <div className="mt-4 flex gap-1.5" aria-hidden="true">
            {[0,1,2].map(i => <span key={i} className={`h-1 flex-1 rounded ${i<=progress.step?'bg-accent':'bg-foreground/10'}`} />)}
          </div>
          <label htmlFor="guided-answer" className="mt-8 block font-serif text-[26px] leading-snug">{questions[progress.step]}</label>
          <textarea id="guided-answer" autoFocus rows={6} maxLength={1500} value={progress.answers[progress.step]} onChange={e=>answer(e.target.value)} placeholder="There’s no wrong way to answer…" className="mt-5 w-full resize-y rounded-md border border-foreground/20 bg-background px-4 py-3 font-serif text-[18px] leading-relaxed outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/20" />
          <p className={`mt-2 ${helperTextClass}`}>Private draft · nothing is published until you choose to publish.</p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <button type="button" onClick={advance} className={primaryButtonClass}>{progress.step === 2 ? 'Read my beginning' : 'Continue'} →</button>
            <button type="button" onClick={progress.step === 0 ? () => update({ ...progress, theme: null, step: 0 }) : retreat} className={quietLinkClass}>Back</button>
            <button type="button" onClick={advance} className={quietLinkClass}>Skip question</button>
          </div>
        </section>
      ) : (
        <section className="mt-10 max-w-2xl space-y-6">
          {assembled ? (
            <article className="rounded-xl border border-foreground/10 bg-surface-shell px-6 py-8 shadow-sm sm:px-9">
              <p className="text-[11px] uppercase tracking-[.18em] text-[#94745f]">YOUR DRAFT</p>
              <h2 className="mt-5 font-serif text-[29px]">{assembled.title}</h2>
              <div className="mt-6 space-y-4">
                {progress.answers.filter(a=>a.trim()).map((paragraph, index)=><p key={index} className="whitespace-pre-wrap font-serif text-[19px] leading-relaxed">{paragraph.trim()}</p>)}
              </div>
            </article>
          ) : <p className="text-[16px] text-foreground/70">A few of your own words are enough to begin. Go back and answer just one question.</p>}
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" disabled={!assembled || busy} onClick={openComposer} className={primaryButtonClass}>Edit and preview my letter ↗</button>
            <button type="button" onClick={retreat} className={quietLinkClass}>Change my answers</button>
          </div>
        </section>
      )}
      {error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
      <p className={`mt-12 max-w-xl ${helperTextClass}`}>The Board is a public place. Your letter stays private until you review and publish it.</p>
    </main>
  )
}
