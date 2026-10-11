'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { recordDeviceLocationEvidence } from '@/lib/location-integrity'

/**
 * One-time post-signup location integrity capture. The RPC is idempotent:
 * once signup evidence exists, later AppShell mounts do not collect another
 * coordinate. No coordinates are retained in browser storage or UI state.
 */
export default function SignupLocationIntegrityCapture() {
  useEffect(() => {
    const supabase = createClient()
    recordDeviceLocationEvidence(supabase, 'signup').then((result) => {
      if (result.error) console.error('[location-integrity] signup evidence failed', result.error)
    })
  }, [])
  return null
}
