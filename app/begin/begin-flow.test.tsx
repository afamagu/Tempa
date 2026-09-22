import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import BeginFlow from './begin-flow'

// /begin has no test file's own established render harness yet — same
// SSR-only limitation as every other interactive client component in
// this codebase (see board-feed.test.tsx's own doc comment): no
// jsdom, no @testing-library/react anywhere in this repo. DobStep and
// LegalAcceptanceStep both call useRouter() (needed for the
// refresh-after-submit behavior), which throws outside a real Next.js
// App Router context — renderToStaticMarkup cannot render them at all,
// the same reason app/profile/profile-form.test.tsx (also useRouter-
// based) never renders ProfileForm and instead only exercises its
// extracted pure validateRequiredFields function. Following that same
// precedent: the two useRouter-free TERMINAL states (ineligible,
// review_required) are proven with a real render; the DOB and legal-
// acceptance states, and every RPC/interaction behavior, are proven
// via precise, scoped source-text inspection of the actual shipped
// implementation instead.

const source = readFileSync(path.join(__dirname, 'begin-flow.tsx'), 'utf8')

describe('BeginFlow — top-level state dispatch (source inspection: which child component each prop combination selects)', () => {
  it('renders IneligibleTerminal only when ineligible AND stillBlocked', () => {
    const dispatchStart = source.indexOf('export default function BeginFlow')
    const dispatchEnd = source.indexOf('\nfunction Shell')
    const body = source.slice(dispatchStart, dispatchEnd)
    expect(body).toContain("eligibilityStatus === 'ineligible' && stillBlocked")
    expect(body).toContain('<IneligibleTerminal signOutAction={signOutAction} eligibleOn={eligibleOn} />')
  })

  it('renders ReviewTerminal only when review_required', () => {
    const dispatchStart = source.indexOf('export default function BeginFlow')
    const dispatchEnd = source.indexOf('\nfunction Shell')
    const body = source.slice(dispatchStart, dispatchEnd)
    expect(body).toContain("eligibilityStatus === 'review_required'")
    expect(body).toContain('<ReviewTerminal signOutAction={signOutAction} />')
  })

  it('renders LegalAcceptanceStep only when eligible AND showLegalStep', () => {
    const dispatchStart = source.indexOf('export default function BeginFlow')
    const dispatchEnd = source.indexOf('\nfunction Shell')
    const body = source.slice(dispatchStart, dispatchEnd)
    expect(body).toContain("eligibilityStatus === 'eligible' && showLegalStep")
    expect(body).toContain('<LegalAcceptanceStep />')
  })

  it('falls through to DobStep for every other combination (null, or ineligible-but-no-longer-blocked) — never a blank/undefined state', () => {
    const dispatchStart = source.indexOf('export default function BeginFlow')
    const dispatchEnd = source.indexOf('\nfunction Shell')
    const body = source.slice(dispatchStart, dispatchEnd)
    const lastReturn = body.lastIndexOf('return')
    expect(body.slice(lastReturn)).toContain('<DobStep />')
  })
})

