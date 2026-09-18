import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MAX_MARK_PNG_BYTES,
  persistGeneratedMark,
  reserveProfileMark,
  validateGeneratedMarkPng,
} from './profile-marks'

const pending = { mark_id: '73077198-d917-4bc8-9913-de6c42fe7e61', object_name: '73077198-d917-4bc8-9913-de6c42fe7e61.png', uploaded: false }

function client(options: { uploaded?: boolean; uploadError?: boolean; recoveredUploaded?: boolean; finalizeError?: boolean } = {}) {
  let reserveCount = 0
  const upload = vi.fn().mockResolvedValue({ error: options.uploadError ? new Error('uncertain') : null })
  const from = vi.fn(() => ({
    upload,
    getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://example.test/mark.png' } })),
  }))
  const rpc = vi.fn(async (name: string) => {
    if (name === 'reserve_profile_mark') {
      reserveCount += 1
      const uploaded = reserveCount === 1 ? options.uploaded : options.recoveredUploaded
      return { data: [{ ...pending, uploaded: Boolean(uploaded) }], error: null }
    }
    if (name === 'finalize_profile_mark') {
      return { data: options.finalizeError ? null : pending.mark_id, error: options.finalizeError ? new Error('lost') : null }
    }
    throw new Error(`Unexpected RPC ${name}`)
  })
  return { supabase: { rpc, storage: { from } } as unknown as SupabaseClient, rpc, from, upload }
}

describe('production Mark persistence boundary', () => {
  it('accepts only PNG output at or below one MiB', () => {
    expect(validateGeneratedMarkPng(new Blob(['mark'], { type: 'image/png' }))).toBeNull()
    expect(validateGeneratedMarkPng(new Blob(['mark'], { type: 'image/jpeg' }))).toMatch(/valid PNG/)
    expect(validateGeneratedMarkPng(new Blob([new Uint8Array(MAX_MARK_PNG_BYTES + 1)], { type: 'image/png' }))).toMatch(/too large/)
  })

  it('uses the opaque reservation path and uploads only the supplied generated PNG without overwrite', async () => {
    const fake = client()
    const generated = new Blob(['generated-v2'], { type: 'image/png' })
    const reservation = await reserveProfileMark(fake.supabase)
    await persistGeneratedMark(fake.supabase, generated, reservation)

    expect(reservation.objectName).toBe(`${reservation.markId}.png`)
    expect(fake.from).toHaveBeenCalledWith('profile-marks')
    expect(fake.upload).toHaveBeenCalledWith(reservation.objectName, generated, {
      contentType: 'image/png',
      upsert: false,
    })
    expect(fake.rpc).toHaveBeenCalledWith('finalize_profile_mark', { p_mark_id: reservation.markId })
  })

  it('never uploads again when the pending reservation is already uploaded', async () => {
    const fake = client({ uploaded: true })
    const reservation = await reserveProfileMark(fake.supabase)
    await persistGeneratedMark(fake.supabase, null, reservation)
    expect(fake.upload).not.toHaveBeenCalled()
    expect(fake.rpc).toHaveBeenLastCalledWith('finalize_profile_mark', { p_mark_id: reservation.markId })
  })

  it('recovers an ambiguous upload result by re-reading the one pending candidate and never overwriting it', async () => {
    const fake = client({ uploadError: true, recoveredUploaded: true })
    await persistGeneratedMark(fake.supabase, new Blob(['generated-v2'], { type: 'image/png' }))
    expect(fake.upload).toHaveBeenCalledTimes(1)
    expect(fake.rpc.mock.calls.filter(([name]) => name === 'reserve_profile_mark')).toHaveLength(2)
    expect(fake.rpc).toHaveBeenLastCalledWith('finalize_profile_mark', { p_mark_id: pending.mark_id })
  })

  it('does not finalize when an ambiguous upload is not confirmed by reservation recovery', async () => {
    const fake = client({ uploadError: true, recoveredUploaded: false })
    await expect(persistGeneratedMark(fake.supabase, new Blob(['generated-v2'], { type: 'image/png' }))).rejects.toMatchObject({ phase: 'upload' })
    expect(fake.rpc.mock.calls.some(([name]) => name === 'finalize_profile_mark')).toBe(false)
  })

  it('leaves an uploaded pending candidate recoverable when finalization fails', async () => {
    const fake = client({ uploaded: true, finalizeError: true })
    const reservation = await reserveProfileMark(fake.supabase)
    await expect(persistGeneratedMark(fake.supabase, null, reservation)).rejects.toMatchObject({ phase: 'finalization' })
    expect(fake.upload).not.toHaveBeenCalled()
  })
})
