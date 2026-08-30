export const inputClass =
  'w-full rounded-md border border-black/10 dark:border-white/20 bg-transparent px-3 py-2.5 text-base outline-none focus:border-black/30 dark:focus:border-white/40 focus-visible:ring-2 focus-visible:ring-black/30 dark:focus-visible:ring-white/30'

export const sectionLabelClass =
  'text-xs font-medium uppercase tracking-wider text-black/40 dark:text-white/40'

export const helperTextClass = 'text-xs text-black/50 dark:text-white/50'

export const fieldLabelClass = 'block text-sm font-medium'

export const primaryButtonClass =
  'inline-flex items-center justify-center rounded-md bg-foreground text-background px-4 py-3 text-base font-medium disabled:opacity-50'

export const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-md border border-black/10 dark:border-white/20 px-4 py-2.5 text-sm font-medium hover:bg-black/[.04] dark:hover:bg-white/[.08]'

export function pillClass(selected: boolean) {
  return [
    'rounded-full border px-3.5 py-2 text-sm transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30 dark:focus-visible:ring-white/30',
    selected
      ? 'border-black dark:border-white bg-black/[.05] dark:bg-white/[.1] font-medium'
      : 'border-black/10 dark:border-white/20 hover:border-black/25 dark:hover:border-white/35',
  ].join(' ')
}

export function cardClass(selected: boolean) {
  return [
    'w-full text-left rounded-md border px-3.5 py-3 transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30 dark:focus-visible:ring-white/30',
    selected
      ? 'border-black dark:border-white bg-black/[.04] dark:bg-white/[.08]'
      : 'border-black/10 dark:border-white/20 hover:border-black/25 dark:hover:border-white/35',
  ].join(' ')
}
