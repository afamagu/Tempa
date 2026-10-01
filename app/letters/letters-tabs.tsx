import Link from 'next/link'
import { useTranslations } from 'next-intl'

export default function LettersTabs({ active }: { active: 'penPals' | 'discover' }) {
  const t = useTranslations('Letters')
  return (
    <nav aria-label={t('heading')} className="mb-7 flex gap-6 border-b border-foreground/10">
      {(['penPals', 'discover'] as const).map((key) => (
        <Link key={key} href={key === 'penPals' ? '/letters' : '/letters/discover'} aria-current={active === key ? 'page' : undefined}
          className={`inline-flex items-center gap-2 border-b-2 py-3 text-sm ${active === key ? 'border-accent font-semibold text-foreground' : 'border-transparent text-foreground/60 hover:text-foreground'}`}>
          {key === 'discover' && <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg>}
          {t(key)}
        </Link>
      ))}
    </nav>
  )
}
