'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Fires once when this page actually mounts in a browser — not during
 * Next.js Link prefetching, which never runs client-side effects. That's
 * what keeps this from registering a false "opened" the moment a member
 * merely hovers a link on the Letters hub.
 *
 * router.refresh() after a successful write invalidates the Next.js
 * router cache so navigating back to /letters (or anywhere else showing
 * the nav badge) re-fetches getWaitingLetterCount/getLetterboxPeople
 * fresh rather than serving a cached page from before this letter was
 * marked read — without it, the person-level and global unread counts
 * could stay stale until an unrelated hard navigation.
 */
export default function MarkLetterOpened({ letterId }: { letterId: string }) {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    async function markOpened() {
      const supabase = createClient()
      const { error } = await supabase.rpc('mark_letter_opened', { p_letter_id: letterId })
      if (error) {
        // Diagnostic only — read tracking must never surface an
        // intrusive error to the member, but a real RPC failure here
        // (as opposed to the read being correctly skipped for some
        // other reason) should be visible in development rather than
        // silently doing nothing.
        console.error('[letters] mark_letter_opened failed', {
          letterId,
          message: error.message,
          code: error.code,
        })
        return
      }
      if (!cancelled) router.refresh()
    }
    markOpened()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letterId])

  return null
}
