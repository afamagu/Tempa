import Link from 'next/link'
import { useTranslations } from 'next-intl'

export type BoardTab = 'letters' | 'people'

const TABS = [
  { key: 'letters', href: '/board', label: 'open' },
  { key: 'people', href: '/board/people', label: 'people' },
] as const

/** One navigation for reading people through their letters or deliberately finding them. */
export default function BoardTabs({ active }: { active: BoardTab }) {
  const t=useTranslations('Board')
  return (
    <nav aria-label="The Board" className="mt-6 flex gap-8 border-b border-foreground/15">
      {TABS.map(tab => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? 'page' : undefined}
          className={`inline-flex min-h-12 items-center border-b-[3px] px-1 text-[15px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            active === tab.key
              ? 'border-accent font-semibold text-foreground'
              : 'border-transparent text-foreground/65 hover:text-foreground'
          }`}
        >
          {t(tab.label)}
        </Link>
      ))}
    </nav>
  )
}
