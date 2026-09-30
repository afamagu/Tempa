'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { primaryButtonClass, quietLinkClass, helperTextClass } from '@/app/profile/ui'
import { isPlausibleDob, type DateOfBirth } from '@/lib/age'

const wordmarkClass = 'font-serif text-xs italic tracking-[0.2em] text-muted'
const headingClass = 'font-serif text-2xl font-medium text-foreground'
const bodyClass = 'text-sm leading-relaxed text-muted'

function parseIsoDate(isoDate: string): DateOfBirth {
  const [year, month, day] = isoDate.split('-').map(Number)
  return { year, month, day }
}

export default function BeginFlow({
  eligibilityStatus,
  stillBlocked,
  showLegalStep,
  signOutAction,
  eligibleOn,
}: {
  eligibilityStatus: 'eligible' | 'ineligible' | 'review_required' | null
  stillBlocked: boolean
  showLegalStep: boolean
  signOutAction: () => Promise<void>
  eligibleOn: string | null
}) {
  if (eligibilityStatus === 'ineligible' && stillBlocked) return <IneligibleTerminal signOutAction={signOutAction} eligibleOn={eligibleOn} />
  if (eligibilityStatus === 'review_required') return <ReviewTerminal signOutAction={signOutAction} />
  if (eligibilityStatus === 'eligible' && showLegalStep) return <LegalAcceptanceStep />
  return <DobStep />
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-background p-6"><div className="w-full max-w-sm space-y-6 py-10">{children}</div></main>
}

function useCalendarDate() {
  const t = useTranslations('Begin')
  const months = t.raw('months') as Record<string, string>
  return (dob: DateOfBirth) => t('dateFormat', { day: dob.day, month: months[String(dob.month)] ?? String(dob.month), year: dob.year })
}

function DobStep() {
  const t = useTranslations('Begin')
  const common = useTranslations('Common')
  const formatDate = useCalendarDate()
  const router = useRouter()
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [phase, setPhase] = useState<'entry' | 'confirm'>('entry')
  const [confirmedDob, setConfirmedDob] = useState<DateOfBirth | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const months = t.raw('months') as Record<string, string>

  function handleContinue(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const dayNum = Number(day), monthNum = Number(month), yearNum = Number(year)
    if (!day || !month || !year || !Number.isInteger(dayNum) || !Number.isInteger(monthNum) || !Number.isInteger(yearNum)) { setError(t('invalidDate')); return }
    const candidate: DateOfBirth = { year: yearNum, month: monthNum, day: dayNum }
    const now = new Date()
    const today: DateOfBirth = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
    if (!isPlausibleDob(candidate, today)) { setError(t('invalidDate')); return }
    setConfirmedDob(candidate)
    setPhase('confirm')
  }

  async function handleConfirm() {
    if (submitting || !confirmedDob) return
    setSubmitting(true); setError(null)
    const { error: rpcError } = await createClient().rpc('submit_dob_eligibility', { p_year: confirmedDob.year, p_month: confirmedDob.month, p_day: confirmedDob.day })
    if (rpcError) { setSubmitting(false); setError(t('invalidDate')); return }
    router.refresh()
  }

  if (phase === 'confirm' && confirmedDob) {
    return <Shell>
      <div className="space-y-2"><p className={wordmarkClass}>Tempa</p><h1 className={headingClass}>{t('checkDobHeading')}</h1><p className={bodyClass}>{t('youEntered', { date: formatDate(confirmedDob) })}</p><p className={bodyClass}>{t('checkCarefully')}</p></div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="space-y-3">
        <button type="button" onClick={handleConfirm} disabled={submitting} className={`w-full ${primaryButtonClass}`}>{submitting ? common('saving') : t('confirmDob')}</button>
        <button type="button" onClick={() => { setPhase('entry'); setError(null) }} disabled={submitting} className={quietLinkClass}>{t('goBackEdit')}</button>
      </div>
    </Shell>
  }

  return <Shell>
    <div className="space-y-2"><p className={wordmarkClass}>Tempa</p><h1 className={headingClass}>{t('dobHeading')}</h1><p className={bodyClass}>{t('dobIntro')}</p></div>
    <form onSubmit={handleContinue} className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5"><label htmlFor="dob-day" className="block text-[13px] font-medium text-foreground">{t('day')}</label><input id="dob-day" inputMode="numeric" autoComplete="bday-day" value={day} onChange={(e) => setDay(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} placeholder="13" className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2.5 text-[15px] outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/25" /></div>
        <div className="space-y-1.5"><label htmlFor="dob-month" className="block text-[13px] font-medium text-foreground">{t('month')}</label><select id="dob-month" autoComplete="bday-month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2.5 text-[15px] outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"><option value="" disabled>{t('month')}</option>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{months[String(n)]}</option>)}</select></div>
        <div className="space-y-1.5"><label htmlFor="dob-year" className="block text-[13px] font-medium text-foreground">{t('year')}</label><input id="dob-year" inputMode="numeric" autoComplete="bday-year" value={year} onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} placeholder="1990" className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2.5 text-[15px] outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/25" /></div>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <button type="submit" className={`w-full ${primaryButtonClass}`}>{common('continue')}</button>
    </form>
  </Shell>
}

