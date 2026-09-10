'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { markReportReviewed } from '@/lib/admin'
import { secondaryButtonClass } from '@/app/profile/ui'

export default function MarkReviewedButton({ reportId, alreadyReviewed }: { reportId: string; alreadyReviewed: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (alreadyReviewed) return null

  async function handleClick() {
    if (busy) return
    setBusy(true)
    setError(null)
    const { error: markError } = await markReportReviewed(createClient(), reportId)
    setBusy(false)
    if (markError) {
      setError('Could not update this report. Please try again.')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-1">
      <button type="button" onClick={handleClick} disabled={busy} className={secondaryButtonClass}>
        {busy ? 'Marking reviewed…' : 'Mark reviewed'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
