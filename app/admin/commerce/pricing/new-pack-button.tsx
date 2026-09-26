'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { compactSecondaryButtonClass, inputClass, primaryButtonClass } from '@/app/profile/ui'
import { ErrorNote, Field, useAdminAction } from '../ui'

export default function NewPackButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [credits, setCredits] = useState('')
  const { run, pending, error } = useAdminAction()
  if (!open) {
    return (
      <button type="button" className={compactSecondaryButtonClass} onClick={() => setOpen(true)}>
        New Credit pack
      </button>
    )
  }
  return (
    <form
      className="w-full space-y-3 rounded-md border border-foreground/10 bg-foreground/[.02] p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        await run<string>('admin_commerce_create_product', { p_product_type: 'credit_pack', p_title: title, p_is_complimentary: false, p_credit_amount: Number(credits), p_entitlement_model: null }, (id) =>
          router.push(`/admin/commerce/catalog/${id}`)
        )
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" hint="e.g. “300 Credits”">
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={140} className={inputClass} />
        </Field>
        <Field label="Credits granted">
          <input inputMode="numeric" value={credits} onChange={(e) => setCredits(e.target.value.replace(/\D/g, ''))} required className={inputClass} />
        </Field>
      </div>
      <p className="text-[13px] text-muted">Created as a draft. Add local prices on the next screen, then publish when ready.</p>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending || !title || !credits} className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}>
          Create draft pack
        </button>
        <button type="button" className={compactSecondaryButtonClass} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
