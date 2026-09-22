import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getArrivalEmailPreference, setArrivalEmailPreference } from './email-preferences'

const USER = 'user-1'

function fakeClient(options: {
  row?: { arrival_emails_enabled: boolean } | null
  selectError?: { message: string; code?: string } | null
  rpcError?: { message: string; code?: string } | null
}) {
  const rpc = vi.fn(async () => ({ error: options.rpcError ?? null }))
  return {
    from(table: string) {
      expect(table).toBe('arrival_email_preferences')
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        async maybeSingle() {
          return { data: options.row ?? null, error: options.selectError ?? null }
        },
      }
    },
    rpc,
  }
}

describe('getArrivalEmailPreference', () => {
  it('no row yet → ok: true, enabled: true (the product default)', async () => {
    const client = fakeClient({ row: null })
    const result = await getArrivalEmailPreference(client as unknown as SupabaseClient, USER)
    expect(result).toEqual({ ok: true, enabled: true })
  })

  it('persisted false → ok: true, enabled: false', async () => {
    const client = fakeClient({ row: { arrival_emails_enabled: false } })
    const result = await getArrivalEmailPreference(client as unknown as SupabaseClient, USER)
    expect(result).toEqual({ ok: true, enabled: false })
  })

  it('persisted true → ok: true, enabled: true', async () => {
    const client = fakeClient({ row: { arrival_emails_enabled: true } })
    const result = await getArrivalEmailPreference(client as unknown as SupabaseClient, USER)
    expect(result).toEqual({ ok: true, enabled: true })
  })

  it('a genuine SELECT error surfaces as ok: false with the error — never silently collapsed to enabled: true', async () => {
    const client = fakeClient({ row: null, selectError: { message: 'connection reset', code: '57P01' } })
    const result = await getArrivalEmailPreference(client as unknown as SupabaseClient, USER)
    expect(result).toEqual({ ok: false, error: { message: 'connection reset', code: '57P01' } })
  })
})

describe('setArrivalEmailPreference', () => {
  it('calls the RPC with the given value and returns no error on success', async () => {
    const client = fakeClient({ rpcError: null })
    const { error } = await setArrivalEmailPreference(client as unknown as SupabaseClient, false)
    expect(error).toBeNull()
    expect(client.rpc).toHaveBeenCalledWith('set_arrival_email_preference', { p_enabled: false })
  })

  it('surfaces an RPC error rather than swallowing it', async () => {
    const client = fakeClient({ rpcError: { message: 'db down', code: '500' } })
    const { error } = await setArrivalEmailPreference(client as unknown as SupabaseClient, true)
    expect(error).toEqual({ message: 'db down', code: '500' })
  })
})
