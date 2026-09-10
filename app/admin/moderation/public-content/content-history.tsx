'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { listContentAudit, type ContentAuditRow, type ContentType } from '@/lib/admin-moderation'
import { helperTextClass } from '@/app/profile/ui'
import { formatDateTimeFull } from '@/lib/format-date'

/** An on-demand disclosure of one content item's own moderation
 * history — never auto-loaded for every row in a list (bounded work,
 * only fetched if a moderator actually asks). Reasons/actor identity
 * are staff-only regardless (admin_list_content_audit's own gate) — this
 * component only ever renders inside an already-staff-gated page. */
export default function ContentHistory({ contentType, contentId }: { contentType: ContentType; contentId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<ContentAuditRow[] | null>(null)

  async function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (rows !== null) return
    setLoading(true)
    const { data } = await listContentAudit(createClient(), { targetType: contentType, targetId: contentId })
    setRows(data)
    setLoading(false)
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="text-[12px] font-medium text-foreground/60 underline decoration-foreground/25 underline-offset-4 hover:text-foreground"
      >
        {open ? 'Hide history' : 'History'}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {loading && <p className={helperTextClass}>Loading…</p>}
          {!loading && rows?.length === 0 && <p className={helperTextClass}>No moderation history yet.</p>}
          {!loading &&
            rows?.map((r) => (
              <div key={r.id} className="text-[12px] text-foreground/70">
                <span className="font-medium text-foreground">{r.actorIdentifierSnapshot}</span>{' '}
                {r.action.replace('_', ' ')} — {formatDateTimeFull(r.createdAt)}
                {r.reason && <span className="block text-foreground/60">{r.reason}</span>}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
