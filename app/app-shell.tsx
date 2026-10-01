import Link from 'next/link'
import { useTranslations } from 'next-intl'
import TempaEmblem from '@/app/tempa-emblem'

type NavKey = 'home' | 'letters' | 'room' | 'board' | 'you'
type ShellActiveKey = NavKey | 'minds'

// Labels are interface-dictionary keys (messages/*.json → Nav), shared by
// the desktop sidebar and mobile bar so the two can never disagree.
const NAV_ITEMS: { key: NavKey; href: string; label: 'home' | 'letters' | 'room' | 'board' | 'you' }[] = [
  { key: 'home', href: '/home', label: 'home' },
  { key: 'letters', href: '/letters', label: 'letters' },
  { key: 'room', href: '/room', label: 'room' },
  { key: 'board', href: '/board', label: 'board' },
  { key: 'you', href: '/you', label: 'you' },
]

function NavIcon({ item, className }: { item: NavKey; className?: string }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  switch (item) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M4 11.5 12 4l8 7.5" />
          <path d="M6 10v9h12v-9" />
        </svg>
      )
    case 'letters':
      return (
        <svg {...common}>
          <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
          <path d="m4 6.5 8 6.5 8-6.5" />
        </svg>
      )
    case 'room':
      return (
        <svg {...common}>
          <path d="M7 20V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V20" />
          <path d="M4.5 20h15" />
          <circle cx="14" cy="12" r=".75" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'board':
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
          <path d="M7 9h4" />
          <path d="M7 13h7" />
          <path d="M7 16.5h5" />
        </svg>
      )
    case 'you':
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 20c1.2-4 4-5.5 7-5.5s5.8 1.5 7 5.5" />
        </svg>
      )
  }
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-medium text-accent-foreground">
      {count > 99 ? '99+' : count}
    </span>
  )
}

/**
 * Tempa's persistent primary navigation. The member-facing destinations are
 * Home, Letters, The Room, The Board and You. `minds` remains an accepted
 * active value temporarily so older, non-canonical call sites cannot break a
 * production build while their URLs are redirected to The Room.
 */
export default function AppShell({
  active,
  waitingLetterCount,
  children,
}: {
  active: ShellActiveKey
  waitingLetterCount: number
  children: React.ReactNode
}) {
  const t = useTranslations('Nav')
  const activeNav: NavKey = active === 'minds' ? 'room' : active

  return (
    <div className="sm:flex sm:min-h-screen">
      <nav className="hidden sm:flex sm:w-56 sm:shrink-0 sm:flex-col sm:border-r sm:border-foreground/10 sm:px-4 sm:py-8">
        <div className="flex items-center gap-2 px-2 pb-8">
          <TempaEmblem size={28} />
          <span className="font-serif text-lg italic text-foreground">Tempa</span>
        </div>
        <div className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === activeNav
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-[15px] transition-colors ${
                  isActive
                    ? 'bg-accent/10 font-medium text-foreground'
                    : 'text-foreground/70 hover:bg-foreground/[.04] hover:text-foreground'
                }`}
              >
                <NavIcon item={item.key} className="h-5 w-5 shrink-0" />
                <span>{t(item.label)}</span>
                {item.key === 'letters' && <Badge count={waitingLetterCount} />}
              </Link>
            )
          })}
        </div>
      </nav>

      <div className="flex-1 pb-16 sm:pb-0">{children}</div>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-foreground/10 bg-background sm:hidden">
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === activeNav
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className="relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px]"
            >
              <span
                className={`flex h-8 w-12 items-center justify-center rounded-full transition-colors duration-150 ${
                  isActive ? 'bg-accent/10' : ''
                }`}
              >
                <span className="relative">
                  <NavIcon
                    item={item.key}
                    className={`h-5 w-5 transition-colors duration-150 ${
                      isActive ? 'text-accent' : 'text-foreground/50'
                    }`}
                  />
                  {item.key === 'letters' && waitingLetterCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent"
                    />
                  )}
                </span>
              </span>
              <span
                className={`transition-colors duration-150 ${
                  isActive ? 'font-medium text-foreground' : 'text-foreground/50'
                }`}
              >
                {t(item.label)}
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
