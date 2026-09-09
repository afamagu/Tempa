import Tooltip from '@/app/profile/tooltip'

/**
 * Tempa's shared "what were they asked" control — a small, quiet icon
 * that reveals a Question's full prompt on activation (tap, click, or
 * keyboard focus, via Tooltip) rather than the prompt being printed
 * permanently above the person's writing. Dismisses again on a repeat
 * tap, an outside tap, or losing focus — the same Tooltip mechanism
 * already used for this exact purpose in Minds/Explore
 * (app/minds/discovery-results.tsx), reused here rather than a second,
 * unrelated reveal interaction (e.g. the public profile,
 * app/minds/[userId]/profile-answer.tsx).
 */
export default function QuestionInfoIcon({ prompt }: { prompt: string }) {
  return (
    <Tooltip label={prompt}>
      <span
        role="button"
        tabIndex={0}
        aria-label={`The Question: ${prompt}`}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-foreground/[.06] hover:text-foreground/80"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.35-1 .8-1 1.7" />
          <path d="M12 17h.01" />
        </svg>
      </span>
    </Tooltip>
  )
}
