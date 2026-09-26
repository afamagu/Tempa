'use client'

import { useRef, useState } from 'react'
import { formatCredits, newAdminKey } from '@/lib/admin-commerce'
import { inputClass, primaryButtonClass, compactSecondaryButtonClass } from '@/app/profile/ui'
import { ErrorNote, Field, selectClass, useAdminAction } from '../ui'

type Kind = 'promotional_grant' | 'complimentary_grant' | 'correction'

/**
 * Grant or correct Credits for one member. Two steps (enter → confirm with
 * the resulting balance), one idempotency key per intent so a retry after
 * a network failure never grants twice. Works while member commerce is
 * OFF. Never a refund/chargeback substitute.
 */
export default function CreditOperation({ memberId, memberLabel, balance, closed }: { memberId: string; memberLabel: string; balance: number; closed: boolean }) {
  const { run, pending, error, setError } = useAdminAction()
  const [kind, setKind] = useState<Kind>('promotional_grant')
  const [sign, setSign] = useState<1 | -1>(1)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const intent = useRef<string | null>(null)

  const delta = (kind === 'correction' ? sign : 1) * (Number(amount) || 0)
  const after = balance + delta
  const valid = Number(amount) > 0 && reason.trim().length > 0 && !(kind !== 'correction' && closed)

  async function submit() {
    if (!intent.current) intent.current = newAdminKey(kind === 'correction' ? 'adj' : 'grant')
    const ok =
      kind === 'correction'
        ? await run('admin_adjust_credits', { p_user_id: memberId, p_delta: delta, p_reason: reason.trim(), p_idempotency_key: intent.current })
        : await run('admin_grant_credits', { p_user_id: memberId, p_amount: delta, p_kind: kind, p_reason: reason.trim(), p_idempotency_key: intent.current })
    if (ok) {
      setDone(`${kind === 'correction' ? 'Corrected' : 'Granted'} ${delta > 0 ? '+' : ''}${delta}. New balance ${formatCredits(after)}.`)
      intent.current = null
      setAmount('')
      setReason('')
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Action">
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind)
              intent.current = null
              setConfirming(false)
            }}
            className={selectClass}
          >
            <option value="promotional_grant">Promotional grant</option>
            <option value="complimentary_grant">Complimentary grant</option>
            <option value="correction">Correction (±)</option>
          </select>
        </Field>
        <Field label="Credits">
          <div className="flex gap-2">
            {kind === 'correction' && (
              <select aria-label="Add or remove" value={sign} onChange={(e) => setSign(Number(e.target.value) as 1 | -1)} className={`${selectClass} !w-20`}>
                <option value={1}>+</option>
                <option value={-1}>−</option>
              </select>
            )}
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value.replace(/\D/g, ''))
                intent.current = null
                setConfirming(false)
                setDone(null)
              }}
              className={inputClass}
            />
          </div>
        </Field>
        <Field label="Reason" hint="Required. Recorded in the ledger and audit log.">
          <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className={inputClass} />
        </Field>
      </div>

      {confirming ? (
        <div className="space-y-2 rounded-md border border-foreground/15 bg-foreground/[.02] p-3">
          <p className="text-[15px]">
            {kind === 'correction' ? 'Correct' : 'Grant'} <span className="font-medium">{delta > 0 ? '+' : ''}{delta}</span> for {memberLabel}: {formatCredits(balance)} →{' '}
            <span className="font-medium">{formatCredits(after)}</span>
          </p>
          {after < 0 && <p className="text-[14px] text-red-700">A correction can’t take the balance below zero.</p>}
          <div className="flex gap-2">
            <button type="button" disabled={pending || after < 0} onClick={submit} className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}>
              {pending ? 'Recording…' : 'Confirm'}
            </button>
            <button type="button" className={compactSecondaryButtonClass} onClick={() => setConfirming(false)} disabled={pending}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={!valid}
          className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}
          onClick={() => {
            setError(null)
            setDone(null)
            setConfirming(true)
          }}
        >
          Review
        </button>
      )}
      {closed && kind !== 'correction' && <p className="text-[14px] text-muted">Grants aren’t possible for a closed account.</p>}
      <ErrorNote error={error} />
      {done && (
        <p className="text-[14px] text-accent" role="status">
          {done}
        </p>
      )}
    </div>
  )
}
