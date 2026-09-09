import type { ReactNode } from 'react'

export type SystemMessageVariant = 'quiet' | 'notice' | 'warning'

/**
 * Tempa speaking to the member about product/system state — never
 * correspondence content, and never a substitute for a letter, a
 * Question, or a published answer (see app/profile/ui.ts's prose,
 * context, and closure style tokens for that "human voice"). Sans
 * throughout,
 * smaller and quieter than human writing, so a member can tell "this
 * is Tempa talking" at a glance rather than mistaking it for something
 * someone wrote.
 *
 * Three variants, quietest to most prominent:
 *   quiet   — a single inline line (icon + title, optional supporting
 *             text after a middot). No border/background. For a
 *             compact aside next to other content — "Mail on the way".
 *   notice  — a bordered/background card with a title, optional
 *             supporting text, and an optional action row (e.g. a CTA
 *             button plus a dismiss control). For a standalone
 *             callout — "A photo is waiting", a Question reminder, a
 *             privacy note.
 *   warning — same shape as notice, restrained accent emphasis for a
 *             safety/caution note (e.g. a future network/location
 *             mismatch signal). This is NOT the same thing as an
 *             error — genuine failures and destructive-action
 *             confirmations use destructiveButtonClass / red treatment
 *             elsewhere (see app/letters/remove-from-letterbox.tsx),
 *             never this component.
 *
 * Icon, color, and text change together across variants — meaning is
 * never carried by color alone.
 */
export default function SystemMessage({
  variant = 'notice',
  icon,
  title,
  children,
  action,
  className = '',
}: {
  variant?: SystemMessageVariant
  icon?: ReactNode
  title: string
  children?: ReactNode
  /** notice/warning only — a CTA/dismiss row beneath the supporting
   * text. Ignored for the quiet variant, which stays a single line. */
  action?: ReactNode
  className?: string
}) {
  if (variant === 'quiet') {
    return (
      <p className={`flex items-center gap-1.5 text-[13px] text-muted ${className}`}>
        {icon && (
          <span aria-hidden="true" className="flex shrink-0 items-center">
            {icon}
          </span>
        )}
        <span>{title}</span>
        {children && (
          <>
            <span aria-hidden="true" className="text-foreground/30">
              ·
            </span>
            <span>{children}</span>
          </>
        )}
      </p>
    )
  }

  const toneClass =
    variant === 'warning' ? 'border-accent/40 bg-accent/[.06]' : 'border-foreground/10 bg-foreground/[.03]'

  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 ${toneClass} ${className}`}>
      {icon && (
        <span aria-hidden="true" className="mt-0.5 flex shrink-0 items-center">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        {children && <p className="mt-0.5 text-[13px] text-muted">{children}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}
