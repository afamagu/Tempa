'use client'

import { useEffect } from 'react'
import { clearTempaLocalDrafts } from '@/lib/local-drafts'

/**
 * Pre-beta security F-15 — rendered only where a session has just ended
 * (after explicit sign-out, and on the account-deleted page). Removes the
 * member's private drafts from this browser. Renders nothing.
 */
export default function ClearLocalDrafts() {
  useEffect(() => {
    clearTempaLocalDrafts()
  }, [])
  return null
}
