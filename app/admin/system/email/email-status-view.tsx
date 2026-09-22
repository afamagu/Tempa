'use client'

import { useRouter } from 'next/navigation'
import type { ArrivalEmailStatus } from '@/lib/admin'
import { sectionTitleClass, secondaryButtonClass, helperTextClass } from '@/app/profile/ui'
import { adminBodyClass, adminTableTextClass, adminTableSecondaryClass, adminBadgeClass } from '../../admin-ui'
import SendingToggle from './sending-toggle'

const STATUS_ORDER: ArrivalEmailStatus['recent'][number]['status'][] = [
  'pending',
  'processing',
  'sent',
  'skipped',
  'failed',
]

export default function EmailStatusView({
  initialStatus,
  initialError,
}: {
  initialStatus: ArrivalEmailStatus | null
  initialError: string | null
}) {
  const router = useRouter()

  if (initialError || !initialStatus) {
    return (
      <div className="space-y-4">
        <h1 className={sectionTitleClass}>Email delivery</h1>
        <p className="text-sm text-red-600">{initialError ?? 'Could not load email delivery status.'}</p>
        <button type="button" onClick={() => router.refresh()} className={secondaryButtonClass}>
          Retry
        </button>
      </div>
    )
  }

  const { sendingEnabled, counts, recent } = initialStatus

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className={sectionTitleClass}>Email delivery</h1>
        <button type="button" onClick={() => router.refresh()} className={secondaryButtonClass}>
          Refresh
        </button>
      </div>

      <SendingToggle enabled={sendingEnabled} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="rounded-md border border-foreground/10 px-3 py-2">
            <p className={adminTableSecondaryClass}>{status}</p>
            <p className={adminBodyClass}>{counts[status] ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <p className={helperTextClass}>Most recently updated (up to 50) — arrival-email queue rows never carry letter content.</p>
        {recent.length === 0 ? (
          <p className={adminTableSecondaryClass}>No arrival-email jobs yet.</p>
        ) : (
          <div className="space-y-1.5">
            {recent.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-foreground/10 px-3 py-2">
                <div className="min-w-0">
                  <p className={adminTableTextClass}>
                    Letter {row.letterId.slice(0, 8)}… → {row.recipientId.slice(0, 8)}…
                  </p>
                  <p className={adminTableSecondaryClass}>
                    {row.attempts}/{row.maxAttempts} attempts · updated {new Date(row.updatedAt).toLocaleString()}
                    {row.lastError ? ` · ${row.lastError}` : ''}
                    {row.skippedReason ? ` · ${row.skippedReason}` : ''}
                    {row.providerMessageId ? ` · Resend ${row.providerMessageId}` : ''}
                  </p>
                </div>
                <span className={adminBadgeClass}>{row.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
