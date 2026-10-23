'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { IntroductionDialog } from '@/app/member-introductions'
import {
  loadFirstArrivalMatches,
  sessionIdFromAccessToken,
  type IntroductionCard,
} from '@/lib/member-introductions'
import { claimIntroductionVisit } from '@/lib/introduction-visit'
import { helperTextClass, primaryButtonClass, quietLinkClass } from '@/app/profile/ui'

const INTENTS = [
  ['friendship', 'Meaningful friendship'],
  ['correspondence', 'Long-term correspondence'],
  ['conversation', 'Thoughtful conversation'],
  ['culture', 'Cultural exchange'],
  ['everyday', 'Sharing everyday life'],
  ['language', 'Practising a language'],
  ['different', 'Meeting people different from me'],
  ['similar', 'Meeting people who think like me'],
  ['writing', 'Writing and self-expression'],
  ['serendipity', 'A little serendipity'],
] as const

type Phase = 'preferences' | 'loading' | 'cards' | 'invitation' | 'error'
const MAX_INTENTS = 3

export default function AutoMatchArrival({
  userId,
  initialIntent,
}: {
  userId: string
  initialIntent: string[]
}) {
  const t = useTranslations('AutoMatch')
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('preferences')
  const [selected, setSelected] = useState<string[]>(initialIntent.filter(value => INTENTS.some(i => i[1] === value)).slice(0, MAX_INTENTS))
  const [preferencesTouched, setPreferencesTouched] = useState(false)
  const [cards, setCards] = useState<IntroductionCard[]>([])
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noMatches, setNoMatches] = useState(false)

  const completeArrival = useCallback(async () => {
    const supabase = createClient()
    const { error: updateError } = await supabase.from('profiles')
      .update({ auto_match_completed_at: new Date().toISOString() })
      .eq('id', userId)
    if (updateError) throw new Error('Could not save your introduction progress.')
  }, [userId])

  function toggleIntent(value: string) {
    setPreferencesTouched(true)
    setSelected(current => current.includes(value)
      ? current.filter(item => item !== value)
      : current.length < MAX_INTENTS ? [...current, value] : current)
  }

  async function introductions(saveIntent: boolean) {
    if (busy) return
    setBusy(true)
    setPhase('loading')
    setError(null)
    try {
      const supabase = createClient()
      let preferencesNotSaved = false
      if (saveIntent && preferencesTouched && selected.join('|') !== initialIntent.join('|')) {
        const { error: preferenceError } = await supabase.from('profiles')
          .update({ intent: selected })
          .eq('id', userId)
        if (preferenceError) preferencesNotSaved = true
      }
      // Claim the normal introduction visit for this auth session. Otherwise
      // opening Board after this deck would trigger a second stranger overlay.
      const { data: sessionData } = await supabase.auth.getSession()
      const sessionId = sessionIdFromAccessToken(sessionData.session?.access_token)
      if (sessionId) {
        let storage: Storage | null = null
        try { storage = window.localStorage } catch { /* in-memory suppression */ }
        claimIntroductionVisit(storage, sessionId, Date.now())
      }
      const result = await loadFirstArrivalMatches(supabase)
      setCards(result)
      setIndex(0)
      setNoMatches(result.length === 0)
      // Optional preferences must not prevent reading introductions.
      setError(preferencesNotSaved && result.length > 0 ? t('preferencesWarning') : null)
      setPhase(result.length ? 'cards' : 'invitation')
    } catch {
      setError(t('loadingError'))
      setPhase('error')
    } finally {
      setBusy(false)
    }
  }

  async function finish(href: '/board' | '/board/write' | '/board/guided') {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await completeArrival()
    } catch {
      // Failing to persist a completion marker must never trap a member.
    }
    router.replace(href)
    router.refresh()
    setBusy(false)
  }

  const supabase = () => createClient()

  return (
    <main className="relative mx-auto flex min-h-[100svh] max-w-5xl flex-col justify-center px-5 py-12 sm:px-10 sm:py-20">
      <div className="mx-auto w-full max-w-3xl">
        <header className="max-w-2xl">
          <p className="font-serif text-xl italic text-foreground/75">Tempa<span className="text-[#a36a4d]">.</span></p>
          <p className="mt-10 text-[11px] font-semibold uppercase tracking-[.22em] text-[#94745f]">{phase === 'invitation' ? t('boardEyebrow') : t('eyebrow')}</p>
          <h1 className="mt-4 font-serif text-[clamp(2.4rem,6vw,4.3rem)] font-normal leading-[1.08] tracking-[-.035em] text-foreground">
            {phase === 'invitation' ? (noMatches ? t('emptyHeading') : t('inviteHeading')) : phase === 'cards' ? t('cardsHeading') : t('heading')}
          </h1>
          <p className="mt-5 max-w-xl font-serif text-[21px] leading-[1.5] text-foreground/80">
            {phase === 'invitation' ? (noMatches ? t('emptyLead') : t('inviteLead')) : phase === 'cards' ? t('cardsLead') : t('lead')}
          </p>
        </header>

        {phase === 'preferences' && (
          <section aria-labelledby="interests-title" className="mt-10 rounded-xl border border-foreground/10 bg-surface-shell/70 p-5 shadow-sm sm:p-8">
            <h2 id="interests-title" className="font-serif text-[25px]">{t('interestsHeading')}</h2>
            <p className={`mt-2 ${helperTextClass}`}>{t('interestsHelp')}</p>
            <div className="mt-6 flex flex-wrap gap-2.5" role="group" aria-label={t('interestsHeading')}>
              {INTENTS.map(([key, value]) => {
                const active = selected.includes(value)
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleIntent(value)}
                    className={`min-h-11 rounded-full border px-4 py-2.5 text-left text-[13px] leading-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${active ? 'border-accent bg-accent text-accent-foreground' : 'border-foreground/15 bg-background text-foreground/85 hover:border-accent/50'}`}
                  >
                    {t(`interests.${key}`)}
                  </button>
                )
              })}
            </div>
            <p className="mt-4 text-[12px] text-foreground/55">{t('selected', { current: selected.length })}</p>
            <div className="mt-7 flex flex-wrap items-center gap-5">
              <button type="button" disabled={busy} onClick={() => void introductions(true)} className={primaryButtonClass}>
                {t('showIntroductions')} <span aria-hidden="true">→</span>
              </button>
              <button type="button" disabled={busy} onClick={() => void introductions(false)} className={quietLinkClass}>
                {t('skipPreferences')}
              </button>
            </div>
          </section>
        )}

        {phase === 'loading' && (
          <div className="mt-12 flex items-center gap-4 border-t border-foreground/10 pt-7" role="status" aria-live="polite">
            <span className="h-3 w-3 animate-pulse rounded-full bg-accent motion-reduce:animate-none" aria-hidden="true" />
            <p className="font-serif text-lg text-foreground/70">{t('loading')}</p>
          </div>
        )}

        {phase === 'cards' && (
          <div className="mt-10 rounded-xl border border-accent/20 bg-accent/[.05] p-6 sm:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[.17em] text-[#94745f]">{t('introductionsHeading')}</p>
            <p className="mt-3 max-w-xl font-serif text-[20px] leading-relaxed text-foreground/80">{t('introductionsHelp')}</p>
            <p className={`mt-4 ${helperTextClass}`}>{t('openDeckHint')}</p>
          </div>
        )}

        {phase === 'invitation' && (
          <section className="mt-10 rounded-xl border border-accent/25 bg-surface-shell p-6 shadow-sm sm:p-9">
            <p className="text-[11px] font-semibold uppercase tracking-[.2em] text-[#94745f]">{t('boardEyebrow')}</p>
            <h2 className="mt-3 max-w-xl font-serif text-[30px] leading-[1.2]">{t('inviteTitle')}</h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-foreground/75">{t('inviteBody')}</p>
            <div className="mt-8 flex flex-wrap items-center gap-5">
              <button type="button" disabled={busy} onClick={() => void finish('/board/guided')} className={primaryButtonClass}>{t('helpStart')} <span aria-hidden="true">↗</span></button>
              <button type="button" disabled={busy} onClick={() => void finish('/board/write')} className={quietLinkClass}>{t('writeOwn')}</button>
              <button type="button" disabled={busy} onClick={() => void finish('/board')} className={quietLinkClass}>{t('maybeLater')}</button>
            </div>
          </section>
        )}

        {phase === 'error' && (
          <section className="mt-10 space-y-5 border-t border-foreground/10 pt-8">
            <p className="max-w-lg text-[15px] leading-relaxed text-foreground/75">{t('unable')}</p>
            <div className="flex flex-wrap items-center gap-5">
              <button type="button" disabled={busy} onClick={() => void introductions(false)} className={primaryButtonClass}>{t('retry')}</button>
              <button type="button" disabled={busy} onClick={() => void finish('/board')} className={quietLinkClass}>{t('continue')}</button>
            </div>
          </section>
        )}

        {error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
        {phase !== 'loading' && <p className="mt-7 text-[12px] leading-relaxed text-foreground/55">{t('noPressure')}</p>}
      </div>

      {phase === 'cards' && cards.length > 0 && (
        <IntroductionDialog
          cards={cards}
          index={index}
          onIndexChange={setIndex}
          onClose={() => { setError(null); setPhase('invitation') }}
          supabase={supabase}
          returnTo="/board"
          autoMatch
          onLeave={completeArrival}
        />
      )}
    </main>
  )
}
