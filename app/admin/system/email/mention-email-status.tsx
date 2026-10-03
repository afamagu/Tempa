'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { primaryButtonClass } from '@/app/profile/ui'

export type MentionEmailStatus = {
  sendingEnabled: boolean; canManage: boolean; lastWorkerAt: string | null; counts: Record<string, number>;
  recent: { mention_id: string; recipient: string | null; kind: string; status: string; attempts: number; last_error: string | null; updated_at: string }[]
}
export default function MentionEmailStatusView({ status }: { status: MentionEmailStatus | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  async function toggle() {
    if (!status || busy) return
    setBusy(true); setError(false)
    try {
      const { error } = await createClient().rpc('set_mention_email_sending_enabled', { p_enabled: !status.sendingEnabled })
      if (error) setError(true); else router.refresh()
    } catch { setError(true) } finally { setBusy(false) }
  }
  return <section className="mt-8 space-y-4 rounded-xl border border-accent/20 p-5">
    <h2 className="font-serif text-2xl">Mention emails</h2>
    {!status ? <p role="status">Mention email status is unavailable. Check the database migration and reload.</p> : <>
      <p className="text-sm">Sending is {status.sendingEnabled ? 'enabled' : 'disabled'}. Only new mentions created while enabled enter the queue. Emails wait at least two minutes, then use the existing scheduler.</p>
      <p className="text-sm">Last worker check: {status.lastWorkerAt ? `${new Date(status.lastWorkerAt).toISOString().replace('T',' ').slice(0,19)} UTC` : 'Not observed yet. Wait for the next scheduler run, then reload.'}</p>
      <p className="text-sm text-foreground/70">Up to one email per 15 minutes and ten per day per recipient; at most two per day from people outside their correspondents. Other mentions remain in-app. “Sent” means accepted by the email provider, not confirmed inbox delivery.</p>
      {status.canManage && <button type="button" disabled={busy} className={primaryButtonClass} onClick={() => void toggle()}>{busy ? 'Saving…' : status.sendingEnabled ? 'Pause mention emails' : 'Enable future mention emails'}</button>}
      {error && <p role="alert">Could not change sending. Administrator access is required. Please try again.</p>}
      <dl className="flex flex-wrap gap-4 text-sm">{['pending','processing','sent','skipped','failed','manual_review'].map(key => <div key={key}><dt>{key.replace('_',' ')}</dt><dd className="text-xl">{status.counts[key] ?? 0}</dd></div>)}</dl>
      <ul className="divide-y divide-foreground/10">{status.recent.map(job => <li key={job.mention_id} className="py-3 text-sm">
        <p>{job.recipient ?? 'Unavailable member'} · {job.kind} · {job.status.replace('_',' ')}</p>
        <p className="text-foreground/65">{job.attempts} attempts{job.last_error ? ` · ${job.last_error}` : ''}</p>
      </li>)}</ul>
    </>}
  </section>
}
