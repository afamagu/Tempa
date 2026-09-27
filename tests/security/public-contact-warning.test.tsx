import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SafetyWarningDialog from '@/app/safety-warning-dialog'
import { classifyContent } from '@/lib/safety/classify'
import {
  CONTACT_SHARING_COPY_KEY,
  PUBLIC_CONTACT_SHARING_COPY_KEY,
  SAFETY_SURFACES,
  buildEvaluateResponse,
  copyKeyFor,
  isPrivateLetterSurface,
} from '@/lib/safety/route-contract'
import { FINANCIAL_SOLICITATION_REASON_CODES } from '@/lib/safety/reason-codes'

// Pre-beta security F-12 — personal contact details posted on a PUBLIC
// surface get the same allowed, warn-only advisory a private letter gets,
// with exposure-specific copy. Never a block, never a strike.

const CONTACT = 'Happy to chat more, message me on WhatsApp.'
const PUBLIC_SURFACES = SAFETY_SURFACES.filter((s) => !isPrivateLetterSurface(s))

describe('F-12 public contact-sharing advisory', () => {
  it('the public surfaces are exactly the Dispatch / answer surfaces', () => {
    expect([...PUBLIC_SURFACES].sort()).toEqual(['dispatch_publish', 'dispatch_reply', 'dispatch_update', 'question_answer'])
  })

  it('classifies contact details on a public surface as a weak warn — never deny, never a case, never a solicitation code', () => {
    const result = classifyContent(CONTACT, { publicSurface: true })
    expect(result).toMatchObject({ riskBand: 'weak', mutationDisposition: 'warn', escalateCase: false })
    expect(result.reasonCodes).toContain('PERSONAL_CONTACT_SHARING')
    expect(result.reasonCodes.some((c) => (FINANCIAL_SOLICITATION_REASON_CODES as readonly string[]).includes(c))).toBe(false)
  })

  it('ordinary public text is still allowed', () => {
    expect(classifyContent('Kindness is underrated.', { publicSurface: true }).mutationDisposition).toBe('allow')
  })

  it('private letters keep their original copy key; public surfaces get the public one', () => {
    const codes = ['PERSONAL_CONTACT_SHARING'] as const
    expect(copyKeyFor('warn', codes, 'reply')).toBe(CONTACT_SHARING_COPY_KEY)
    expect(copyKeyFor('warn', codes)).toBe(CONTACT_SHARING_COPY_KEY)
    for (const surface of PUBLIC_SURFACES) {
      expect(buildEvaluateResponse('e', 'warn', codes, surface)).toEqual({
        evaluationId: 'e',
        disposition: 'warning_required',
        warningCopyKey: PUBLIC_CONTACT_SHARING_COPY_KEY,
      })
    }
  })

  it('a financial request on a public surface is still the financial copy, not the contact one', () => {
    expect(copyKeyFor('deny', ['DIRECT_MONEY_REQUEST', 'PERSONAL_CONTACT_SHARING'], 'dispatch_publish')).toBe('safety_financial_request')
  })

  it('the dialog shows public-exposure wording, keeps the surface action label, and never mentions a pen pal', () => {
    const html = renderToStaticMarkup(
      <SafetyWarningDialog
        open
        copyKey={PUBLIC_CONTACT_SHARING_COPY_KEY}
        actionLabel="Publish anyway"
        onCancel={() => {}}
        onAcknowledgeAndSend={() => {}}
        sending={false}
      />
    )
    expect(html).toContain('A quick note from Tempa')
    expect(html).toContain('Everyone on Tempa will be able to see it.')
    expect(html).toContain('Publish anyway')
    expect(html).toContain('Let me look again')
    expect(html.toLowerCase()).not.toContain('pen pal')
    expect(html.toLowerCase()).not.toContain('not allowed')
  })
})
