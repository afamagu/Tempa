import Link from 'next/link'
import { useLocale } from 'next-intl'

type LetterboxTab = 'correspondence' | 'discover'

const TAB_COPY = {
  en: { correspondence: 'Correspondence', discover: 'Discover People' },
  fr: { correspondence: 'Correspondance', discover: 'Découvrir des personnes' },
  es: { correspondence: 'Correspondencia', discover: 'Descubrir personas' },
  pt: { correspondence: 'Correspondência', discover: 'Descobrir pessoas' },
} as const

function labelsFor(locale: string) {
  const language = locale.split('-')[0] as keyof typeof TAB_COPY
  return TAB_COPY[language] ?? TAB_COPY.en
}

export default function LettersTabs({ active }: { active: LetterboxTab }) {
  const labels = labelsFor(useLocale())
  return (
    <nav aria-label="Letterbox" className="mb-7 flex gap-6 border-b border-foreground/10">
      {(['correspondence', 'discover'] as const).map((key) => (
        <Link
          key={key}
          href={key === 'correspondence' ? '/letters' : '/letters/discover'}
          aria-current={active === key ? 'page' : undefined}
          className={`inline-flex items-center gap-2 border-b-2 py-3 text-sm ${
            active === key
              ? 'border-accent font-semibold text-foreground'
              : 'border-transparent text-foreground/60 hover:text-foreground'
          }`}
        >
          {key === 'discover' && (
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="10" cy="10" r="6" />
              <path d="m15 15 5 5" />
            </svg>
          )}
          {labels[key]}
        </Link>
      ))}
    </nav>
  )
}
