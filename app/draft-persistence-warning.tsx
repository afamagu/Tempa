import { helperTextClass } from '@/app/profile/ui'

export const DRAFT_PERSISTENCE_WARNING =
  'This browser can’t save this draft right now. Keep this page open until you finish.'

export default function DraftPersistenceWarning() {
  return (
    <p
      role="status"
      className={`rounded-md border border-foreground/10 bg-surface-shell px-3 py-2 ${helperTextClass}`}
    >
      {DRAFT_PERSISTENCE_WARNING}
    </p>
  )
}
