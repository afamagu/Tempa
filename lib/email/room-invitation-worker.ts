import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SendEmailInput, SendEmailResult } from './provider'

type Snapshot = { from: string; to: string; pseudonym: string; prompt: string; questionId: string; siteOrigin: string; idempotencyKey: string; providerRequest?: SendEmailInput }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

export function renderRoomInvitationEmail(snapshot: Snapshot) {
  const origin = new URL(snapshot.siteOrigin)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid site origin.')
  if (!/^[0-9a-f-]{36}$/i.test(snapshot.questionId)) throw new Error('Invalid Question id.')
  const href = `${origin.origin}/question/${snapshot.questionId}?source=room`
  const subject = `${snapshot.pseudonym} wants to hear what you think`
  const text = `${subject}\n\n${snapshot.prompt}\n\nAnswer in The Room: ${href}\n\nManage invitation emails: ${origin.origin}/you/notifications`
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f7f2e7;color:#24211a"><div style="max-width:560px;margin:24px auto;border:1px solid #ded7ca;background:#fffcf6;padding:32px"><p style="font:16px Georgia,serif;letter-spacing:3px">TEMPA</p><h1 style="font:normal 28px/1.3 Georgia,serif">${escapeHtml(subject)}</h1><p style="font:20px/1.5 Georgia,serif">${escapeHtml(snapshot.prompt)}</p><a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 20px;background:#5b6b47;color:white;text-decoration:none;font:15px Arial,sans-serif">Answer in The Room</a><p style="margin-top:28px;font:12px Arial,sans-serif"><a href="${origin.origin}/you/notifications" style="color:#726a59">Manage invitation emails</a></p></div></body></html>`
  return { subject, text, html }
}

export async function runRoomInvitationEmailWorker({ supabase, sendEmail, siteOrigin }: {
  supabase: SupabaseClient; sendEmail: (input: SendEmailInput) => Promise<SendEmailResult>; siteOrigin: string
}) {
  const summary = { claimed: 0, sent: 0, failed: 0 }
  // No configured From means there can be no valid provider attempt.
  const from = process.env.ARRIVAL_EMAIL_FROM
  if (!from) return summary
  const { data, error } = await supabase.rpc('claim_room_invitation_emails', { p_limit: 20 })
  // Optional forward migration: arrival delivery must not fail if invitations
  // haven't been installed yet. Other claim errors remain visible to operations.
  if (error) {
    if (error.code !== 'PGRST202' && error.code !== '42883') console.error('Room invitation claim failed', { code: error.code })
    return summary
  }
  for (const job of (data ?? []) as { invitation_id: string; claim_token: string }[]) {
    summary.claimed++
    const args = { p_invitation_id: job.invitation_id, p_claim_token: job.claim_token }
    try {
      const { data: payload, error: prepareError } = await supabase.rpc('prepare_room_invitation_email', { ...args, p_site_origin: siteOrigin, p_from: from })
      if (prepareError) throw new Error('Invitation preparation failed.')
      if (!payload) continue // fenced out, disabled, skipped, or manual review
      const snapshot = payload as Snapshot
      const proposed = snapshot.providerRequest ?? { from: snapshot.from, to: snapshot.to, ...renderRoomInvitationEmail(snapshot), idempotencyKey: snapshot.idempotencyKey }
      const { data: frozen, error: freezeError } = await supabase.rpc('freeze_room_invitation_email', { ...args, p_request: proposed })
      if (freezeError) throw new Error('Invitation freezing failed.')
      if (!frozen) continue
      const result = await sendEmail(frozen as SendEmailInput)
      const { error: completeError } = await supabase.rpc('complete_room_invitation_email', { ...args, p_ok: result.ok, p_retryable: result.ok ? false : result.retryable, p_error: result.ok ? null : result.error })
      if (completeError) console.error('Room invitation completion failed', { code: completeError.code })
      if (result.ok) summary.sent++; else summary.failed++
    } catch {
      summary.failed++
      // Keep the event retryable; claim token fencing prevents stale completion.
      const { error: completionError } = await supabase.rpc('complete_room_invitation_email', { ...args, p_ok: false, p_retryable: true, p_error: 'Invitation worker failed.' })
      if (completionError) console.error('Room invitation completion failed', { code: completionError.code })
    }
  }
  return summary
}
