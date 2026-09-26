'use client'

import { useState } from 'react'
import { PRODUCT_TYPE_LABELS, type ProductType } from '@/lib/admin-commerce'
import { inputClass } from '@/app/profile/ui'
import { ConfirmAction, ErrorNote, Field, selectClass, useAdminAction } from '../ui'

const PURPOSES = [
  { value: 'official_use', label: 'Official use (e.g. official Dispatch artwork)' },
  { value: 'support', label: 'Support' },
  { value: 'compensation', label: 'Compensation' },
  { value: 'other', label: 'Other' },
]

export default function GrantEntitlement({
  memberId,
  memberLabel,
  owned,
  products,
}: {
  memberId: string
  memberLabel: string
  owned: string[]
  products: { id: string; title: string; type: ProductType }[]
}) {
  const { run, error } = useAdminAction()
  const [productId, setProductId] = useState('')
  const [purpose, setPurpose] = useState('official_use')
  const [reason, setReason] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const available = products.filter((p) => !owned.includes(p.id))
  const product = products.find((p) => p.id === productId)

  if (products.length === 0) return <p className="text-[14px] text-muted">There are no premium products to grant yet.</p>

  return (
    <div className="space-y-3 border-t border-foreground/10 pt-3">
      <p className="text-[15px]">
        Granting to <span className="font-medium">{memberLabel}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Product">
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className={selectClass}>
            <option value="">Choose…</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({PRODUCT_TYPE_LABELS[p.type]})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Purpose">
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className={selectClass}>
            {PURPOSES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reason" hint="Required.">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={inputClass} />
        </Field>
      </div>
      <ConfirmAction
        label="Grant"
        compact={false}
        disabled={!productId || !reason.trim()}
        message={`Grant “${product?.title ?? ''}” to ${memberLabel} for ${PURPOSES.find((p) => p.value === purpose)?.label.toLowerCase()}? They will be able to send it; no Credits are charged.`}
        onConfirm={() =>
          run<{ status: string }>('admin_commerce_grant_entitlement', { p_user_id: memberId, p_product_id: productId, p_purpose: purpose, p_reason: reason.trim() }, (d) => {
            setDone(d.status === 'already_owned' ? 'They already own it — nothing changed.' : 'Granted.')
            setProductId('')
            setReason('')
          })
        }
      />
      <ErrorNote error={error} />
      {done && (
        <p role="status" className="text-[14px] text-accent">
          {done}
        </p>
      )}
    </div>
  )
}
