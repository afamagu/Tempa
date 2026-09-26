import { createClient } from '@/lib/supabase/server'
import { auditActionLabel, auditSummary, callAdminCommerce, type AuditRow } from '@/lib/admin-commerce'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Card, Empty, formatDate } from '../ui'

export default async function CommerceAuditPage() {
  const supabase = await createClient()
  const { data, error } = await callAdminCommerce<AuditRow[]>(supabase, 'admin_commerce_audit', { p_limit: 200 })
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Audit</h1>
        <p className={adminMetadataClass}>Every commerce change: who, what, when and why.</p>
      </div>
      {error ? (
        <p className="text-[14px] text-red-700">{error.message}</p>
      ) : (data ?? []).length === 0 ? (
        <Empty>No commerce changes recorded yet.</Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-foreground/10">
            {data!.map((r) => (
              <li key={r.id} className="space-y-0.5 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className={adminTableTextClass}>
                    <span className="font-medium">{auditActionLabel(r.action)}</span>
                    {r.target ? ` · ${r.target}` : ''}
                  </p>
                  <p className={adminTableSecondaryClass}>
                    {r.actor} · {formatDate(r.created_at)}
                  </p>
                </div>
                {auditSummary(r) && <p className={adminTableSecondaryClass}>{auditSummary(r)}</p>}
                {r.reason && <p className={adminTableSecondaryClass}>“{r.reason}”</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
