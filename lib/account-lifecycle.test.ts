import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DEACTIVATION_REASONS, DELETION_REASONS, SOMETHING_ELSE, exitFeedbackArgs, reasonLabel } from './account-lifecycle'
import { CLOSE_REASONS, CLOSE_REASON_SOMETHING_ELSE, closeReasonForSender } from './letters'
import { getAccountExitFeedback, reasonShare, resolveExitFeedbackWindow } from './account-exit-feedback'
import type { SupabaseClient } from '@supabase/supabase-js'

const SQL = readFileSync(path.join(__dirname, '..', 'docs', 'sql', '2026-10-16-account-lifecycle.sql'), 'utf8')

describe('exit reason codes', () => {
  it('stable codes match the database CHECK lists exactly; both end with Something else', () => {
    for (const set of [DEACTIVATION_REASONS, DELETION_REASONS]) {
      expect(set.at(-1)).toEqual({ code: SOMETHING_ELSE, label: 'Something else' })
      for (const r of set) expect(SQL).toContain(`'${r.code}'`)
    }
  })

  it('feedback args: optional, detail only with Something else, trimmed, bounded, unknown codes dropped', () => {
    expect(exitFeedbackArgs(null, DELETION_REASONS)).toEqual({ p_reason_code: null, p_reason_detail: null })
    expect(exitFeedbackArgs({ reasonCode: 'something_else', reasonDetail: '  x  ' }, DELETION_REASONS)).toEqual({ p_reason_code: 'something_else', p_reason_detail: 'x' })
    expect(exitFeedbackArgs({ reasonCode: 'not_using_tempa', reasonDetail: 'dropped' }, DELETION_REASONS)).toEqual({ p_reason_code: 'not_using_tempa', p_reason_detail: null })
    expect(exitFeedbackArgs({ reasonCode: 'need_a_break', reasonDetail: '' }, DELETION_REASONS).p_reason_code).toBeNull()
    expect(exitFeedbackArgs({ reasonCode: 'something_else', reasonDetail: 'y'.repeat(5000) }, DEACTIVATION_REASONS).p_reason_detail).toHaveLength(1000)
  })

  it('labels for admin display', () => {
    expect(reasonLabel(null)).toBe('No reason given')
    expect(reasonLabel('not_given')).toBe('No reason given')
    expect(reasonLabel('life_is_busy')).toBe('Life is busy right now')
  })
})

describe('first contact "Something else" — what the sender sees', () => {
  it('four reasons; the marker is Something else', () => {
    expect(CLOSE_REASONS).toHaveLength(4)
    expect(CLOSE_REASONS[3]).toBe(CLOSE_REASON_SOMETHING_ELSE)
  })

  it('the three presets are shown unchanged; Something else becomes neutral copy', () => {
    for (const preset of CLOSE_REASONS.slice(0, 3)) expect(closeReasonForSender(preset)).toBe(preset)
    expect(closeReasonForSender('Something else')).toBe('They chose not to continue this correspondence.')
    expect(closeReasonForSender(null)).toBe('')
  })

  it('L. both sender-facing renderers go through closeReasonForSender (never raw close_reason)', () => {
    const letterPage = readFileSync(path.join(__dirname, '..', 'app', 'letters', '[letterId]', 'page.tsx'), 'utf8')
    const writePage = readFileSync(path.join(__dirname, '..', 'app', 'write', '[recipientId]', 'page.tsx'), 'utf8')
    expect(letterPage).toContain('detail={closeReasonForSender(target.closeReason)}')
    expect(writePage).toContain('{closeReasonForSender(existing.closeReason)}')
    expect(letterPage + writePage).not.toMatch(/\{(target|existing)\.closeReason\}/)
  })

  it('K. the recipient UI sends the private note only with Something else, and says only Tempa reads it', () => {
    const ui = readFileSync(path.join(__dirname, '..', 'app', 'letters', '[letterId]', 'first-contact-response.tsx'), 'utf8')
    expect(ui).toContain('p_detail: reason === CLOSE_REASON_SOMETHING_ELSE ? closeDetail.trim() || null : null')
    expect(ui).toContain('If you&rsquo;d like, tell Tempa why.')
    expect(ui).toContain('never shared with the person who wrote to you')
  })

  it('F. an existing correspondent sees the taking-a-break note (from correspondents_on_break)', () => {
    const letterPage = readFileSync(path.join(__dirname, '..', 'app', 'letters', '[letterId]', 'page.tsx'), 'utf8')
    expect(letterPage).toContain("supabase.rpc('correspondents_on_break', { p_user_ids: [otherPartyId] })")
    expect(letterPage).toContain('{otherPseudonym} is taking a break from Tempa.')
  })
})

describe('admin exit feedback helpers', () => {
  it('window defaults to 30 days; all-time has no lower bound', () => {
    const now = new Date('2026-09-25T00:00:00Z')
    expect(resolveExitFeedbackWindow(undefined, now)).toMatchObject({ window: { key: '30d' }, since: '2026-08-26T00:00:00.000Z' })
    expect(resolveExitFeedbackWindow('all', now).since).toBeNull()
  })

  it('percentages are within each event type', async () => {
    const supabase = {
      rpc: async () => ({
        data: {
          deactivations: '3', reactivations: 1, deletions: 1, currently_on_break: 2,
          reasons: [
            { event: 'deactivation', reason_code: 'need_a_break', count: 2 },
            { event: 'deactivation', reason_code: 'not_given', count: 1 },
            { event: 'deletion', reason_code: 'not_using_tempa', count: 1 },
          ],
          recent: [], letter_pass_notes: [],
        },
        error: null,
      }),
    } as unknown as SupabaseClient
    const { data } = await getAccountExitFeedback(supabase, null)
    expect(data!.deactivations).toBe(3)
    expect(reasonShare(data!, 'deactivation', 2)).toBe(67)
    expect(reasonShare(data!, 'deletion', 1)).toBe(100)
  })

  it('J. a staff-gate refusal surfaces as an error, never as empty data', async () => {
    const supabase = { rpc: async () => ({ data: null, error: { message: 'Staff only.' } }) } as unknown as SupabaseClient
    expect(await getAccountExitFeedback(supabase, null)).toEqual({ data: null, error: 'Staff only.' })
  })
})
