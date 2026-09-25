import Link from 'next/link'
import { EXIT_FEEDBACK_WINDOWS, reasonShare, type AccountExitFeedback } from '@/lib/account-exit-feedback'
import { reasonLabel } from '@/lib/account-lifecycle'
import { formatDateTimeFull } from '@/lib/format-date'
import { sectionTitleClass, sectionLabelClass } from '@/app/profile/ui'
import { adminBodyClass, adminMetadataClass, adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'

const EVENT_LABEL = { deactivation: 'Took a break', reactivation: 'Came back', deletion: 'Deleted account' } as const

/** Presentational half of Admin → Feedback → Account exits. */
export default function AccountExitFeedbackView({ windowKey, data }: { windowKey: string; data: AccountExitFeedback | null }) {
  const window = EXIT_FEEDBACK_WINDOWS.find((w) => w.key === windowKey) ?? EXIT_FEEDBACK_WINDOWS[1]
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className={sectionTitleClass}>Account exits</h1>
        <p className={adminMetadataClass}>
          Why members take a break or leave. Reasons are optional, so &ldquo;No reason given&rdquo; is common.
        </p>
        <div className="flex flex-wrap gap-2">
          {EXIT_FEEDBACK_WINDOWS.map((w) => (
            <Link
              key={w.key}
              href={`/admin/feedback/account-exits?window=${w.key}`}
              aria-current={w.key === window.key ? 'page' : undefined}
              className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${
                w.key === window.key ? 'bg-accent text-accent-foreground' : 'text-foreground/70 hover:text-foreground'
              }`}
            >
              {w.label}
            </Link>
          ))}
        </div>
      </div>

      {!data ? (
        <p className="text-sm text-red-600">Could not load account-exit feedback.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Breaks taken', data.deactivations],
              ['Came back', data.reactivations],
              ['Deleted accounts', data.deletions],
              ['On a break now', data.currentlyOnBreak],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-foreground/10 bg-background p-4">
                <dt className={adminMetadataClass}>{label}</dt>
                <dd className="mt-1 text-2xl font-medium text-foreground">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-6 sm:grid-cols-2">
            {(['deactivation', 'deletion'] as const).map((event) => {
              const rows = data.reasons.filter((r) => r.event === event)
              return (
                <section key={event} className="space-y-2">
                  <p className={sectionLabelClass}>{event === 'deactivation' ? 'Why members take a break' : 'Why members delete'}</p>
                  {rows.length === 0 ? (
                    <p className={adminMetadataClass}>Nothing in this period.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {rows.map((r) => (
                        <li key={r.reasonCode} className="flex items-baseline justify-between gap-3">
                          <span className={adminTableTextClass}>{reasonLabel(r.reasonCode)}</span>
                          <span className={adminTableSecondaryClass}>
                            {r.count} · {reasonShare(data, event, r.count)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>

          <section className="space-y-2">
            <p className={sectionLabelClass}>Recent</p>
            {data.recent.length === 0 ? (
              <p className={adminMetadataClass}>Nothing in this period.</p>
            ) : (
              <ul className="space-y-2">
                {data.recent.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="rounded-md border border-foreground/10 bg-background p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className={adminTableTextClass}>
                        {EVENT_LABEL[e.event]}
                        {e.event !== 'reactivation' && ` — ${reasonLabel(e.reasonCode)}`}
                      </span>
                      <span className={adminMetadataClass}>{formatDateTimeFull(e.at)}</span>
                    </div>
                    {e.detail && <p className={`mt-1 whitespace-pre-wrap ${adminBodyClass}`}>{e.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <p className={sectionLabelClass}>Why letters were passed on (&ldquo;Something else&rdquo;)</p>
            <p className={adminMetadataClass}>Private notes to Tempa — never shown to the person who wrote the letter.</p>
            {data.letterPassNotes.length === 0 ? (
              <p className={adminMetadataClass}>Nothing in this period.</p>
            ) : (
              <ul className="space-y-2">
                {data.letterPassNotes.map((n, i) => (
                  <li key={`${n.at}-${i}`} className="rounded-md border border-foreground/10 bg-background p-3">
                    <p className={`whitespace-pre-wrap ${adminBodyClass}`}>{n.detail}</p>
                    <p className={`mt-1 ${adminMetadataClass}`}>{formatDateTimeFull(n.at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
