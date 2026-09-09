/**
 * Restrained topic display — plain text chips, never hashtags, never
 * clickable (no tag pages/tag following/trending topics exist — see
 * the Build Guide's Dispatches section). Purely presentational.
 */
export default function TopicChips({ topics }: { topics: string[] }) {
  if (topics.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {topics.map((topic) => (
        <span
          key={topic}
          className="rounded-full border border-foreground/10 px-2 py-0.5 text-[12px] text-foreground/60"
        >
          {topic}
        </span>
      ))}
    </div>
  )
}
