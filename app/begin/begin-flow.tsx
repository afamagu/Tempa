'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { primaryButtonClass, quietLinkClass, helperTextClass } from '@/app/profile/ui'
import { isPlausibleDob, type DateOfBirth } from '@/lib/age'

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

/** "14 March 2010" — day, full month name, year. Deliberately not
 * `new Date(...)`/`toLocaleDateString` (lib/format-date.ts's
 * formatters): a DOB (and eligible_on) is a calendar date, never a
 * moment in time, so there is no timezone to get wrong by routing it
 * through a Date object — same philosophy as lib/age.ts's own
 * DateOfBirth type. */
function formatCalendarDate(dob: DateOfBirth): string {
  return `${dob.day} ${MONTHS[dob.month - 1]} ${dob.year}`
}

/** Parses a Postgres `date` column value ("2028-03-14", no time
 * component) into the same plain calendar-date shape, for display only
 * — never re-derives or previews eligibility from it. */
function parseIsoDate(isoDate: string): DateOfBirth {
  const [year, month, day] = isoDate.split('-').map(Number)
  return { year, month, day }
}

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
  eligibleOn,
}: {
  eligibilityStatus: 'eligible' | 'ineligible' | 'review_required' | null
  stillBlocked: boolean
  showLegalStep: boolean
  signOutAction: () => Promise<void>
  eligibleOn: string | null
}) {
  if (eligibilityStatus === 'ineligible' && stillBlocked) {
    return <IneligibleTerminal signOutAction={signOutAction} eligibleOn={eligibleOn} />
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

/**
 * DOB entry → explicit confirmation → server submission (independent
 * product correction — a DOB must never reach submit_dob_eligibility
 * straight off the entry form; an ordinary typo would otherwise create
 * the irreversible under-18 lock immediately). `phase` is purely local
 * UI state — no RPC happens until Confirm, so there's nothing here for
 * a server round-trip to preempt; the day/month/year fields stay
 * populated across both phases since going back never clears them.
 * Client-side validation (isPlausibleDob, from lib/age.ts) is UX only,
 * exactly like before — the database remains the authoritative age
 * decision, and neither phase computes or reveals whether the entered
 * date is adult/minor before the RPC actually runs.
 */
function DobStep() {
  const router = useRouter()
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [phase, setPhase] = useState<'entry' | 'confirm'>('entry')
  const [confirmedDob, setConfirmedDob] = useState<DateOfBirth | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleContinue(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const dayNum = Number(day)
    const monthNum = Number(month)
    const yearNum = Number(year)

    if (!day || !month || !year || !Number.isInteger(dayNum) || !Number.isInteger(monthNum) || !Number.isInteger(yearNum)) {
      setError('Enter a valid date.')
      return
    }

    const candidate: DateOfBirth = { year: yearNum, month: monthNum, day: dayNum }
    const now = new Date()
    const today: DateOfBirth = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }

    if (!isPlausibleDob(candidate, today)) {
      // Calendar/plausibility check only (real date, not in the
      // future, not implausibly old) — never an adult/minor judgment.
      // This is UX only; submit_dob_eligibility re-validates the same
      // way server-side regardless.
      setError('Enter a valid date.')
      return
    }

    setConfirmedDob(candidate)
    setPhase('confirm')
  }

  function handleEdit() {
    setPhase('entry')
    setError(null)
  }

  async function handleConfirm() {
    if (submitting || !confirmedDob) return
    setSubmitting(true)
    setError(null)

    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('submit_dob_eligibility', {
      p_year: confirmedDob.year,
      p_month: confirmedDob.month,
      p_day: confirmedDob.day,
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

  if (phase === 'confirm' && confirmedDob) {
    return (
      <Shell>
        <div className="space-y-2">
          <p className={wordmarkClass}>Tempa</p>
          <h1 className={headingClass}>Check your date of birth</h1>
          <p className={bodyClass}>You entered {formatCalendarDate(confirmedDob)}.</p>
          <p className={bodyClass}>
            Please check it carefully. Once you confirm your date of birth, you won&rsquo;t be able
            to change it through this age check.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className={`w-full ${primaryButtonClass}`}
          >
            {submitting ? 'Saving…' : 'Confirm date of birth'}
          </button>
          <button
            type="button"
            onClick={handleEdit}
            disabled={submitting}
            className={quietLinkClass}
          >
            Go back and edit
          </button>
        </div>
      </Shell>
    )
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

      <form onSubmit={handleContinue} className="space-y-5">
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

        <button type="submit" className={`w-full ${primaryButtonClass}`}>
          Continue
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

    // LEGAL VERSION AUTHORITY CORRECTION (independent audit
    // correction): this RPC takes NO version arguments — the accepted
    // version strings are server-side SQL constants, never
    // client-supplied, so an authenticated caller can no longer choose
    // or influence which version gets recorded. See docs/sql/2026-09-
    // 21-adult-eligibility-and-legal-acceptance.sql's own "LEGAL
    // VERSION AUTHORITY CORRECTION" header note.
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('accept_current_legal_documents')

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

/**
 * Never adds a retry/change-DOB/appeal affordance of any kind — the
 * confirmation step (DobStep, above) exists to prevent ordinary typos
 * BEFORE this durable lock is created; once it exists, the only way
 * out is time (eligible_on) or contacting support outside this flow
 * entirely. `eligibleOn` is the server's own persisted date — this
 * component only ever displays it, never computes or previews it.
 */
function IneligibleTerminal({
  signOutAction,
  eligibleOn,
}: {
  signOutAction: () => Promise<void>
  eligibleOn: string | null
}) {
  return (
    <Shell>
      <div className="space-y-2">
        <p className={wordmarkClass}>Tempa</p>
        <h1 className={headingClass}>Tempa is for adults</h1>
        <p className={bodyClass}>Tempa is only available to people who are 18 or older.</p>
        {eligibleOn && (
          <p className={bodyClass}>You can return to Tempa on {formatCalendarDate(parseIsoDate(eligibleOn))}.</p>
        )}
        <p className={bodyClass}>Until then, this account cannot access Tempa.</p>
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
