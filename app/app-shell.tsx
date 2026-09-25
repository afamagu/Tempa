import Link from 'next/link'
import TempaEmblem from '@/app/tempa-emblem'
import MemberIntroductions from '@/app/member-introductions'

type NavKey = 'home' | 'letters' | 'minds' | 'board' | 'you'

const NAV_ITEMS: { key: NavKey; href: string; label: string }[] = [
  { key: 'home', href: '/home', label: 'Home' },
  { key: 'letters', href: '/letters', label: 'Letters' },
  { key: 'minds', href: '/minds', label: 'People' },
  { key: 'board', href: '/board', label: 'Board' },
  { key: 'you', href: '/you', label: 'You' },
]

// Small, restrained line icons — no icon library, just enough shape to
// be recognizable alongside the text label (icons are never used alone).
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
    case 'minds':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4.5-4.5" />
        </svg>
      )
    case 'board':
      // A restrained notice board — a plain frame with a couple of
      // posted notes, never a grid/feed glyph. Distinct from Minds'
      // magnifying-glass (discovery) and Letters' envelope (private
      // correspondence) — Board is the third, separate activity.
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
 * Tempa's persistent primary navigation — a restrained left sidebar on
 * desktop, a compact bottom bar on mobile. Wraps the five primary
 * destinations (Home, Letters, Minds, Board, You); focused writing
 * screens (answering a Question, composing a first letter, writing a
 * Dispatch) and Minds'/Board's own contextual sub-views are
 * deliberately left outside primary nav so it stays a stable, small set
 * of destinations. Board is Minds' sibling, not a sub-view of it — one
 * is deliberate discovery through Question writing, the other is
 * ambient public writing (see the Build Guide's Dispatches section).
 * Purely presentational — callers fetch and pass waitingLetterCount
 * themselves, no data logic lives here.
 */
export default function AppShell({
  active,
  waitingLetterCount,
  children,
}: {
  active: NavKey
  waitingLetterCount: number
  children: React.ReactNode
}) {
  return (
    <div className="sm:flex sm:min-h-screen">
      <nav className="hidden sm:flex sm:w-56 sm:shrink-0 sm:flex-col sm:border-r sm:border-foreground/10 sm:px-4 sm:py-8">
        {/* Brand asset correction (2026-09-24) — compact emblem + the
            existing italic-serif "Tempa" wordmark, same understated
            treatment this sidebar already used, just with the approved
            emblem crop added beside it. No tagline, no full master
            lockup — restrained, aligned with the nav rows below it. */}
        <div className="flex items-center gap-2 px-2 pb-8">
          <TempaEmblem size={28} />
          <span className="font-serif text-lg italic text-foreground">Tempa</span>
        </div>
        <div className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === active
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
                <span>{item.label}</span>
                {item.key === 'letters' && <Badge count={waitingLetterCount} />}
              </Link>
            )
          })}
        </div>
      </nav>

      <div className="flex-1 pb-16 sm:pb-0">{children}</div>

      {/* "People to meet" — at most once per visit, loaded lazily after
          this page renders and failing open (see member-introductions). */}
      <MemberIntroductions />

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-foreground/10 bg-background sm:hidden">
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === active
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className="relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px]"
            >
              {/* Home Phase 1B — a soft rounded lozenge behind the
                  active icon, the TEMPA primary olive family (--accent),
                  never Worth Reading's verdigris (that stays reserved).
                  Shape AND color both carry the active state (never
                  color alone) — the lozenge background, the icon's own
                  stronger olive, and the label's modest weight/opacity
                  bump are three independent cues, so the active tab
                  reads clearly even for a viewer who can't distinguish
                  the two colors. Purely a background/color swap (150ms),
                  no bounce/pulse/scale — and sized to sit comfortably
                  inside the existing touch target, never crowding the
                  bar or growing it. */}
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
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
