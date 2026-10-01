'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { generateMarkV2, type MarkResult } from '@/lib/mark/mark-engine'
import {
  discardUploadedProfileMark,
  persistGeneratedMark,
  publicProfileMarkUrl,
  reserveProfileMark,
  validateGeneratedMarkPng,
  type ProfileMarkReservation,
} from '@/lib/profile-marks'
import { helperTextClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'

type Phase = 'loading' | 'choose' | 'generating' | 'reveal' | 'saving' | 'discarding'
const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024

export default function YourMarkStep({
  destination = '/profile/question',
  continueLabel,
}: {
  destination?: string
  continueLabel?: string
}) {
  const t = useTranslations('MarkOnboarding')
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('loading')
  const [reservation, setReservation] = useState<ProfileMarkReservation | null>(null)
  const [generated, setGenerated] = useState<MarkResult | null>(null)
  const [recoveredUrl, setRecoveredUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const revealHeadingRef = useRef<HTMLHeadingElement | null>(null)

  async function loadReservation() {
    setError(null)
    setPhase('loading')
    try {
      const supabase = createClient()
      const next = await reserveProfileMark(supabase)
      setReservation(next)
      if (next.uploaded) {
        setRecoveredUrl(publicProfileMarkUrl(supabase, next.objectName))
        setGenerated(null)
        setPhase('reveal')
      } else {
        setRecoveredUrl(null)
        setPhase('choose')
      }
    } catch {
      setError(t('prepareFailed'))
      setPhase('choose')
    }
  }

  useEffect(() => {
    void loadReservation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase === 'reveal') revealHeadingRef.current?.focus()
  }, [phase])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError(t('chooseImage'))
      return
    }
    if (file.size > MAX_SOURCE_FILE_BYTES) {
      setError(t('tooLarge'))
      return
    }

    setError(null)
    setPhase('generating')
    try {
      const result = await generateMarkV2(file)
      const validationError = validateGeneratedMarkPng(result.blob)
      if (validationError) throw new Error(validationError)
      setGenerated(result)
      setRecoveredUrl(null)
      setPhase('reveal')
    } catch {
      setGenerated(null)
      setError(t('findFailed'))
      setPhase('choose')
    }
  }

  async function handleContinue() {
    if (!reservation || (!reservation.uploaded && !generated) || phase === 'saving') return
    setError(null)
    setPhase('saving')
    try {
      const supabase = createClient()
      await persistGeneratedMark(supabase, generated?.blob ?? null, reservation)
      router.push(destination)
      router.refresh()
    } catch {
      setError(t('saveFailed'))
      router.refresh()
      try {
        const supabase = createClient()
        const recovered = await reserveProfileMark(supabase)
        setReservation(recovered)
        if (recovered.uploaded) setRecoveredUrl(publicProfileMarkUrl(supabase, recovered.objectName))
      } catch {
        // Preserve the reveal and original actionable error.
      }
      setPhase('reveal')
    }
  }

  async function handleChooseAnother() {
    if (phase === 'saving' || phase === 'discarding') return

    if (reservation?.uploaded) {
      setError(null)
      setPhase('discarding')
      try {
        const supabase = createClient()
        await discardUploadedProfileMark(supabase, reservation)
        const next = await reserveProfileMark(supabase)
        setReservation(next)
        setGenerated(null)
        setRecoveredUrl(null)
        setPhase('choose')
        requestAnimationFrame(() => inputRef.current?.click())
      } catch {
        setError(t('replaceFailed'))
        setPhase('reveal')
      }
      return
    }

    setGenerated(null)
    setRecoveredUrl(null)
    setError(null)
    setPhase('choose')
    requestAnimationFrame(() => inputRef.current?.click())
  }

  const markUrl = generated?.dataUrl ?? recoveredUrl
  const busy = phase === 'generating' || phase === 'saving' || phase === 'discarding'

  return (
    <main className="flex min-h-screen items-center justify-center p-6 sm:p-8">
      <div className="w-full max-w-md space-y-8 py-8 text-center sm:py-10">
        <div className="space-y-3">
          <p className="font-serif text-sm font-medium italic uppercase tracking-[0.22em] text-foreground/70 sm:text-[15px]">
            {t('label')}
          </p>
          {phase !== 'reveal' && phase !== 'saving' && phase !== 'discarding' && (
            <>
              <h1 className="font-serif text-2xl font-medium">{t('heading')}</h1>
              <p className={helperTextClass}>{t('intro')}</p>
              <p className="text-sm font-medium text-foreground">{t('privacy')}</p>
            </>
          )}
        </div>

        <div aria-live="polite" aria-atomic="true" className="min-h-5">
          {phase === 'loading' && <p className={helperTextClass}>{t('preparing')}</p>}
          {phase === 'generating' && <p className={helperTextClass}>{t('finding')}</p>}
          {phase === 'saving' && <p className={helperTextClass}>{t('saving')}</p>}
          {phase === 'discarding' && <p className={helperTextClass}>{t('preparingAnother')}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <input ref={inputRef} id="your-mark-photograph" type="file" accept="image/*" onChange={handleFile} disabled={busy} className="sr-only" />

        {(phase === 'choose' || phase === 'loading') && (
          <div className="space-y-3">
            <label htmlFor="your-mark-photograph" aria-disabled={busy} className={`${primaryButtonClass} ${busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
              {t('choosePhoto')}
            </label>
            {error && <button type="button" onClick={() => void loadReservation()} className={secondaryButtonClass}>{t('tryAgain')}</button>}
          </div>
        )}

        {markUrl && (phase === 'reveal' || phase === 'saving' || phase === 'discarding') && (
          <div className="space-y-8">
            <img src={markUrl} alt={t('imageAlt')} className="mx-auto aspect-square w-full max-w-[20rem] object-contain sm:max-w-[22.5rem]" />
            <div className="space-y-3">
              <h1 ref={revealHeadingRef} tabIndex={-1} className="font-serif text-3xl font-medium outline-none">{t('revealHeading')}</h1>
              <p className="text-[15px] leading-relaxed text-foreground/75">{t('revealBody')}</p>
              <p className="font-serif text-base font-medium">{t('revealClosing')}</p>
            </div>
            <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row">
              <button type="button" onClick={handleContinue} disabled={busy} className={primaryButtonClass}>{continueLabel ?? t('continue')}</button>
              <button type="button" onClick={handleChooseAnother} disabled={busy} className={secondaryButtonClass}>{t('chooseAnother')}</button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
