/**
 * Privacy-by-default policy for future optional tracking integrations.
 * This module deliberately does not load scripts, store identifiers, or
 * infer consent from silence. Callers must check the gate BEFORE making
 * any network request, creating a script, or writing an identifier.
 *
 * Essential authentication, security and payment flows are outside this
 * optional-tracking gate and must not be blocked by it.
 */
export type OptionalTrackingConsent = 'granted' | 'denied' | 'unknown'

export function mayStartOptionalTracking(consent: OptionalTrackingConsent): boolean {
  return consent === 'granted'
}

export function runOptionalTracking(
  consent: OptionalTrackingConsent,
  start: () => void,
): boolean {
  if (!mayStartOptionalTracking(consent)) return false
  start()
  return true
}
