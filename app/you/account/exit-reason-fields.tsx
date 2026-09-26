'use client'

import { helperTextClass } from '@/app/profile/ui'
import { EXIT_REASON_DETAIL_MAX, SOMETHING_ELSE, type ExitFeedback, type ExitReason } from '@/lib/account-lifecycle'

/** Optional "why?" — never required to continue. "Something else" reveals
 * an optional note. Values are stable reason codes, labels are copy. */
export default function ExitReasonFields({
  legend,
  reasons,
  value,
  onChange,
  disabled = false,
  name,
}: {
  legend: string
  reasons: ExitReason[]
  value: ExitFeedback
  onChange: (next: ExitFeedback) => void
  disabled?: boolean
  name: string
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className={helperTextClass}>
        {legend} <span className="text-muted">(optional)</span>
      </legend>
      <div className="space-y-1.5">
        {reasons.map((reason) => (
          <label key={reason.code} className="flex cursor-pointer items-start gap-2.5 text-[15px] text-foreground/85">
            <input
              type="radio"
              name={name}
              value={reason.code}
              checked={value.reasonCode === reason.code}
              onChange={() => onChange({ ...value, reasonCode: reason.code })}
              className="mt-1 accent-[var(--accent)]"
            />
            <span>{reason.label}</span>
          </label>
        ))}
      </div>
      {value.reasonCode === SOMETHING_ELSE && (
        <textarea
          aria-label="Tell us more (optional)"
          placeholder="Tell us more, if you’d like"
          value={value.reasonDetail}
          maxLength={EXIT_REASON_DETAIL_MAX}
          rows={3}
          onChange={(e) => onChange({ ...value, reasonDetail: e.target.value })}
          className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-[15px] text-foreground focus:border-foreground/35 focus:outline-none"
        />
      )}
    </fieldset>
  )
}
