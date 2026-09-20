import Mindform from '@/app/mindform'

const SIZE_CLASS = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-14 w-14',
  xl: 'h-32 w-32 sm:h-40 sm:w-40',
} as const

/**
 * The canonical member-identity artwork renderer. A saved Mark is shown in
 * its native composition with transparent/empty surroundings intact: never a
 * circular crop, cover fit, mask, or avatar treatment. Members who pre-date
 * Marks retain the established Mindform fallback.
 */
export default function ProfileIdentityMark({
  identifier,
  markUrl,
  label,
  size = 'md',
  className = '',
}: {
  identifier: string
  markUrl: string | null
  label?: string
  size?: keyof typeof SIZE_CLASS
  className?: string
}) {
  if (!markUrl) {
    return <Mindform identifier={identifier} size={size === 'xl' ? 'lg' : size} />
  }

  return (
    // Marks are immutable public Storage PNGs whose native transparent
    // composition must be preserved; the canonical renderer deliberately
    // avoids an image loader that could transform or crop that identity art.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={markUrl}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      className={`${SIZE_CLASS[size]} shrink-0 object-contain ${className}`.trim()}
    />
  )
}
