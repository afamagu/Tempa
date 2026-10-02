'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { publishMemberQuestion } from './actions'
import SafetyWarningDialog from '@/app/safety-warning-dialog'
import { helperTextClass, quietLinkClass, secondaryButtonClass, sectionLabelClass } from '@/app/profile/ui'

export type ProfileQuestion = { id: string; body: string; is_profile_visible: boolean; moderation_status: string; withdrawn_at: string | null; credit_if_used: boolean; selected: boolean; created_at?: string }
type LegacyQuestion = { id: string; body: string; credit_if_used: boolean }

export default function ProfileQuestions({ ownerId, name, own, initial, legacy, writeHref, returnTo, pendingLetterHref }: {
  ownerId: string; name: string; own: boolean; initial: ProfileQuestion[]; legacy: LegacyQuestion[]; writeHref: string | null; returnTo: string; pendingLetterHref?: string
}) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [visibleCount, setVisibleCount] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(initial.length === 12)
  const [warning, setWarning] = useState<{ id: string; body: string; credit: boolean; copyKey?: string } | null>(null)
  async function manage(row: ProfileQuestion, action: string, value?: boolean) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const { error } = await createClient().rpc('manage_member_question', { p_question_id: row.id, p_action: action, p_value: value ?? null })
      if (error) { setError(error.message); return }
      setRows(previous => previous.map(q => q.id !== row.id ? q : action === 'visibility' ? { ...q, is_profile_visible: Boolean(value) } : action === 'credit' ? { ...q, credit_if_used: Boolean(value) } : { ...q, withdrawn_at: new Date().toISOString(), is_profile_visible: false, credit_if_used: false }))
      router.refresh()
    } catch { setError('Could not update your question. Please try again.') } finally { setBusy(false) }
  }
  async function showLegacy(q: LegacyQuestion, acknowledged = false) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const result = await publishMemberQuestion(q.body, q.credit_if_used, acknowledged, q.id)
      if (result.error) setError(result.error)
      else if (result.warning) setWarning({ id: q.id, body: q.body, credit: q.credit_if_used, copyKey: result.copyKey })
      else { setWarning(null); router.refresh() }
    } catch { setError('Could not publish your question. Please try again.') } finally { setBusy(false) }
  }
  async function more() {
    if (busy) return
    if (visibleCount < rows.length) { setVisibleCount(count => count + 3); return }
    setBusy(true); setError(null)
    try {
      const { data, error } = await createClient().rpc('profile_member_questions', { p_owner: ownerId, p_offset: rows.length, p_limit: 12 })
      if (error) { setError('Could not load more questions. Please try again.'); return }
      const next = (data ?? []) as ProfileQuestion[]
      setRows(previous => [...previous, ...next.filter(q => !previous.some(p => p.id === q.id))])
      setHasMore(next.length === 12)
      setVisibleCount(count => count + 3)
    } catch { setError('Could not load more questions. Please try again.') } finally { setBusy(false) }
  }
  if (!rows.length && !(own && legacy.length)) return null
  return <section className="space-y-5 border-t border-foreground/10 pt-6">
    <h2 className={sectionLabelClass}>{own ? 'Your questions' : (rows.length === 1 ? `A question from ${name}` : `Questions from ${name}`)}</h2>
    {rows.slice(0, visibleCount).map(q => <article key={q.id} className="space-y-3 rounded-md border border-foreground/10 p-4">
      <p className="whitespace-pre-wrap font-serif text-lg leading-relaxed">{q.body}</p>
      {q.created_at && <time dateTime={q.created_at} className={helperTextClass}>{new Date(q.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</time>}
      {q.selected && <p className={helperTextClass}>Selected for the Room</p>}
      {own ? <>
        <p className={helperTextClass}>{q.withdrawn_at ? 'Removed from your profile and future consideration.' : q.moderation_status === 'pending' ? 'Awaiting review. Only you can see this question.' : q.moderation_status === 'hidden' ? 'Hidden by TEMPA.' : q.is_profile_visible ? 'Visible on your profile.' : 'Hidden from your profile.'}</p>
        {!q.withdrawn_at && <div className="flex flex-wrap items-center gap-4">
          <button disabled={busy} onClick={() => void manage(q, 'visibility', !q.is_profile_visible)} className={quietLinkClass}>{q.is_profile_visible ? 'Hide from profile' : 'Show on profile'}</button>
          <button disabled={busy} onClick={() => void manage(q, 'withdraw')} className={quietLinkClass}>Remove question</button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={q.credit_if_used} onChange={e => void manage(q, 'credit', e.target.checked)} />Show my name and Mark in the Room</label>
        </div>}
      </> : writeHref ? <Link className={secondaryButtonClass} href={`${writeHref}${writeHref.includes('?') ? '&' : '?'}mq=${encodeURIComponent(q.id)}&returnTo=${encodeURIComponent(returnTo)}`}>Write to {name} about this</Link> : pendingLetterHref ? <Link href={pendingLetterHref} className={secondaryButtonClass}>Continue through your existing letter</Link> : <p className={helperTextClass}>Writing will be available when a current response is published.</p>}
    </article>)}
    {own && (hasMore || visibleCount < rows.length) && <button disabled={busy} onClick={() => void more()} className={secondaryButtonClass}>Your question history</button>}
    {own && legacy.length > 0 && <details className="space-y-3"><summary className="cursor-pointer text-sm text-foreground/65">Your earlier private suggestions ({legacy.length})</summary>
      <p className={helperTextClass}>Your earlier suggestions remain private. Choose which ones to show on your profile.</p>
      {legacy.map(q => <div key={q.id} className="space-y-2 border-t border-foreground/10 pt-3"><p className="whitespace-pre-wrap font-serif">{q.body}</p><button disabled={busy} className={quietLinkClass} onClick={() => void showLegacy(q)}>Show on my profile</button></div>)}
    </details>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <SafetyWarningDialog open={warning !== null} copyKey={warning?.copyKey} onCancel={() => setWarning(null)} onAcknowledgeAndSend={() => warning && void showLegacy({ id: warning.id, body: warning.body, credit_if_used: warning.credit }, true)} sending={busy} actionLabel="Publish anyway" />
  </section>
}
