import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SendEmailInput, SendEmailResult } from './provider'
import { SITE_URL } from '@/lib/site'

export type MentionEmailSnapshot = {
  from: string; to: string; pseudonym: string; kind: 'dispatch' | 'reply' | 'answer';
  mentionId: string; siteOrigin: string; idempotencyKey: string; providerRequest?: SendEmailInput
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

export function renderMentionEmail(snapshot: MentionEmailSnapshot) {
  if (snapshot.siteOrigin !== SITE_URL || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshot.mentionId)) throw new Error('Invalid mention destination.')
  const context = { dispatch: 'a Dispatch', reply: 'a reply', answer: 'an answer' }[snapshot.kind]
  if (!context || !snapshot.pseudonym) throw new Error('Invalid mention context.')
  const name = snapshot.pseudonym.replace(/[\r\n]/g, ' ').slice(0, 100)
  const subject = `${name} mentioned you on Tempa`
  const sentence = `${name} mentioned you in ${context}.`
  const href = `${SITE_URL}/mentions/${snapshot.mentionId}`
  const preferences = `${SITE_URL}/you/notifications#mention-emails`
  const text = `${sentence}\n\nRead the mention: ${href}\n\nYour other mentions: ${SITE_URL}/you/mentions\n\nChoose who can send you mention emails, or turn them off: ${preferences}`
  // No writing excerpts or attachments leave Tempa. Access is checked again
  // after sign-in at the recipient-only mention destination.
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f7f2e7;color:#24211a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="560" style="width:100%;max-width:560px;background:#fffcf6;border:1px solid #ded7ca"><tr><td style="padding:30px"><p style="font:18px Georgia,serif;letter-spacing:3px;color:#5b6b47;margin:0 0 28px">TEMPA</p><h1 style="font:normal 28px/1.35 Georgia,serif;margin:0 0 24px">${escapeHtml(sentence)}</h1><a href="${href}" style="display:inline-block;padding:14px 22px;background:#5b6b47;color:#fff;text-decoration:none;border-radius:5px;font:15px Arial,sans-serif">Read the mention</a><p style="font:14px/1.6 Arial,sans-serif;margin:24px 0"><a href="${SITE_URL}/you/mentions" style="color:#5b6b47">View your other mentions</a></p><p style="font:12px/1.6 Arial,sans-serif;border-top:1px solid #ded7ca;padding-top:20px;margin-bottom:0;color:#726a59">You can choose who sends you mention emails, or turn them off.<br><a href="${preferences}" style="color:#5b6b47">Manage mention emails</a></p></td></tr></table></td></tr></table></body></html>`
  return { subject, text, html }
}

export async function runMentionEmailWorker({ supabase, sendEmail, siteOrigin }: {
  supabase: SupabaseClient; sendEmail: (request: SendEmailInput) => Promise<SendEmailResult>; siteOrigin: string
}) {
  const summary = { claimed: 0, sent: 0, failed: 0 }
  const from = process.env.ARRIVAL_EMAIL_FROM
  if (!from?.trim()) return summary
  try {
    const origin = new URL(siteOrigin)
    if (origin.origin !== SITE_URL || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash) return summary
  } catch { return summary }
  const { data, error } = await supabase.rpc('claim_mention_emails', { p_limit: 5 })
  if (error) {
    if (!['PGRST202', '42883'].includes(error.code)) console.error('Mention email claim failed', { code: error.code })
    return summary
  }
  await Promise.all(((data ?? []) as { mention_id: string; claim_token: string }[]).map(async job => {
    summary.claimed++
    const args = { p_mention_id: job.mention_id, p_claim_token: job.claim_token }
    try {
      const { data: prepared, error: prepareError } = await supabase.rpc('prepare_mention_email', { ...args, p_site_origin: SITE_URL, p_from: from })
      if (prepareError) throw new Error('Preparation failed')
      if (!prepared) return
      const snapshot = prepared as MentionEmailSnapshot
      const request = snapshot.providerRequest ?? { from: snapshot.from, to: snapshot.to, ...renderMentionEmail(snapshot), idempotencyKey: snapshot.idempotencyKey }
      const { data: frozen, error: freezeError } = await supabase.rpc('freeze_mention_email', { ...args, p_request: request })
      if (freezeError) throw new Error('Freezing failed')
      if (!frozen) return
      const result = await sendEmail(frozen as SendEmailInput)
      const { error: completeError } = await supabase.rpc('complete_mention_email', {
        ...args, p_ok: result.ok, p_retryable: result.ok ? false : result.retryable,
        p_provider_message_id: result.ok ? result.providerMessageId : null,
      })
      if (completeError) console.error('Mention email completion failed', { code: completeError.code })
      if (result.ok) summary.sent++; else summary.failed++
    } catch {
      summary.failed++
      const { error: completionError } = await supabase.rpc('complete_mention_email', { ...args, p_ok: false, p_retryable: true, p_provider_message_id: null })
      if (completionError) console.error('Mention email failure recording failed', { code: completionError.code })
    }
  }))
  return summary
}
