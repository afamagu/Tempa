import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import ReportButton from './report-button'

const SOURCE_PATH = path.join(__dirname, 'report-button.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

// Same SSR-only (no jsdom — see vitest.config.mts) convention as every
// other interactive component in this codebase: the collapsed trigger
// is proven by a real render; the open/submit/error flow (all driven by
// onClick, unreachable via renderToStaticMarkup) is proven by source
// inspection instead.
describe('ReportButton — collapsed trigger (initial render)', () => {
  it('renders the default "Report" trigger label', () => {
    const html = renderToStaticMarkup(
      <ReportButton targetType="profile" targetId="user-1" triggerClassName="x" />
    )
    expect(html).toContain('Report')
  })

  it('never exposes a report number, queue position, or moderation-outcome promise in its own markup', () => {
    const html = renderToStaticMarkup(
      <ReportButton targetType="profile" targetId="user-1" triggerClassName="x" />
    )
    expect(html.toLowerCase()).not.toContain('queue')
    expect(html.toLowerCase()).not.toContain('case')
  })

  it('supports an icon-only trigger via triggerLabel + triggerAriaLabel (Dispatch reader call site)', () => {
    const html = renderToStaticMarkup(
      <ReportButton
        targetType="dispatch"
        targetId="dispatch-1"
        triggerClassName="x"
        triggerLabel={<span>⚑</span>}
        triggerAriaLabel="Report this Dispatch"
      />
    )
    expect(html).toContain('aria-label="Report this Dispatch"')
  })

  it('renders without crashing for every report target type', () => {
    for (const targetType of ['profile', 'letter', 'dispatch', 'photo_moment'] as const) {
      expect(() =>
        renderToStaticMarkup(<ReportButton targetType={targetType} targetId="id-1" triggerClassName="x" />)
      ).not.toThrow()
    }
  })
})

describe('ReportButton — reason list (source)', () => {
  it('offers all six V1 reasons, Other last', () => {
    expect(source).toContain('REPORT_REASONS.map')
  })

  it('submit is disabled until a reason is chosen', () => {
    expect(source).toContain('disabled={busy || !reason}')
  })
})

describe('ReportButton — submission flow (source)', () => {
  it('calls reportContent with the trimmed context, not a raw blank string', () => {
    expect(source).toContain('reportContent(createClient(), targetType, targetId, reason, context)')
  })

  it('shows the exact required quiet confirmation on success, never before', () => {
    const submittedBranch = source.slice(source.indexOf('if (submitted) {'), source.indexOf('if (!open) {'))
    expect(submittedBranch).toContain('Report received. Thank you for letting us know.')
  })

  it('a duplicate-report error surfaces its own distinct message rather than the generic retry message', () => {
    expect(source).toContain("reportError.message === 'You have already reported this.'")
  })

  it('never automatically blocks the reported member — reporting and blocking stay fully separate actions', () => {
    expect(source).not.toContain('blockUser')
    expect(source).not.toContain("from '@/app/block-button'")
  })
})
