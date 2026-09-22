import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getArrivalEmailPreference, setArrivalEmailPreference } from './email-preferences'

const USER = 'user-1'

function fakeClient(options: {
  row?: { arrival_emails_enabled: boolean } | null
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
          return { data: options.row ?? null, error: null }
        },
      }
    },
    rpc,
  }
}

describe('getArrivalEmailPreference', () => {
  it('defaults to true (enabled) when no row exists yet', async () => {
    const client = fakeClient({ row: null })
    expect(await getArrivalEmailPreference(client as unknown as SupabaseClient, USER)).toBe(true)
  })

  it('reads back an explicit false', async () => {
    const client = fakeClient({ row: { arrival_emails_enabled: false } })
    expect(await getArrivalEmailPreference(client as unknown as SupabaseClient, USER)).toBe(false)
  })

  it('reads back an explicit true', async () => {
    const client = fakeClient({ row: { arrival_emails_enabled: true } })
    expect(await getArrivalEmailPreference(client as unknown as SupabaseClient, USER)).toBe(true)
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
