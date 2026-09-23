'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getSafetyEvidence, type SafetyEvidence } from '@/lib/admin-safety'
import { helperTextClass, proseBodyClass, secondaryButtonClass } from '@/app/profile/ui'
import { formatDateTimeFull } from '@/lib/format-date'

const PUBLIC_LINKS: Record<'dispatch' | 'dispatch_reply' | 'question_answer', (contentId: string, dispatchId: string | null) => string> = {
  dispatch: (contentId) => `/board/${contentId}`,
  dispatch_reply: (_contentId, dispatchId) => (dispatchId ? `/board/${dispatchId}` : '/board'),
  question_answer: () => '/admin/moderation/public-content',
}

/**
 * Safety 2, Checkpoint 7 — evidence is fetched ONLY on explicit click,
 * never eagerly on page load: admin_get_safety_signal_evidence audits
 * every successful call (item 4's "access audited"), so eagerly
 * fetching evidence for every signal on every case-detail page view
 * would audit-log views that never actually happened. A signal with no
 * source_content_id at all (never proceeded, or a behavioral signal)
 * renders no button — there is nothing to show.
 *
 * For a private Letter, this is the ONLY place its body ever appears in
 * this admin surface — one verified letter, never a mailbox, never
 * previous/next navigation. For public content (Dispatch/Reply/
 * Question answer), this only ever links out to the SAME public page
 * any member could already reach — never an embedded copy.
 */
export default function SignalEvidence({ signalId, hasSourceContent }: { signalId: string; hasSourceContent: boolean }) {
  const [evidence, setEvidence] = useState<SafetyEvidence | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!hasSourceContent) return null

  async function handleShow() {
    if (loading || evidence) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await getSafetyEvidence(createClient(), signalId)
    setLoading(false)
    if (fetchError || !data) {
      setError('Could not load evidence for this signal.')
      return
    }
    setEvidence(data)
  }

  if (!evidence) {
    return (
      <div className="space-y-1">
        <button type="button" onClick={handleShow} disabled={loading} className={secondaryButtonClass}>
          {loading ? 'Loading…' : 'Show flagged content'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    )
  }

  if (evidence.kind === 'none' || evidence.kind === 'unavailable') {
    return <p className={helperTextClass}>No content evidence is available for this signal.</p>
  }

  if (evidence.kind === 'letter') {
    return (
      <div className="space-y-1 rounded-md bg-surface-shell p-3">
        <p className={helperTextClass}>
          {evidence.senderPseudonym} → {evidence.recipientPseudonym} · {formatDateTimeFull(evidence.createdAt)}
        </p>
        <p className={`whitespace-pre-wrap ${proseBodyClass}`}>{evidence.body}</p>
      </div>
    )
  }

  return (
    <Link
      href={PUBLIC_LINKS[evidence.contentType](evidence.contentId, evidence.dispatchId)}
      className="inline-block text-[14px] font-medium text-foreground/70 underline underline-offset-4 transition-colors hover:text-foreground"
    >
      Open this content
    </Link>
  )
}