describe('BeginFlow — terminal states (real render: neither uses useRouter)', () => {
  // A plain async function stands in for the real Server Action
  // (created in app/begin/page.tsx) — renderToStaticMarkup only needs
  // a function reference to serialize the form's action binding; it is
  // never actually invoked during a render-only test.
  const noopSignOutAction = async () => {}

  it('ineligible terminal state renders the exact approved copy, the persisted eligible_on, no retry affordance, and a real sign-out form (not a bare link)', () => {
    const html = renderToStaticMarkup(
      <BeginFlow
        eligibilityStatus="ineligible"
        stillBlocked={true}
        showLegalStep={false}
        signOutAction={noopSignOutAction}
        eligibleOn="2028-03-14"
      />
    )
    expect(html).toContain('Tempa is for adults')
    expect(html).toContain('Tempa is only available to people who are 18 or older.')
    // The server's own persisted eligible_on, displayed verbatim in
    // human-readable form ("14 March 2028", not "2028-03-14" or a
    // locale-dependent short form).
    expect(html).toContain('You can return to Tempa on 14 March 2028.')
    expect(html).toContain('Until then, this account cannot access Tempa.')
    expect(html).toContain('Return to sign in')
    // No retry/change-DOB/appeal/contact-support affordance of any
    // kind — an under-18 result must not read as "wrong answer, try
    // again," and there is no shortcut back around eligible_on.
    expect(html).not.toMatch(/change (your )?birthday/i)
    expect(html).not.toMatch(/try again/i)
    expect(html).not.toMatch(/appeal/i)
    expect(html).not.toMatch(/contact support/i)
    expect(html).not.toContain('When were you born?')
    expect(html).not.toContain('Confirm date of birth')
    expect(html).not.toContain('Go back and edit')
    // A real sign-out form, not a plain <a href="/sign-in"> link —
    // independent audit correction: a bare link left the session
    // authenticated, so the next visit just landed back on this same
    // terminal state.
    expect(html).toContain('<form')
    expect(html).not.toContain('<a href="/sign-in"')
  })

  it('ineligible terminal state renders gracefully with no eligible_on line when eligibleOn is null', () => {
    const html = renderToStaticMarkup(
      <BeginFlow
        eligibilityStatus="ineligible"
        stillBlocked={true}
        showLegalStep={false}
        signOutAction={noopSignOutAction}
        eligibleOn={null}
      />
    )
    expect(html).toContain('Tempa is for adults')
    expect(html).not.toContain('You can return to Tempa on')
  })

  it('review-required terminal state renders distinct copy from the ineligible state, also with a real sign-out form', () => {
    const html = renderToStaticMarkup(
      <BeginFlow
        eligibilityStatus="review_required"
        stillBlocked={false}
        showLegalStep={false}
        signOutAction={noopSignOutAction}
        eligibleOn={null}
      />
    )
    expect(html).toContain('being reviewed')
    expect(html).not.toContain('Tempa is for adults')
    expect(html).toContain('Return to sign in')
    expect(html).toContain('<form')
    expect(html).not.toContain('<a href="/sign-in"')
  })
})

describe('BeginFlow — sign-out contract (source inspection)', () => {
  const fnStart = source.indexOf('function SignOutLink')
  const fnEnd = source.indexOf('\nfunction IneligibleTerminal')
  const body = source.slice(fnStart, fnEnd)

  it('SignOutLink renders a <form action={signOutAction}> around a submit button — a real Server Action, never a client-side link', () => {
    expect(body).toContain('<form action={signOutAction}>')
    expect(body).toContain('type="submit"')
    expect(body).not.toContain('href="/sign-in"')
  })

  it('both terminal states use SignOutLink, passing through the signOutAction prop they each receive', () => {
    const ineligibleStart = source.indexOf('function IneligibleTerminal')
    const ineligibleEnd = source.indexOf('\nfunction ReviewTerminal')
    const ineligibleBody = source.slice(ineligibleStart, ineligibleEnd)
    expect(ineligibleBody).toContain('<SignOutLink signOutAction={signOutAction} />')

    const reviewStart = source.indexOf('function ReviewTerminal')
    const reviewBody = source.slice(reviewStart)
    expect(reviewBody).toContain('<SignOutLink signOutAction={signOutAction} />')
  })

  it('the copy stays exactly "Return to sign in" — only the underlying action changed, not the approved terminal-state text', () => {
    expect(body).toContain('Return to sign in')
  })
})

