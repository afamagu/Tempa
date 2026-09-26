'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { newIdempotencyKey, purchaseProduct, type CommerceError, type PurchaseResult } from '@/lib/commerce'

export type UnlockFn = (
  productId: string,
  idempotencyKey: string
) => Promise<{ data: PurchaseResult; error: null } | { data: null; error: CommerceError }>

export const defaultUnlock: UnlockFn = (productId, key) => purchaseProduct(createClient(), productId, key)

export type UnlockStatus =
  | { phase: 'idle' }
  | { phase: 'confirming' }
  | { phase: 'pending' }
  | { phase: 'done' }
  | { phase: 'error'; message: string; code: CommerceError['code'] }

/**
 * One unlock intent per product. The idempotency key is created when the
 * member first confirms and REUSED for every retry of that same intent
 * (a network failure followed by "Try again" can never charge twice —
 * the server returns the original purchase). A second click while a
 * request is in flight is ignored. The caller never sends a price.
 */
export function useUnlock(unlock: UnlockFn, onUnlocked: (productId: string, balance: number) => void) {
  const [status, setStatus] = useState<UnlockStatus>({ phase: 'idle' })
  const inFlight = useRef(false)
  const intent = useRef<{ productId: string; key: string } | null>(null)

  async function confirm(productId: string) {
    if (inFlight.current) return
    inFlight.current = true
    if (!intent.current || intent.current.productId !== productId) intent.current = { productId, key: newIdempotencyKey() }
    setStatus({ phase: 'pending' })
    try {
      const res = await unlock(productId, intent.current.key)
      if (res.error) {
        setStatus({ phase: 'error', message: res.error.message, code: res.error.code })
        return
      }
      intent.current = null
      onUnlocked(productId, res.data.balance)
      setStatus({ phase: 'done' })
    } catch {
      setStatus({ phase: 'error', message: 'Something went wrong. Please try again.', code: 'unexpected' })
    } finally {
      inFlight.current = false
    }
  }

  return {
    status,
    begin: () => setStatus({ phase: 'confirming' }),
    cancel: () => setStatus({ phase: 'idle' }),
    confirm,
    reset: () => {
      intent.current = null
      setStatus({ phase: 'idle' })
    },
  }
}