function LegalAcceptanceStep() {
  const t = useTranslations('Begin')
  const common = useTranslations('Common')
  const router = useRouter()
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function handleContinue() {
    if (!agreed || submitting) return
    setSubmitting(true); setError(null)
    const { error: rpcError } = await createClient().rpc('accept_current_legal_documents')
    if (rpcError) { setSubmitting(false); setError(t('saveFailed')); return }
    router.refresh()
  }
  return <Shell>
    <div className="space-y-2"><p className={wordmarkClass}>Tempa</p><h1 className={headingClass}>{t('beforeBegin')}</h1><p className={bodyClass}>{t('legalIntro')}</p></div>
    <div className="space-y-4">
      <label className="flex items-start gap-3 text-[15px] text-foreground"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-foreground/30 text-accent focus-visible:ring-2 focus-visible:ring-accent/40" /><span>{t.rich('agreeLegal', { terms: (c) => <Link href="/terms" className={quietLinkClass} target="_blank" rel="noreferrer">{c}</Link>, guidelines: (c) => <Link href="/community-guidelines" className={quietLinkClass} target="_blank" rel="noreferrer">{c}</Link> })}</span></label>
      <p className={helperTextClass}>{t.rich('privacyExplainer', { privacy: (c) => <Link href="/privacy" className={quietLinkClass} target="_blank" rel="noreferrer">{c}</Link> })}</p>
      <p className={helperTextClass}>{t.rich('termsExplainer', { terms: (c) => <Link href="/terms" className={quietLinkClass} target="_blank" rel="noreferrer">{c}</Link> })}</p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <button type="button" onClick={handleContinue} disabled={!agreed || submitting} className={`w-full ${primaryButtonClass}`}>{submitting ? common('saving') : t('continueToTempa')}</button>
    </div>
  </Shell>
}

function SignOutLink({ signOutAction }: { signOutAction: () => Promise<void> }) { const t = useTranslations('Begin'); return <form action={signOutAction}><button type="submit" className={quietLinkClass}>{t('returnSignIn')}</button></form> }

function IneligibleTerminal({ signOutAction, eligibleOn }: { signOutAction: () => Promise<void>; eligibleOn: string | null }) {
  const t = useTranslations('Begin'); const formatDate = useCalendarDate()
  return <Shell><div className="space-y-2"><p className={wordmarkClass}>Tempa</p><h1 className={headingClass}>{t('adultsHeading')}</h1><p className={bodyClass}>{t('adultsOnly')}</p>{eligibleOn && <p className={bodyClass}>{t('returnOn', { date: formatDate(parseIsoDate(eligibleOn)) })}</p>}<p className={bodyClass}>{t('cannotAccessUntil')}</p></div><SignOutLink signOutAction={signOutAction} /></Shell>
}

function ReviewTerminal({ signOutAction }: { signOutAction: () => Promise<void> }) { const t = useTranslations('Begin'); return <Shell><div className="space-y-2"><p className={wordmarkClass}>Tempa</p><h1 className={headingClass}>{t('reviewHeading')}</h1><p className={bodyClass}>{t('reviewBody')}</p></div><SignOutLink signOutAction={signOutAction} /></Shell> }
