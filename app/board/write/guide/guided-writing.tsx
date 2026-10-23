'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEditorVisualViewport } from '@/app/letters/use-editor-visual-viewport'
import { useLocale } from 'next-intl'
import { GUIDED_WRITING_COPY, writingLocale } from '@/lib/guided-writing-copy'
import {
  WRITING_STARTERS, assembleGuidedLetter, canContinueGuidedWriting,
  guidedDraftDocument, type StarterId, type GuidedAnswers,
} from '@/lib/guided-open-letter'
import { readDispatchDraft, writeDispatchDraft } from '@/lib/letter-editor-draft'

const MAX_ANSWER_LENGTH = 1500
type Step = 'choose' | 'answer' | 'review'
const isStarter = (value: unknown): value is StarterId =>
  WRITING_STARTERS.some(starter => starter.id === value)
function guideKey(authorId: string) { return `tempa:guided-first-letter:${authorId}` }

export default function GuidedWriting({ authorId }: { authorId: string }) {
  const router = useRouter()
  const rootRef = useRef<HTMLElement | null>(null)
  useEditorVisualViewport(rootRef)
  const copy = GUIDED_WRITING_COPY[writingLocale(useLocale())]
  const [ready, setReady] = useState(false)
  const [step, setStep] = useState<Step>('choose')
  const [starterId, setStarterId] = useState<StarterId>('ordinary-day')
  const [answers, setAnswers] = useState<GuidedAnswers>(['', '', ''])
  const [promptIndex, setPromptIndex] = useState(0)
  const [existingDraft, setExistingDraft] = useState(false)
  const [replaceConfirmed, setReplaceConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      try {
      const raw = localStorage.getItem(guideKey(authorId))
      if (raw) {
        const data: unknown = JSON.parse(raw)
        if (data && typeof data === 'object') {
          const value = data as Record<string, unknown>
          if (isStarter(value.starter) && Array.isArray(value.answers) && value.answers.length === 3
              && value.answers.every(a => typeof a === 'string' && a.length <= MAX_ANSWER_LENGTH)) {
            setStarterId(value.starter)
            setAnswers(value.answers as unknown as GuidedAnswers)
            setPromptIndex(typeof value.index === 'number' && value.index >= 0 && value.index < 3 ? value.index : 0)
            setStep(value.step === 'review' || value.step === 'answer' ? value.step : 'choose')
          }
        }
      }
      setExistingDraft(Boolean(readDispatchDraft(authorId)))
    } catch { /* No storage available: do not pretend progress is durable. */ }
      setReady(true)
    })
    return () => { active = false }
  }, [authorId])
  useEffect(() => {
    if (!ready) return
    try { localStorage.setItem(guideKey(authorId), JSON.stringify({ starter: starterId, answers, index: promptIndex, step })) }
    catch { /* Report before leaving so a draft is not silently lost. */ }
  }, [authorId, ready, starterId, answers, promptIndex, step])

  const theme = copy.themes[starterId]
  const draft = assembleGuidedLetter(starterId, answers)

  function choose(id: StarterId) {
    setStarterId(id)
    setAnswers(['', '', ''])
    setPromptIndex(0)
    setError(null)
    setStep('answer')
  }
  function setAnswer(value: string) {
    setAnswers(current => [
      promptIndex === 0 ? value : current[0],
      promptIndex === 1 ? value : current[1],
      promptIndex === 2 ? value : current[2],
    ] as GuidedAnswers)
  }
  function next() {
    if (promptIndex < 2) { setPromptIndex(i => i + 1); return }
    if (!canContinueGuidedWriting(answers)) {
      setError(copy.minAnswer)
      return
    }
    setError(null)
    setStep('review')
  }
  function previous() {
    setError(null)
    if (promptIndex > 0) setPromptIndex(i => i - 1)
    else setStep('choose')
  }
  function importToComposer() {
    if (!ready || !canContinueGuidedWriting(answers)) return
    if (existingDraft && !replaceConfirmed) {
      setError(copy.existingError)
      return
    }
    const saved = writeDispatchDraft(authorId, {
      title: theme.draftTitle, doc: guidedDraftDocument(draft.paragraphs), topics: [],
    })
    if (!saved) {
      setError(copy.storageError)
      return
    }
    try { localStorage.removeItem(guideKey(authorId)) } catch {}
    router.push('/board/write')
  }

  return <main ref={rootRef} className="mx-auto min-h-[100svh] max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
    <div className="flex items-center justify-between gap-3">
      <Link href="/board" className="font-serif text-xl italic">Tempa<span className="text-[#a36a4d]">.</span></Link>
      <Link href="/board/write" className="min-h-11 content-center text-sm underline underline-offset-4">{copy.freely}</Link>
    </div>
    <div className="mt-12 border-b border-foreground/10 pb-6">
      <p className="text-xs uppercase tracking-[.22em] text-foreground/60">{copy.yourLetter} · {copy.stepNames[step === 'choose' ? 0 : step === 'answer' ? 1 : 2]}</p>
      <h1 className="mt-4 max-w-2xl font-serif text-[clamp(2.4rem,6vw,4rem)] leading-tight">
        {step === 'choose' ? copy.hChoose : step === 'answer' ? copy.hAnswer : copy.hReview}
      </h1>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-foreground/70">
        {step === 'choose' ? copy.dChoose
          : step === 'answer' ? copy.dAnswer
          : copy.dReview}
      </p>
    </div>
    {!ready && <p role="status" className="mt-10">{copy.openingSaved}</p>}
    {ready && step === 'choose' && <div className="mt-8 grid gap-3 sm:grid-cols-2">
      {WRITING_STARTERS.map(s => <button key={s.id} type="button" onClick={() => choose(s.id)}
        className="min-h-40 rounded-xl border border-foreground/15 bg-surface-shell p-5 text-left shadow-sm transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent">
        <span className="block font-serif text-2xl">{copy.themes[s.id].title}</span>
        <span className="mt-4 block text-sm leading-relaxed text-foreground/70">{copy.themes[s.id].opening}</span>
        <span aria-hidden="true" className="mt-4 block text-right">↗</span>
      </button>)}
      <Link className="flex min-h-28 items-center rounded-xl border border-dashed border-foreground/25 px-6 font-serif text-lg" href="/board/write">
        {copy.somethingElse} ↗
      </Link>
    </div>}
    {ready && step === 'answer' && <section className="mt-9">
      <p className="text-xs uppercase tracking-[.15em] text-foreground/55">{theme.title} · {promptIndex + 1} {copy.ofThree}</p>
      <label htmlFor="guided-answer" className="mt-4 block font-serif text-[clamp(1.7rem,4vw,2.5rem)] leading-tight">
        {theme.prompts[promptIndex]}
      </label>
      <textarea id="guided-answer" value={answers[promptIndex]} onChange={e => setAnswer(e.target.value)}
        maxLength={MAX_ANSWER_LENGTH} rows={6}
        className="mt-6 min-h-40 w-full resize-y rounded-xl border border-foreground/20 bg-surface-shell p-4 font-serif text-lg leading-relaxed focus:outline-2 focus:outline-accent"
        placeholder={copy.answerPlaceholder} />
      <p className="mt-2 text-right text-xs text-foreground/55">{answers[promptIndex].length} / {MAX_ANSWER_LENGTH}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button onClick={previous} className="min-h-11 rounded-md border border-foreground/20 px-5 py-3 text-sm">{copy.back}</button>
        <button onClick={next} className="min-h-11 rounded-md bg-accent px-6 py-3 text-sm text-accent-foreground">{promptIndex === 2 ? copy.seeLetter : copy.continue} →</button>
        {promptIndex < 2 && <button onClick={next} className="min-h-11 px-3 text-sm underline underline-offset-4">{copy.skip}</button>}
      </div>
    </section>}
    {ready && step === 'review' && <section className="mt-8 rounded-xl border border-foreground/15 bg-surface-shell px-6 py-8 shadow-sm sm:px-10">
      <h2 className="font-serif text-3xl">{theme.draftTitle}</h2>
      {draft.paragraphs.map((p,i)=><p className="mt-5 whitespace-pre-wrap font-serif text-lg leading-relaxed" key={i}>{p}</p>)}
      {existingDraft && !replaceConfirmed && <div className="mt-8 rounded-md border border-accent/30 bg-accent/[.05] p-4">
        <p className="text-sm leading-relaxed">{copy.existingWarning}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/board/write" className="min-h-11 content-center rounded-md border border-foreground/20 px-4 text-sm">{copy.continueSaved}</Link>
          <button type="button" onClick={()=>{setReplaceConfirmed(true);setError(null)}} className="min-h-11 rounded-md border border-foreground/20 px-4 text-sm">{copy.replace}</button>
        </div>
      </div>}
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={()=>{setStep('answer');setPromptIndex(0)}} className="min-h-11 rounded-md border border-foreground/20 px-5 py-3 text-sm">{copy.editAnswers}</button>
        <button type="button" onClick={importToComposer} disabled={existingDraft && !replaceConfirmed} className="min-h-11 rounded-md bg-accent px-6 py-3 text-sm text-accent-foreground disabled:opacity-40">
          {copy.editor} ↗
        </button>
      </div>
      <p className="mt-4 text-xs text-foreground/60">{copy.nothingPublished}</p>
    </section>}
    {error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
    <p className="mt-8 text-xs leading-relaxed text-foreground/55">{copy.deviceOnly}</p>
  </main>
}
