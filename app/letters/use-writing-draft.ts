'use client'

import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { createDraftSaveQueue } from '@/lib/draft-save-queue'

/** The same writer/key remains authoritative; only the timing changes. */
export function useWritingDraft(editor: Editor | null, save: (editor: Editor) => boolean, onFailure: () => void, scope: string) {
  const latest = useRef({ save, onFailure, scope })
  useEffect(() => { latest.current = { save, onFailure, scope } }, [save, onFailure, scope])
  const queueRef = useRef<ReturnType<typeof createDraftSaveQueue> | null>(null)
  useEffect(() => {
    if (!editor) return
    const initial = latest.current
    const queue = createDraftSaveQueue(() => !editor.isDestroyed && (latest.current.scope === scope ? latest.current.save : initial.save)(editor), () => (latest.current.scope === scope ? latest.current.onFailure : initial.onFailure)())
    queueRef.current = queue
    const changed = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) queue.schedule()
    }
    const flush = () => { queue.flush() }
    const visibility = () => { if (document.visibilityState === 'hidden') flush() }
    editor.on('update', changed)
    editor.on('blur', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      // Navigation/unmount must flush before the editor is destroyed.
      queue.flush()
      queue.cancel()
      queueRef.current = null
      editor.off('update', changed)
      editor.off('blur', flush)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [editor, scope])
  return {
    flush: () => queueRef.current?.flush() ?? true,
    // Cancel BEFORE clearing a successfully sent draft, so no delayed save
    // can resurrect it during navigation.
    cancel: () => queueRef.current?.cancel(),
    schedule: () => queueRef.current?.schedule(),
  }
}