describe('BeginFlow — DOB step (source inspection)', () => {
  const fnStart = source.indexOf('function DobStep')
  const fnEnd = source.indexOf('\nfunction LegalAcceptanceStep')
  const body = source.slice(fnStart, fnEnd)

  // Isolate each named handler's own body so RPC/state-mutation
  // assertions can be scoped precisely to "what Continue does" vs.
  // "what Confirm does" vs. "what Go back and edit does" — the whole
  // point of this checkpoint is that those three are no longer the
  // same thing.
  const continueStart = body.indexOf('function handleContinue')
  const continueEnd = body.indexOf('function handleEdit')
  const handleContinueBody = body.slice(continueStart, continueEnd)

  const editStart = body.indexOf('function handleEdit')
  const editEnd = body.indexOf('async function handleConfirm')
  const handleEditBody = body.slice(editStart, editEnd)

  const confirmFnStart = body.indexOf('async function handleConfirm')
  const confirmFnEnd = body.indexOf("if (phase === 'confirm'")
  const handleConfirmBody = body.slice(confirmFnStart, confirmFnEnd)

  const confirmRenderStart = body.indexOf("if (phase === 'confirm'")
  const confirmRenderEnd = body.indexOf('\n  return (\n    <Shell>\n      <div className="space-y-2">\n        <p className={wordmarkClass}>Tempa</p>\n        <h1 className={headingClass}>When were you born?')
  const confirmRenderBody = body.slice(confirmRenderStart, confirmRenderEnd)

  it('uses the approved heading/body copy, never asks "are you 18?" or reveals the cutoff', () => {
    expect(body).toContain('When were you born?')
    expect(body).toContain(
      'Your date of birth helps us make sure Tempa is right for you and keeps age information'
    )
    const lower = body.toLowerCase()
    expect(lower).not.toContain('are you 18')
    expect(lower).not.toContain('18+')
    expect(lower).not.toMatch(/before \d{4}/)
  })

  it('month is selected by name, not an ambiguous numeric format', () => {
    expect(body).toContain('MONTHS')
    expect(body).toContain('<option key={name} value={i + 1}>')
  })

  it('1. pressing Continue (handleContinue, the form onSubmit) never calls submit_dob_eligibility', () => {
    expect(handleContinueBody).not.toContain("supabase.rpc('submit_dob_eligibility'")
    expect(handleContinueBody).not.toContain('createClient()')
  })

  it('2. a valid DOB moves to the confirm phase — never straight to a server call', () => {
    expect(handleContinueBody).toContain("setConfirmedDob(candidate)")
    expect(handleContinueBody).toContain("setPhase('confirm')")
  })

  it('6. invalid/implausible calendar dates never reach the confirm phase — reuses lib/age.ts\'s isPlausibleDob rather than re-deriving validation', () => {
    expect(source).toContain("import { isPlausibleDob, type DateOfBirth } from '@/lib/age'")
    expect(handleContinueBody).toContain('isPlausibleDob(candidate, today)')
    // The setPhase('confirm')/setConfirmedDob calls must be textually
    // AFTER the isPlausibleDob guard, not before it.
    const guardPos = handleContinueBody.indexOf('isPlausibleDob(candidate, today)')
    const advancePos = handleContinueBody.indexOf("setPhase('confirm')")
    expect(guardPos).toBeGreaterThan(-1)
    expect(advancePos).toBeGreaterThan(guardPos)
  })

  it('does not compute or preview adult/minor status before confirmation — no isAdultOn/calculateAge call in the entry handler', () => {
    expect(handleContinueBody).not.toContain('isAdultOn')
    expect(handleContinueBody).not.toContain('calculateAge')
  })

  it('4. Go back and edit only switches phase back to entry — never clears day/month/year, so the entered values are preserved', () => {
    expect(handleEditBody).toContain("setPhase('entry')")
    expect(handleEditBody).not.toContain("setDay(")
    expect(handleEditBody).not.toContain("setMonth(")
    expect(handleEditBody).not.toContain("setYear(")
  })

  it('7. handleConfirm guards against double submission — a second call while already submitting, or with no confirmed DOB, is a no-op', () => {
    expect(handleConfirmBody).toContain('if (submitting || !confirmedDob) return')
  })

  it('5. only handleConfirm calls submit_dob_eligibility, using the CONFIRMED date fields, never a boolean eligibility claim from the client', () => {
    expect(handleConfirmBody).toContain("supabase.rpc('submit_dob_eligibility'")
    expect(handleConfirmBody).toContain('p_year: confirmedDob.year')
    expect(handleConfirmBody).toContain('p_month: confirmedDob.month')
    expect(handleConfirmBody).toContain('p_day: confirmedDob.day')
    expect(handleConfirmBody).not.toMatch(/eligible\s*:\s*true/)
    expect(handleConfirmBody).not.toMatch(/isAdult\s*:\s*true/)
  })

  it('a rejected/invalid DOB shows only "Enter a valid date." — never teaches which date would pass', () => {
    expect(body).toContain("setError('Enter a valid date.')")
    expect(body).not.toMatch(/\b18\b/)
    expect(body).not.toMatch(/before \d{4}/i)
  })

  it('a successful confirmation calls router.refresh(), never a hardcoded client-side redirect to a specific next state', () => {
    expect(handleConfirmBody).toContain('router.refresh()')
    expect(body).not.toContain('router.push(')
  })

  it('3. the confirm phase displays the exact entered date via formatCalendarDate(confirmedDob), in the approved "You entered ..." copy', () => {
    expect(confirmRenderBody).toContain('Check your date of birth')
    expect(confirmRenderBody).toContain('You entered {formatCalendarDate(confirmedDob)}.')
    expect(confirmRenderBody).toContain('Please check it carefully.')
    expect(confirmRenderBody).toContain("you won&rsquo;t be able")
    expect(confirmRenderBody).toContain('to change it through this age check.')
    // formatCalendarDate itself renders day, full month name, year —
    // "14 March 2010", not an ISO/locale-ambiguous form.
    const formatterStart = source.indexOf('function formatCalendarDate')
    const formatterEnd = source.indexOf('\nfunction parseIsoDate')
    const formatterBody = source.slice(formatterStart, formatterEnd)
    expect(formatterBody).toContain('${dob.day} ${MONTHS[dob.month - 1]} ${dob.year}')
  })

  it('does not calculate or display whether the DOB is adult/minor on the confirm screen — no age/eligibility preview', () => {
    expect(confirmRenderBody).not.toMatch(/\b1[3-9]\b/) // no bare "16", "17", "18" etc. age callouts
    expect(confirmRenderBody).not.toMatch(/this makes you/i)
    expect(confirmRenderBody).not.toContain('isAdultOn')
    expect(confirmRenderBody).not.toContain('calculateAge')
  })

  it('the confirm phase has exactly the two specified actions — Confirm date of birth (primary) and Go back and edit (secondary)', () => {
    expect(confirmRenderBody).toContain('Confirm date of birth')
    expect(confirmRenderBody).toContain('onClick={handleConfirm}')
    expect(confirmRenderBody).toContain('Go back and edit')
    expect(confirmRenderBody).toContain('onClick={handleEdit}')
    expect(confirmRenderBody).toContain('disabled={submitting}')
  })

  it('the entry form\'s Continue button is a plain form submit — never itself disabled/labelled as a saving state (only the confirm phase talks to the server)', () => {
    const entryButtonStart = body.lastIndexOf('<button type="submit"')
    const entryButtonBody = body.slice(entryButtonStart, body.indexOf('</form>'))
    expect(entryButtonBody).toContain('>\n          Continue\n        </button>')
    expect(entryButtonBody).not.toContain('disabled={submitting}')
  })
})

