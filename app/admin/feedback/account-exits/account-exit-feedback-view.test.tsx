import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AccountExitFeedbackView from './account-exit-feedback-view'
import type { AccountExitFeedback } from '@/lib/account-exit-feedback'

const data: AccountExitFeedback = {
  deactivations: 3,
  reactivations: 1,
  deletions: 2,
  currentlyOnBreak: 2,
  reasons: [
    { event: 'deactivation', reasonCode: 'need_a_break', count: 2 },
    { event: 'deactivation', reasonCode: 'not_given', count: 1 },
    { event: 'deletion', reasonCode: 'something_else', count: 2 },
  ],
  recent: [
    { event: 'deletion', reasonCode: 'something_else', detail: 'Found a pen pal elsewhere', at: '2026-09-25T10:00:00Z' },
    { event: 'reactivation', reasonCode: null, detail: null, at: '2026-09-24T10:00:00Z' },
  ],
  letterPassNotes: [{ detail: 'Letter felt copy-pasted', at: '2026-09-23T10:00:00Z' }],
}

describe('Admin → Feedback → Account exits', () => {
  const html = renderToStaticMarkup(<AccountExitFeedbackView windowKey="30d" data={data} />)

  it('counts, reason breakdown with percentages, recent notes and letter pass notes', () => {
    for (const text of ['Breaks taken', 'Came back', 'Deleted accounts', 'On a break now', 'I need a break', '2 · 67%', 'No reason given', '1 · 33%', 'Found a pen pal elsewhere', 'Letter felt copy-pasted']) {
      expect(html).toContain(text)
    }
    expect(html).toContain('never shown to the person who wrote the letter')
  })

  it('window filter links with the active one marked', () => {
    expect(html).toContain('href="/admin/feedback/account-exits?window=7d"')
    expect(html).toMatch(/aria-current="page"[^>]*>Last 30 days</)
  })

  it('an RPC failure (e.g. not staff) renders an error, never fabricated zeros', () => {
    const failed = renderToStaticMarkup(<AccountExitFeedbackView windowKey="30d" data={null} />)
    expect(failed).toContain('Could not load account-exit feedback.')
    expect(failed).not.toContain('Breaks taken')
  })
})
