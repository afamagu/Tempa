'use client'

import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { callAdminCommerce, type AdminCommerceError } from '@/lib/admin-commerce'
import { compactSecondaryButtonClass, inputClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'

/**
 * Admin → Commerce shared pieces. Calm by default: quiet status pills,
 * compact cards, progressive disclosure, and every consequential action
 * behind a confirmation (with a reason where the audit log records one).
 */

export function Pill({ tone = 'quiet', children }: { tone?: 'good' | 'warn' | 'quiet' | 'bad'; children: React.ReactNode }) {
  const cls = {
    good: 'bg-accent/10 text-accent',
    warn: 'bg-clay/15 text-foreground/80',
    quiet: 'bg-foreground/[.06] text-foreground/70',
    bad: 'bg-red-600/10 text-red-700',
  }[tone]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium ${cls}`}>{children}</span>
}

export function Card({ title, action, children, note }: { title?: string; action?: React.ReactNode; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-foreground/10 bg-background p-4 sm:p-5">
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-0.5">
            {title && <h2 className="text-[16px] font-medium text-foreground">{title}</h2>}
            {note && <p className={adminMetadataClass}>{note}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-foreground/10 px-3 py-2.5">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="text-[20px] font-medium text-foreground">{value}</p>
      {hint && <p className="text-[12px] text-muted">{hint}</p>}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-foreground/15 px-4 py-6 text-center text-[14px] text-muted">{children}</p>
}

export function ErrorNote({ error }: { error: AdminCommerceError | null }) {
  if (!error) return null
  return (
    <p role="alert" className="text-[14px] text-red-700">
      {error.message}
    </p>
  )
}

/** Calls an admin RPC, surfaces the admin-facing explanation, refreshes on success. */
export function useAdminAction() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AdminCommerceError | null>(null)
  const busy = useRef(false)
  async function run<T = unknown>(fn: string, args: Record<string, unknown>, onDone?: (data: T) => void): Promise<boolean> {
    if (busy.current) return false
    busy.current = true
    setPending(true)
    setError(null)
    const res = await callAdminCommerce<T>(createClient(), fn, args)
    busy.current = false
    setPending(false)
    if (res.error) {
      setError(res.error)
      return false
    }
    onDone?.(res.data as T)
    router.refresh()
    return true
  }
  return { run, pending, error, setError }
}

/**
 * A button that opens an inline confirmation. With `reason`, the admin must
 * type a reason (recorded in the audit log) before confirming.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  message,
  reason,
  reasonRequired,
  danger,
  compact = true,
  disabled,
  onConfirm,
}: {
  label: string
  confirmLabel?: string
  message: string
  reason?: boolean
  reasonRequired?: boolean
  danger?: boolean
  compact?: boolean
  disabled?: boolean
  onConfirm: (reason: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const id = useId()
  if (!open) {
    return (
      <button type="button" disabled={disabled} className={`${compact ? compactSecondaryButtonClass : secondaryButtonClass} ${danger ? 'text-red-700' : ''} disabled:opacity-50`} onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }
  const blocked = busy || (reasonRequired && text.trim().length === 0)
  return (
    <div className="w-full space-y-2 rounded-md border border-foreground/15 bg-foreground/[.02] p-3" role="group" aria-labelledby={`${id}-msg`}>
      <p id={`${id}-msg`} className="text-[14px] text-foreground">
        {message}
      </p>
      {reason && (
        <label className="block space-y-1">
          <span className="text-[13px] text-muted">Reason{reasonRequired ? '' : ' (optional)'} — recorded in the audit log</span>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} className={inputClass} />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={blocked}
          className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}
          onClick={async () => {
            setBusy(true)
            const ok = await onConfirm(text.trim())
            setBusy(false)
            if (ok) {
              setOpen(false)
              setText('')
            }
          }}
        >
          {busy ? 'Working…' : (confirmLabel ?? label)}
        </button>
        <button type="button" className={compactSecondaryButtonClass} onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[14px] font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[13px] text-muted">{hint}</span>}
    </label>
  )
}

export const selectClass = `${inputClass} appearance-auto`

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
}
