'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { secondaryButtonClass, systemBodyClass } from '@/app/profile/ui'

export type FromTempaNoticeData = {
  id: string
  title: string
  body: string
  /** A notice that must stay visible for as long as its state lasts (an
   * active restriction) has no dismiss control. */
  persistent: boolean
}

/**
 * Official, one-way correspondence FROM Tempa — restriction applied,
 * restriction lifted, a permanent decision. Not a letter and not a
 * member: there is no reply box, no "write back", and nothing here can
 * be answered — the card only informs (and, for non-persistent notices,
 * lets the member dismiss it). The label says "From Tempa" so it can
 * never be mistaken for something a member wrote; the wording is stored
 * server-side in public.member_notices at the moment the decision was
 * made, never composed by a reviewer.
 */
export default function FromTempaNotice({ notice }: { notice: FromTempaNoticeData }) {
  const router = useRouter()
  const [dismissing, setDismissing] = useState(false)

  async function handleDismiss() {
    setDismissing(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('mark_member_notice_read', { p_notice_id: notice.id })
    if (error) {
      console.error('[notices] mark read failed', { message: error.message, code: error.code })
      setDismissing(false)
      return
    }
    router.refresh()
  }

  return (
    <section
      aria-label="A note from Tempa"
      className="space-y-2 rounded-md border border-foreground/10 border-l-2 border-l-clay/60 bg-foreground/[.03] px-4 py-3"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-clay">From Tempa</p>
      <h2 className="text-[15px] font-medium text-foreground">{notice.title}</h2>
      {notice.body.split('\n\n').map((paragraph) => (
        <p key={paragraph} className={systemBodyClass}>
          {paragraph}
        </p>
      ))}
      {!notice.persistent && (
        <div className="pt-1">
          <button type="button" onClick={handleDismiss} disabled={dismissing} className={secondaryButtonClass}>
            {dismissing ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      )}
    </section>
  )
}
