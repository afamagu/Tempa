'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { CorrespondenceLifecycle } from '@/lib/correspondence-lifecycle'
import {
  endCorrespondence,
  lifecycleActionErrorMessage,
  pauseCorrespondence,
  requestResumeCorrespondence,
  respondResumeCorrespondence,
} from '@/lib/correspondence-lifecycle'
import { helperTextClass, secondaryButtonClass } from '@/app/profile/ui'

type Action = 'pause' | 'request' | 'resume' | 'decline' | 'end'

export default function CorrespondenceLifecycleControl({
  lifecycle,
  viewerId,
  counterpartPseudonym,
}: {
  lifecycle: CorrespondenceLifecycle
  viewerId: string
  counterpartPseudonym: string
}) {
  const router = useRouter()
  const [working, setWorking] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!lifecycle.establishedAt) return null

  async function run(action: Action) {
    if (working) return

    if (action === 'pause') {
      const ok = window.confirm(
        `Pause this correspondence with ${counterpartPseudonym}? You will both keep the letters, but neither of you will be able to write here until you both resume it.`
      )
      if (!ok) return
    }

    if (action === 'end') {
      const ok = window.confirm(
        `End this correspondence with ${counterpartPseudonym}? Your letters will stay in both Letterboxes, but this correspondence cannot be resumed.`
      )
      if (!ok) return
    }

    setWorking(action)
    setError(null)
    const supabase = createClient()

    const result =
      action === 'pause'
        ? await pauseCorrespondence(supabase, lifecycle.correspondenceId)
        : action === 'request'
          ? await requestResumeCorrespondence(supabase, lifecycle.correspondenceId)
          : action === 'resume'
            ? await respondResumeCorrespondence(supabase, lifecycle.correspondenceId, true)
            : action === 'decline'
              ? await respondResumeCorrespondence(supabase, lifecycle.correspondenceId, false)
              : await endCorrespondence(supabase, lifecycle.correspondenceId)

    setWorking(null)

    if (result.error) {
      setError(lifecycleActionErrorMessage(result.error))
      return
    }

    router.refresh()
  }

  if (lifecycle.status === 'closed') {
    if (!lifecycle.endedBy) return null
    return (
      <section className="rounded-md border border-foreground/10 px-4 py-3">
        <p className="text-[15px] text-foreground">This correspondence has ended.</p>
        <p className={helperTextClass}>Your letters remain here as part of your history together.</p>
      </section>
    )
  }

  if (lifecycle.status === 'active') {
    return (
      <section className="space-y-3 rounded-md border border-foreground/10 px-4 py-3">
        <div>
          <p className="text-[15px] text-foreground">This correspondence is active.</p>
          <p className={helperTextClass}>
            If you need space, you can pause it without losing the letters you have already exchanged.
          </p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={working !== null}
            onClick={() => run('pause')}
          >
            {working === 'pause' ? 'Pausing…' : 'Pause this correspondence'}
          </button>
          <button
            type="button"
            className="text-[13px] text-muted underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
            disabled={working !== null}
            onClick={() => run('end')}
          >
            {working === 'end' ? 'Ending…' : 'End correspondence'}
          </button>
        </div>
      </section>
    )
  }

  if (lifecycle.status !== 'paused') return null

  const pausedByMe = lifecycle.pausedBy === viewerId
  const requestedByMe = lifecycle.resumeRequestedBy === viewerId
  const requestedByOther =
    lifecycle.resumeRequestedBy !== null && lifecycle.resumeRequestedBy !== viewerId

  return (
    <section className="space-y-3 rounded-md border border-foreground/10 px-4 py-3">
      <div>
        <p className="text-[15px] text-foreground">
          {pausedByMe
            ? 'You paused this correspondence for now.'
            : `${counterpartPseudonym} has paused this correspondence for now.`}
        </p>
        <p className={helperTextClass}>
          Your letters are still here. Writing and reminders stay quiet while the correspondence is paused.
        </p>
      </div>

      {requestedByMe && (
        <p className={helperTextClass}>
          You asked to resume. {counterpartPseudonym} can resume it when they are ready and you both have room.
        </p>
      )}

      {requestedByOther && (
        <p className="text-[14px] text-foreground">
          {counterpartPseudonym} would like to resume this correspondence.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {!lifecycle.resumeRequestedBy && (
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={working !== null}
            onClick={() => run('request')}
          >
            {working === 'request' ? 'Asking…' : 'Ask to resume'}
          </button>
        )}

        {requestedByOther && (
          <>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={working !== null}
              onClick={() => run('resume')}
            >
              {working === 'resume' ? 'Resuming…' : 'Resume'}
            </button>
            <button
              type="button"
              className="text-[13px] text-muted underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
              disabled={working !== null}
              onClick={() => run('decline')}
            >
              {working === 'decline' ? 'Saving…' : 'Not right now'}
            </button>
          </>
        )}

        <button
          type="button"
          className="text-[13px] text-muted underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
          disabled={working !== null}
          onClick={() => run('end')}
        >
          {working === 'end' ? 'Ending…' : 'End correspondence'}
        </button>
      </div>
    </section>
  )
}
