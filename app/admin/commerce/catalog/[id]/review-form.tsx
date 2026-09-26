'use client'

import { useState } from 'react'
import type { ProductDetail } from '@/lib/admin-commerce'
import { inputClass, primaryButtonClass } from '@/app/profile/ui'
import { Card, ErrorNote, Field, selectClass, useAdminAction } from '../../ui'

const RIGHTS = ['not_required', 'pending', 'approved', 'rejected']
const CULTURAL = ['not_required', 'pending', 'approved', 'hold', 'rejected']
const LABEL: Record<string, string> = { not_required: 'Not required', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', hold: 'On hold' }

/**
 * Internal-only review. These fields are never readable by members
 * (column grants, 2026-10-22/23). A pending, held or rejected review
 * blocks publishing; putting a live product on hold removes it from sale.
 */
export default function ReviewForm({ product: p }: { product: ProductDetail['product'] }) {
  const { run, pending, error } = useAdminAction()
  const [saved, setSaved] = useState(false)
  const [f, setF] = useState({
    rights_review_state: p.rights_review_state,
    rights_review_notes: p.rights_review_notes ?? '',
    cultural_review_state: p.cultural_review_state,
    cultural_review_notes: p.cultural_review_notes ?? '',
  })
  const up = (k: keyof typeof f, v: string) => {
    setSaved(false)
    setF((x) => ({ ...x, [k]: v }))
  }
  return (
    <Card title="Rights & cultural review" note="Internal — never shown to members.">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault()
          const patch: Record<string, string> = {}
          if (f.rights_review_state !== p.rights_review_state) patch.rights_review_state = f.rights_review_state
          if (f.rights_review_notes !== (p.rights_review_notes ?? '')) patch.rights_review_notes = f.rights_review_notes
          if (f.cultural_review_state !== p.cultural_review_state) patch.cultural_review_state = f.cultural_review_state
          if (f.cultural_review_notes !== (p.cultural_review_notes ?? '')) patch.cultural_review_notes = f.cultural_review_notes
          if (Object.keys(patch).length === 0) return
          if (await run('admin_commerce_update_product', { p_product_id: p.id, p_patch: patch, p_reason: 'review update' })) setSaved(true)
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Rights review">
            <select value={f.rights_review_state} onChange={(e) => up('rights_review_state', e.target.value)} className={selectClass}>
              {RIGHTS.map((s) => (
                <option key={s} value={s}>
                  {LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cultural review">
            <select value={f.cultural_review_state} onChange={(e) => up('cultural_review_state', e.target.value)} className={selectClass}>
              {CULTURAL.map((s) => (
                <option key={s} value={s}>
                  {LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rights notes">
            <textarea value={f.rights_review_notes} onChange={(e) => up('rights_review_notes', e.target.value)} maxLength={2000} rows={2} className={inputClass} />
          </Field>
          <Field label="Cultural notes">
            <textarea value={f.cultural_review_notes} onChange={(e) => up('cultural_review_notes', e.target.value)} maxLength={2000} rows={2} className={inputClass} />
          </Field>
        </div>
        {p.lifecycle_state === 'published' && (
          <p className="text-[13px] text-muted">Setting a review to pending, on hold or rejected removes this product from sale immediately.</p>
        )}
        <ErrorNote error={error} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}>
            {pending ? 'Saving…' : 'Save review'}
          </button>
          {saved && <span className="text-[14px] text-accent">Saved</span>}
        </div>
      </form>
    </Card>
  )
}
