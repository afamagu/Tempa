import type { SupabaseClient } from '@supabase/supabase-js'

export type LocationEvidencePurpose = 'signup' | 'writing_trust_review'
export type LocationEvidenceSource = 'device_gps' | 'device_network' | 'permission_denied' | 'unavailable'

export type LocationEvidenceResult = { recorded: boolean; source: LocationEvidenceSource; error?: string }

/**
 * Requests a fresh browser geolocation measurement and submits it directly
 * to the locked backend evidence RPC. Coordinates are never persisted in
 * localStorage, profile state, analytics, or returned to the member UI.
 * Refusal is evidence of "unverified", never evidence of deception.
 */
export async function recordDeviceLocationEvidence(
  supabase: SupabaseClient,
  purpose: LocationEvidencePurpose,
  options: PositionOptions = { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
): Promise<LocationEvidenceResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    const { error } = await supabase.rpc('record_my_location_evidence', {
      p_purpose: purpose, p_source: 'unavailable', p_latitude: null, p_longitude: null, p_accuracy_m: null,
    })
    return { recorded: !error, source: 'unavailable', error: error?.message }
  }

  const position = await new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), options)
  })

  if (!position) {
    const { error } = await supabase.rpc('record_my_location_evidence', {
      p_purpose: purpose, p_source: 'permission_denied', p_latitude: null, p_longitude: null, p_accuracy_m: null,
    })
    return { recorded: !error, source: 'permission_denied', error: error?.message }
  }

  const { latitude, longitude, accuracy } = position.coords
  const source: LocationEvidenceSource = accuracy <= 100 ? 'device_gps' : 'device_network'
  const { error } = await supabase.rpc('record_my_location_evidence', {
    p_purpose: purpose, p_source: source, p_latitude: latitude, p_longitude: longitude, p_accuracy_m: accuracy,
  })
  return { recorded: !error, source, error: error?.message }
}