describe('BeginFlow — legal acceptance step (source inspection)', () => {
  const fnStart = source.indexOf('function LegalAcceptanceStep')
  const fnEnd = source.indexOf('\nfunction IneligibleTerminal')
  const body = source.slice(fnStart, fnEnd)

  it('the checkbox starts unchecked — no preselection, no dark pattern', () => {
    expect(body).toContain('useState(false)')
    expect(body).not.toContain('useState(true)')
  })

  it('the Privacy Notice link is NOT inside the same checkbox label — a separate, unbundled line', () => {
    const labelStart = body.indexOf('<label')
    const labelEnd = body.indexOf('</label>', labelStart)
    const checkboxLabel = body.slice(labelStart, labelEnd)
    expect(checkboxLabel).not.toContain('Privacy Notice')
    expect(body).toContain('Privacy Notice')
  })

  it('the required checkbox copy is the exact approved text', () => {
    expect(body).toContain('I agree to the')
    expect(body).toContain('Terms of Service')
    expect(body).toContain('Community Guidelines')
  })

  it('links point to the correct public legal routes', () => {
    expect(body).toContain('href="/terms"')
    expect(body).toContain('href="/privacy"')
    expect(body).toContain('href="/community-guidelines"')
  })

  it('includes the restrained liability/indemnity disclosure line, linked to Terms', () => {
    expect(body).toContain('limitations of')
    expect(body).toContain('liability')
    expect(body).toContain('indemnity')
  })

  it('Continue to Tempa is disabled until the checkbox is checked', () => {
    expect(body).toContain('disabled={!agreed || submitting}')
  })

  it('calls accept_current_legal_documents with NO version arguments — the accepted versions are server-side SQL constants (independent audit correction), never client-supplied', () => {
    expect(body).toContain("supabase.rpc('accept_current_legal_documents')")
    // The old client-supplied-version call shape must be fully gone —
    // an authenticated caller must not be able to choose which
    // document version gets recorded.
    expect(body).not.toContain('p_terms_version')
    expect(body).not.toContain('p_community_guidelines_version')
    expect(source).not.toContain("from '@/lib/legal'")
  })

  it('a successful acceptance calls router.refresh(), never a hardcoded client-side redirect', () => {
    expect(body).toContain('router.refresh()')
    expect(body).not.toContain('router.push(')
  })

  it('does not create a separate "privacy_notice accepted" record — only the two documents this checkpoint actually versions', () => {
    expect(body).not.toMatch(/privacy_notice/i)
  })
})

describe('BeginFlow — no app navigation, no AppShell', () => {
  it('never imports AppShell — /begin is deliberately outside the normal member navigation chrome', () => {
    expect(source).not.toContain('AppShell')
  })

  it('no legal icons, shields, gavels, or progress-wizard step numbering', () => {
    const lower = source.toLowerCase()
    expect(lower).not.toContain('shield')
    expect(lower).not.toContain('gavel')
    expect(lower).not.toMatch(/step \d of \d/)
  })
})
