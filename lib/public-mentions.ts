import type { SupabaseClient } from '@supabase/supabase-js'
import type { CorrespondentChoice } from './correspondent-trigger'

export type MentionSelection = Pick<CorrespondentChoice, 'userId' | 'pseudonym'>
export function retainedMentions(body: string, people: MentionSelection[]): MentionSelection[] {
  const seen = new Set<string>()
  return people.filter(person => {
    const token = `@${person.pseudonym}`
    let from = body.indexOf(token), present = false
    while (from !== -1) {
      const before = body[from - 1] ?? '', after = body[from + token.length] ?? ''
      if ((!before || !/[\p{L}\p{N}_@]/u.test(before)) && (!after || !/[\p{L}\p{N}_]/u.test(after))) { present = true; break }
      from = body.indexOf(token, from + token.length)
    }
    if (!present || seen.has(person.userId)) return false
    seen.add(person.userId); return true
  })
}

/** The database publishes and records the selected identities in ONE transaction.
 * Undefined preserves older callers; composers always pass an explicit list. */
export function mentionPublicationRpc(operation: string, args: Record<string, unknown>, mentions?: MentionSelection[]): [string, Record<string, unknown>] {
  return mentions === undefined ? [operation, args] : ['publish_with_mentions', {
    p_operation: operation, p_arguments: args,
    p_mentions: retainedMentions(String(args.p_body ?? ''), mentions),
  }]
}

/** Publication remains atomic in Postgres. A best-effort wake-up never changes
 * its result: a closed tab or offline request leaves the durable cron fallback. */
export async function executeMentionPublication(client: SupabaseClient, rpc: [string, Record<string, unknown>]) {
  const result = await client.rpc(...rpc)
  if (!result.error && rpc[0] === 'publish_with_mentions' && Array.isArray(rpc[1].p_mentions) && rpc[1].p_mentions.length && typeof window !== 'undefined') {
    try {
      void fetch('/api/mentions/send', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {})
    } catch { /* The scheduled worker remains the fallback. */ }
  }
  return result
}
