import type { SupabaseClient } from '@supabase/supabase-js'

export const PROFILE_MARKS_BUCKET = 'profile-marks'
export const MAX_MARK_PNG_BYTES = 1024 * 1024

export type ProfileMarkReservation = {
  markId: string
  objectName: string
  uploaded: boolean
}

export type ProfileMarkManagementStatus = {
  markId: string | null
  canChange: boolean
  nextChangeAt: string | null
}

type ReservationRow = {
  mark_id: string
  object_name: string
  uploaded: boolean
}

export class ProfileMarkPersistenceError extends Error {
  constructor(
    message: string,
    public readonly phase: 'reservation' | 'upload' | 'finalization' | 'discard'
  ) {
    super(message)
  }
}

export function validateGeneratedMarkPng(blob: Blob): string | null {
  if (blob.type !== 'image/png') return 'Tempa could not create a valid PNG Mark.'
  if (blob.size > MAX_MARK_PNG_BYTES) return 'This Mark is too large to save. Please choose another photograph.'
  return null
}

function toReservation(row: ReservationRow): ProfileMarkReservation {
  return { markId: row.mark_id, objectName: row.object_name, uploaded: row.uploaded }
}

export async function reserveProfileMark(supabase: SupabaseClient): Promise<ProfileMarkReservation> {
  const { data, error } = await supabase.rpc('reserve_profile_mark')
  const row = (data as ReservationRow[] | null)?.[0]
  if (error || !row) {
    throw new ProfileMarkPersistenceError('Your Mark could not be prepared. Please try again.', 'reservation')
  }
  return toReservation(row)
}

export function publicProfileMarkUrl(supabase: SupabaseClient, objectName: string): string {
  return supabase.storage.from(PROFILE_MARKS_BUCKET).getPublicUrl(objectName).data.publicUrl
}

/** Owner-only status returned by the server-enforced cooldown RPC. */
export async function getProfileMarkManagementStatus(
  supabase: SupabaseClient
): Promise<ProfileMarkManagementStatus> {
  const { data, error } = await supabase.rpc('get_profile_mark_management_status')
  const row = (data as { mark_id: string | null; can_change: boolean; next_change_at: string | null }[] | null)?.[0]
  if (error || !row) {
    throw new ProfileMarkPersistenceError('Your Mark settings could not be loaded. Please try again.', 'reservation')
  }
  return { markId: row.mark_id, canChange: row.can_change, nextChangeAt: row.next_change_at }
}

/**
 * Persists only a generated PNG. A source File is deliberately not an
 * accepted input type, keeping the privacy boundary structural rather
 * than dependent on caller discipline.
 */
export async function persistGeneratedMark(
  supabase: SupabaseClient,
  generatedPng: Blob | null,
  initialReservation?: ProfileMarkReservation
): Promise<string> {
  let reservation = initialReservation ?? (await reserveProfileMark(supabase))

  if (!reservation.uploaded) {
    if (!generatedPng) {
      throw new ProfileMarkPersistenceError('Choose a photograph before continuing.', 'upload')
    }
    const validationError = validateGeneratedMarkPng(generatedPng)
    if (validationError) throw new ProfileMarkPersistenceError(validationError, 'upload')

    const { error: uploadError } = await supabase.storage
      .from(PROFILE_MARKS_BUCKET)
      .upload(reservation.objectName, generatedPng, { contentType: 'image/png', upsert: false })

    if (uploadError) {
      // The response may have been lost after Storage accepted the
      // object. Re-read the deterministic pending reservation before
      // reporting failure; never retry as an overwrite.
      const recovered = await reserveProfileMark(supabase)
      if (!recovered.uploaded) {
        throw new ProfileMarkPersistenceError('Your Mark could not be saved. Please try again.', 'upload')
      }
      reservation = recovered
    } else {
      reservation = { ...reservation, uploaded: true }
    }
  }

  const { data, error: finalizeError } = await supabase.rpc('finalize_profile_mark', {
    p_mark_id: reservation.markId,
  })
  if (finalizeError || !data) {
    throw new ProfileMarkPersistenceError('Your Mark is safe, but could not be finalized. Please try again.', 'finalization')
  }
  return data as string
}

/** Uploaded pending Marks require an explicit discard followed by the
 * only permitted object deletion. The caller must remain in a retry
 * state if deletion fails; it must never silently forget this object. */
export async function discardUploadedProfileMark(
  supabase: SupabaseClient,
  reservation: ProfileMarkReservation
): Promise<void> {
  const { error: discardError } = await supabase.rpc('discard_profile_mark', {
    p_mark_id: reservation.markId,
  })
  if (discardError) {
    throw new ProfileMarkPersistenceError('This saved Mark could not be replaced. Please try again.', 'discard')
  }

  const { error: deleteError } = await supabase.storage
    .from(PROFILE_MARKS_BUCKET)
    .remove([reservation.objectName])
  if (deleteError) {
    throw new ProfileMarkPersistenceError(
      'The previous Mark still needs to be cleared. Keep this page open and try again.',
      'discard'
    )
  }
}
