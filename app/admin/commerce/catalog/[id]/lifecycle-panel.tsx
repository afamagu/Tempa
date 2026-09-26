'use client'

import { useState } from 'react'
import { lifecycleLabel, lifecycleTone, type ProductDetail } from '@/lib/admin-commerce'
import { inputClass } from '@/app/profile/ui'
import { adminTableSecondaryClass } from '@/app/admin/admin-ui'
import { Card, ConfirmAction, ErrorNote, Field, Pill, formatDate, useAdminAction } from '../../ui'

/**
 * Draft → complete the checklist → publish now or schedule (published with
 * a future start) → remove from sale / retire. The server re-checks the
 * checklist; this panel explains it.
 */
export default function LifecyclePanel({ detail }: { detail: ProductDetail }) {
  const p = detail.product
  const { run, error } = useAdminAction()
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const label = lifecycleLabel(p.lifecycle_state, p.publish_at)
  const required = detail.readiness.filter((c) => c.required)
  const ready = required.every((c) => c.ok)
  const live = p.lifecycle_state === 'published'

  const set = (state: string, reason: string, extra: Record<string, unknown> = {}) =>
    run('admin_commerce_set_lifecycle', { p_product_id: p.id, p_state: state, p_reason: reason || null, ...extra })

  return (
    <Card title="Publishing" action={<Pill tone={lifecycleTone(label)}>{label}</Pill>}>
      {live && (p.publish_at || p.unpublish_at) && (
        <p className={adminTableSecondaryClass}>
          {p.publish_at ? `Starts ${formatDate(p.publish_at)}. ` : ''}
          {p.unpublish_at ? `Ends ${formatDate(p.unpublish_at)}.` : ''}
        </p>
      )}

      <ul className="space-y-1.5" aria-label="Publishing checklist">
        {detail.readiness.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-[14px]">
            <span aria-hidden="true" className={c.ok ? 'text-accent' : c.required ? 'text-red-700' : 'text-muted'}>
              {c.ok ? '✓' : c.required ? '•' : '○'}
            </span>
            <span className={c.ok ? 'text-foreground/80' : 'text-foreground'}>
              {c.label}
              {!c.required && <span className="text-muted"> (recommended)</span>}
              <span className="sr-only">{c.ok ? ' — done' : c.required ? ' — required, missing' : ' — optional, missing'}</span>
            </span>
          </li>
        ))}
      </ul>

      {!live && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start (optional)" hint="Leave empty to publish now. A future time schedules it.">
            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={inputClass} />
          </Field>
          <Field label="End (optional)" hint="Automatically leaves sale at this time.">
            <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className={inputClass} />
          </Field>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!live && (
          <ConfirmAction
            label={startAt ? 'Schedule' : 'Publish'}
            disabled={!ready}
            message={
              startAt
                ? `Schedule “${p.title}” to go on sale ${formatDate(new Date(startAt).toISOString())}?`
                : `Publish “${p.title}”? Members will see it in Postcards${p.is_complimentary ? '' : ' with its price'}.`
            }
            reason
            compact={false}
            onConfirm={(reason) =>
              set('published', reason, {
                p_publish_at: startAt ? new Date(startAt).toISOString() : null,
                p_unpublish_at: endAt ? new Date(endAt).toISOString() : null,
              })
            }
          />
        )}
        {live && (
          <ConfirmAction
            label="Remove from sale"
            message="Members will no longer see or buy it. Everyone who owns it keeps it."
            reason
            reasonRequired
            onConfirm={(reason) => set('inactive', reason)}
          />
        )}
        {p.lifecycle_state !== 'retired' && (
          <ConfirmAction
            label="Retire"
            danger
            message="Retire permanently from sale? Owners keep it; you can’t publish it again without moving it back to draft."
            reason
            reasonRequired
            onConfirm={(reason) => set('retired', reason)}
          />
        )}
        {(p.lifecycle_state === 'inactive' || p.lifecycle_state === 'retired') && (
          <ConfirmAction label="Back to draft" message="Move back to draft for editing?" onConfirm={(reason) => set('draft', reason)} />
        )}
      </div>
      {!live && !ready && <p className={adminTableSecondaryClass}>Complete the required items above to publish.</p>}
      <ErrorNote error={error} />
    </Card>
  )
}
