import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SafetyWarningDialog from './safety-warning-dialog'

// Static render only — this codebase's established Vitest convention
// (see letter-reader.test.tsx's own header comment). Escape/backdrop-
// click/body-scroll-lock are live-test items, same status as every
// other overlay in this app.

describe('SafetyWarningDialog — the one shared, calm pre-send interruption', () => {
  it('renders nothing at all when closed', () => {
    const html = renderToStaticMarkup(<SafetyWarningDialog open={false} onCancel={() => {}} onAcknowledgeAndSend={() => {}} sending={false} />)
    expect(html).toBe('')
  })

  it('opens as a dialog with go-back and send-anyway actions, when open', () => {
    const html = renderToStaticMarkup(<SafetyWarningDialog open onCancel={() => {}} onAcknowledgeAndSend={() => {}} sending={false} />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('Let me look again')
    expect(html).toContain('Send anyway')
  })

  it('never frames the warning as proof of guilt — no scam/fraud/risk-band/reason-code vocabulary anywhere in the rendered copy', () => {
    const html = renderToStaticMarkup(<SafetyWarningDialog open onCancel={() => {}} onAcknowledgeAndSend={() => {}} sending={false} />)
    const lower = html.toLowerCase()
    expect(lower).not.toContain('scam')
    expect(lower).not.toContain('fraud')
    expect(lower).not.toContain('risk band')
    expect(lower).not.toContain('reason code')
    expect(lower).not.toContain('flagged')
  })

  it('shows a sending state on the acknowledge action, and disables it while sending', () => {
    const html = renderToStaticMarkup(<SafetyWarningDialog open onCancel={() => {}} onAcknowledgeAndSend={() => {}} sending />)
    expect(html).toContain('Sending…')
    expect(html).toContain('disabled=""')
  })
})
