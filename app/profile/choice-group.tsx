'use client'

import type { ChoiceOption } from './data'
import { pillClass, cardClass } from './ui'

export default function ChoiceGroup({
  options,
  selected,
  onToggle,
  layout = 'pill',
  ariaLabel,
}: {
  options: ChoiceOption[]
  selected: string[]
  onToggle: (value: string) => void
  layout?: 'pill' | 'card'
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={layout === 'pill' ? 'flex flex-wrap gap-2' : 'space-y-2'}
    >
      {options.map((option) => {
        const isSelected = selected.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(option.value)}
            className={layout === 'pill' ? pillClass(isSelected) : cardClass(isSelected)}
          >
            {layout === 'card' ? (
              <>
                <span className="block text-sm font-medium">{option.label}</span>
                {option.description && (
                  <span className="block text-xs mt-0.5 text-black/50 dark:text-white/50">
                    {option.description}
                  </span>
                )}
              </>
            ) : (
              option.label
            )}
          </button>
        )
      })}
    </div>
  )
}
