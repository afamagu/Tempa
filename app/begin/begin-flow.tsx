'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { CURRENT_TERMS_VERSION, CURRENT_COMMUNITY_GUIDELINES_VERSION } from '@/lib/legal'
import { primaryButtonClass, quietLinkClass, helperTextClass } from '@/app/profile/ui'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const wordmarkClass = 'font-serif text-xs italic tracking-[0.2em] text-muted'
const headingClass = 'font-serif text-2xl font-medium text-foreground'
const bodyClass = 'text-sm leading-relaxed text-muted'

/**
 * Adult Eligibility + Legal Acceptance Gate — /begin's own client-side
 * flow. Renders exactly one of four states, decided by the SERVER
 * component (app/begin/page.tsx) from durable database state, never
 * from ephemeral React state: DOB entry, the under-18 terminal state,
 * a restrained under-review terminal state (scaffolding for a future
 * manual-review path — submit_dob_eligibility never sets this today),
 * or legal acceptance. Every transition between states is a
 * router.refresh() after a successful RPC call, letting the server
 * re-decide which state (or which real Tempa destination) comes next —
 * the same pattern this codebase already uses for WorthReadingButton,
 * ProfileForm, etc.
 */
export default function BeginFlow({
  eligibilityStatus,
  stillBlocked,
  showLegalStep,
  signOutAction,
}: {
  eligibilityStatus: 'eligible' | 'ineligible' | 'review_required' | null
  stillBlocked: boolean
  showLegalStep: boolean
  signOutAction: () => Promise<void>
}) {
  if (eligibilityStatus === 'ineligible' && stillBlocked) {
    return <IneligibleTerminal signOutAction={signOutAction} />
  }

  if (eligibilityStatus === 'review_required') {
    return <ReviewTerminal signOutAction={signOutAction} />
  }

  if (eligibilityStatus === 'eligible' && showLegalStep) {
    return <LegalAcceptanceStep />
  }

  return <DobStep />
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6 py-10">{children}</div>
    </main>
  )
}

function DobStep() {
  const router = useRouter()
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const dayNum = Number(day)
    const monthNum = Number(month)
    const yearNum = Number(year)

    if (!day || !month || !year || !Number.isInteger(dayNum) || !Number.isInteger(monthNum) || !Number.isInteger(yearNum)) {
      setError('Enter a valid date.')
      return
    }

    setSubmitting(true)
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('submit_dob_eligibility', {
      p_year: yearNum,
      p_month: monthNum,
      p_day: dayNum,
    })

    if (rpcError) {
      setSubmitting(false)
      // Never reveals WHY a date was rejected beyond this restrained
      // message — the server never teaches an underage visitor which
      // answer would pass.
      setError('Enter a valid date.')
      return
    }

    router.refresh()
  }

  return (
    <Shell>
      <div className="space-y-2">
        <p className={wordmarkClass}>Tempa</p>
        <h1 className={headingClass}>When were you born?</h1>
        <p className={bodyClass}>
          Your date of birth helps us make sure Tempa is right for you and keeps age information
          accurate.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="dob-day" className="block text-[13px] font-medium text-foreground">
              Day
            </label>
            <input
              id="dob-day"
              inputMode="numeric"
              autoComplete="bday-day"
              value={day}
              onChange={(e) => setDay(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
              placeholder="13"
              className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2.5 text-[15px] outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="dob-month" className="block text-[13px] font-medium text-foreground">
              Month
            </label>
            <select
              id="dob-month"
              autoComplete="bday-month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2.5 text-[15px] outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
            >
              <option value="" disabled>
                Month
              </option>
              {MONTHS.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="dob-year" className="block text-[13px] font-medium text-foreground">
              Year
            </label>
            <input
              id="dob-year"
              inputMode="numeric"
              autoComplete="bday-year"
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder="1990"
              className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2.5 text-[15px] outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className={`w-full ${primaryButtonClass}`}>
          {submitting ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </Shell>
  )
}

function LegalAcceptanceStep() {
  const router = useRouter()
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleContinue() {
    if (!agreed || submitting) return
    setSubmitting(true)
    setError(null)

    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('accept_current_legal_documents', {
      p_terms_version: CURRENT_TERMS_VERSION,
      p_community_guidelines_version: CURRENT_COMMUNITY_GUIDELINES_VERSION,
    })

    if (rpcError) {
      setSubmitting(false)
      setError('Could not save that right now. Please try again.')
      return
    }

    router.refresh()
  }

  return (
    <Shell>
      <div className="space-y-2">
        <p className={wordmarkClass}>Tempa</p>
        <h1 className={headingClass}>Before you begin</h1>
        <p className={bodyClass}>
          A few ground rules keep Tempa thoughtful, private where it should be, and safe for the
          people using it.
        </p>
      </div>

      <div className="space-y-4">
        <label className="flex items-start gap-3 text-[15px] text-foreground">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-foreground/30 text-accent focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          <span>
            I agree to the{' '}
            <Link href="/terms" className={quietLinkClass} target="_blank" rel="noreferrer">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/community-guidelines" className={quietLinkClass} target="_blank" rel="noreferrer">
              Community Guidelines
            </Link>
            .
          </span>
        </label>

        <p className={helperTextClass}>
          Our{' '}
          <Link href="/privacy" className={quietLinkClass} target="_blank" rel="noreferrer">
            Privacy Notice
          </Link>{' '}
          explains how Tempa handles your information.
        </p>

        <p className={helperTextClass}>
          The{' '}
          <Link href="/terms" className={quietLinkClass} target="_blank" rel="noreferrer">
            Terms
          </Link>{' '}
          include important provisions about responsibility for use of Tempa, limitations of
          liability, and indemnity.
        </p>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={!agreed || submitting}
          className={`w-full ${primaryButtonClass}`}
        >
          {submitting ? 'Saving…' : 'Continue to Tempa'}
        </button>
      </div>
    </Shell>
  )
}

/** Real sign-out (independent audit correction), not just a link to
 * /sign-in — a link alone left the session authenticated, so the very
 * next visit would just land back on this same terminal state. The
 * Server Action is created in app/begin/page.tsx and passed down;
 * copy stays exactly "Return to sign in" (the approved terminal-state
 * text), only the underlying action changed. */
function SignOutLink({ signOutAction }: { signOutAction: () => Promise<void> }) {
  return (
    <form action={signOutAction}>
      <button type="submit" className={quietLinkClass}>
        Return to sign in
      </button>
    </form>
  )
}

function IneligibleTerminal({ signOutAction }: { signOutAction: () => Promise<void> }) {
  return (
    <Shell>
      <div className="space-y-2">
        <p className={wordmarkClass}>Tempa</p>
        <h1 className={headingClass}>Tempa is for adults</h1>
        <p className={bodyClass}>You need to be at least 18 years old to create a Tempa profile.</p>
      </div>

      <SignOutLink signOutAction={signOutAction} />
    </Shell>
  )
}

function ReviewTerminal({ signOutAction }: { signOutAction: () => Promise<void> }) {
  return (
    <Shell>
      <div className="space-y-2">
        <p className={wordmarkClass}>Tempa</p>
        <h1 className={headingClass}>Your account is being reviewed</h1>
        <p className={bodyClass}>
          We&rsquo;ll let you know once this is resolved. Thank you for your patience.
        </p>
      </div>

      <SignOutLink signOutAction={signOutAction} />
    </Shell>
  )
}
