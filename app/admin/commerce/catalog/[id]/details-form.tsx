'use client'

import { useState } from 'react'
import type { ProductDetail } from '@/lib/admin-commerce'
import { inputClass, primaryButtonClass } from '@/app/profile/ui'
import { adminTableSecondaryClass } from '@/app/admin/admin-ui'
import { Card, ErrorNote, Field, selectClass, useAdminAction } from '../../ui'

const POLICIES = [
  { value: 'still_only', label: 'Still only' },
  { value: 'controlled_full', label: 'Member may preview the full motion' },
  { value: 'controlled_teaser', label: 'Member may preview a short motion teaser' },
  { value: 'none', label: 'No preview' },
]

export default function DetailsForm({ product: p }: { product: ProductDetail['product'] }) {
  const { run, pending, error } = useAdminAction()
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    title: p.title,
    short_description: p.short_description ?? '',
    story_description: p.story_description ?? '',
    preview_policy: p.preview_policy,
    is_complimentary: p.is_complimentary,
    credit_amount: p.credit_amount === null ? '' : String(p.credit_amount),
    display_order: String(p.display_order ?? 0),
  })
  const live = p.lifecycle_state === 'published'
  const canBeComplimentary = ['postcard', 'gift', 'keepsake_template'].includes(p.product_type)
  const up = (k: keyof typeof form, v: string | boolean) => {
    setSaved(false)
    setForm((f) => ({ ...f, [k]: v }))
  }

  function patch() {
    const out: Record<string, unknown> = {}
    if (form.title.trim() !== p.title) out.title = form.title.trim()
    if (form.short_description.trim() !== (p.short_description ?? '')) out.short_description = form.short_description
    if (form.story_description.trim() !== (p.story_description ?? '')) out.story_description = form.story_description
    if (form.preview_policy !== p.preview_policy) out.preview_policy = form.preview_policy
    if (canBeComplimentary && form.is_complimentary !== p.is_complimentary) out.is_complimentary = form.is_complimentary
    if (p.product_type === 'credit_pack' && form.credit_amount !== String(p.credit_amount ?? '')) out.credit_amount = Number(form.credit_amount)
    if (Number(form.display_order) !== (p.display_order ?? 0)) out.display_order = Number(form.display_order) || 0
    return out
  }

  return (
    <Card title="Details">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault()
          const changes = patch()
          if (Object.keys(changes).length === 0) return
          if (await run('admin_commerce_update_product', { p_product_id: p.id, p_patch: changes, p_reason: null })) setSaved(true)
        }}
      >
        <Field label="Title">
          <input value={form.title} onChange={(e) => up('title', e.target.value)} maxLength={140} className={inputClass} />
        </Field>
        <Field label="Short description" hint="One or two lines shown on the product page.">
          <input value={form.short_description} onChange={(e) => up('short_description', e.target.value)} maxLength={280} className={inputClass} />
        </Field>
        {p.product_type !== 'credit_pack' && (
          <Field label="Story (optional)">
            <textarea value={form.story_description} onChange={(e) => up('story_description', e.target.value)} maxLength={4000} rows={3} className={inputClass} />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {p.product_type !== 'credit_pack' && p.product_type !== 'bundle' && (
            <Field label="Motion preview">
              <select value={form.preview_policy} onChange={(e) => up('preview_policy', e.target.value)} className={selectClass}>
                {POLICIES.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {p.product_type === 'credit_pack' && (
            <Field label="Credits granted" hint={live ? 'Remove from sale to change this.' : undefined}>
              <input inputMode="numeric" disabled={live} value={form.credit_amount} onChange={(e) => up('credit_amount', e.target.value.replace(/\D/g, ''))} className={inputClass} />
            </Field>
          )}
          <Field label="Display order" hint="Lower numbers appear first.">
            <input inputMode="numeric" value={form.display_order} onChange={(e) => up('display_order', e.target.value.replace(/[^\d-]/g, ''))} className={inputClass} />
          </Field>
        </div>
        {canBeComplimentary && (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-[15px]">
              <input type="checkbox" disabled={live} checked={form.is_complimentary} onChange={(e) => up('is_complimentary', e.target.checked)} />
              Complimentary — anyone can send it, no Credits
            </label>
            {live && <p className={adminTableSecondaryClass}>Remove from sale to switch between Complimentary and paid.</p>}
          </div>
        )}
        <ErrorNote error={error} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}>
            {pending ? 'Saving…' : 'Save details'}
          </button>
          {saved && <span className="text-[14px] text-accent">Saved</span>}
        </div>
      </form>
    </Card>
  )
}
