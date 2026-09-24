import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import SafetyBlockedDialog from './safety-blocked-dialog'
import SafetyWarningDialog from './safety-warning-dialog'
import ContactSharingNote from './letters/[letterId]/contact-sharing-note'
import FromTempaNotice from './from-tempa-notice'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: async () => ({ error: null }) }) }))

// Static render only — this codebase's established Vitest convention.

describe('SafetyBlockedDialog — a confirmed financial request cannot be sent', () => {
  it('renders nothing when closed', () => {
    expect(renderToStaticMarkup(<SafetyBlockedDialog open={false} onClose={() => {}} />)).toBe('')
  })

  it('shows the policy wording and a single "Return to my letter" action — never "Send anyway"', () => {
    const html = renderToStaticMarkup(<SafetyBlockedDialog open onClose={() => {}} />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('A quick note from Tempa')
    expect(html).toContain('This message appears to ask another member for money or financial help. Financial requests are not allowed on Tempa.')
    expect(html).toContain('Please remove the request before continuing. Tempa records safety signals like this so repeated patterns can be recognised and reviewed.')
    expect(html).toContain('Return to my letter')
    expect(html.toLowerCase()).not.toContain('send anyway')
    expect((html.match(/<button/g) ?? []).length).toBe(1)
  })

  it('never exposes bands, reason codes or accusation language', () => {
    const lower = renderToStaticMarkup(<SafetyBlockedDialog open onClose={() => {}} />).toLowerCase()
    for (const word of ['scam', 'fraud', 'risk band', 'reason code', 'flagged', 'DIRECT_MONEY_REQUEST'.toLowerCase()]) {
      expect(lower).not.toContain(word)
    }
  })
})

describe('SafetyWarningDialog — personal contact / off-platform variant', () => {
  const html = renderToStaticMarkup(
    <SafetyWarningDialog open copyKey="safety_contact_sharing" onCancel={() => {}} onAcknowledgeAndSend={() => {}} sending={false} />
  )

  it('uses the contact-sharing wording with "Review my letter" / "Send anyway"', () => {
    expect(html).toContain('A quick note from Tempa')
    expect(html).toContain('This message includes personal contact details or an invitation to continue your conversation elsewhere.')
    expect(html).toContain('You can still send it. If you continue, your pen pal will see a short privacy reminder before deciding what they want to share.')
    expect(html).toContain('Review my letter')
    expect(html).toContain('Send anyway')
  })

  it('the generic warning is unchanged when no (or another) copy key is given', () => {
    const generic = renderToStaticMarkup(<SafetyWarningDialog open onCancel={() => {}} onAcknowledgeAndSend={() => {}} sending={false} />)
    expect(generic).toContain('A moment before you continue')
    expect(generic).toContain('Let me look again')
    expect(generic).not.toContain('personal contact details')
  })
})

describe('recipient contact-sharing note', () => {
  it('is calm, non-accusatory and carries the policy wording', () => {
    const html = renderToStaticMarkup(<ContactSharingNote />)
    expect(html).toContain('A quick note from Tempa')
    expect(html).toContain("You don&#x27;t need to share your phone number, email address, home address, or move to another app to keep writing here.")
    expect(html).toContain('remember that Tempa can&#x27;t protect conversations that happen outside the platform')
    const lower = html.toLowerCase()
    for (const word of ['scam', 'fraud', 'suspicious', 'violation', 'strike', 'sender']) expect(lower).not.toContain(word)
  })
})

describe('"From Tempa" official notice', () => {
  const restricted = {
    id: 'n1',
    title: 'A quick note from Tempa',
    body: "We've temporarily restricted your account while we review activity that may conflict with Tempa's safety rules.\n\nYou can still read your existing correspondence, but you won't be able to write, reply, publish or comment during the review.\n\nThis is a temporary safety measure, not a final decision.",
  }

  it('is labelled From Tempa, has no reply affordance, and renders every paragraph', () => {
    const html = renderToStaticMarkup(<FromTempaNotice notice={{ ...restricted, persistent: true }} />)
    expect(html).toContain('From Tempa')
    expect(html).toContain('This is a temporary safety measure, not a final decision.')
    expect(html.toLowerCase()).not.toMatch(/<textarea|<input|<form|write back/)
  })

  it('an active-restriction notice is persistent (no dismiss); other notices can be dismissed', () => {
    expect(renderToStaticMarkup(<FromTempaNotice notice={{ ...restricted, persistent: true }} />)).not.toContain('Dismiss')
    expect(renderToStaticMarkup(<FromTempaNotice notice={{ ...restricted, persistent: false }} />)).toContain('Dismiss')
  })
})

describe('every authored-write composer handles the financial block and the contact reminder', () => {
  const composers = [
    'board/dispatch-composer.tsx',
    'board/[dispatchId]/reply-composer.tsx',
    'letters/[letterId]/first-contact-response.tsx',
    'letters/[letterId]/moments-composer.tsx',
    'question/question-answer.tsx',
    'write/[recipientId]/first-letter-composer.tsx',
  ]
  it.each(composers)('%s', (file) => {
    const source = readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n')
    expect(source).toContain('SAFETY_FINANCIAL_REQUEST_COPY_KEY')
    expect(source).toContain('<SafetyBlockedDialog')
    expect(source).toContain('copyKey={pendingWarning?.copyKey}')
    // a confirmed financial request never reaches the override path
    expect(source).toMatch(/if \(outcome\.copyKey === SAFETY_FINANCIAL_REQUEST_COPY_KEY\) setFinancialBlocked\(true\)/)
  })
})
