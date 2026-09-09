// A pure, deterministic hash — not Math.random(), so a given person's
// tint is stable across renders/requests without needing to store it.
// Matches the same technique already used for Explore's viewer-specific
// ordering.
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// A small, restrained set of muted warm/cool neutrals — deliberately
// never bright or saturated, so every placeholder still reads as
// "quietly Tempa" regardless of which variant a given person lands on.
const TINTS = ['#c9c2b3', '#b9c2b8', '#c7bcb0', '#b6bdc4', '#c4bdb5', '#bcc2b3']

const SIZES = { sm: 28, md: 36, lg: 56 } as const

/**
 * Tempa's identity primitive. Every avatar/profile slot in the app
 * renders through this component so the eventual customizable Mindform
 * system can replace what's drawn here without touching any calling
 * page — today that's a restrained abstract humanoid silhouette,
 * deterministically tinted per person, never a photograph, a cartoon
 * face, initials-as-the-primary-identity, or a stock avatar. Purely
 * decorative (aria-hidden) — the name is always rendered as real text
 * wherever this appears, which is what carries the identity for
 * assistive technology.
 */
export default function Mindform({
  identifier,
  size = 'md',
}: {
  /** A stable id (user id) driving deterministic variation. */
  identifier: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const tint = TINTS[hashString(identifier) % TINTS.length]
  const dimension = SIZES[size]

  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{ width: dimension, height: dimension, backgroundColor: tint }}
    >
      {/* An abstracted head-and-shoulders presence — a person whose
          physical identity hasn't fully resolved, not a face. */}
      <svg viewBox="0 0 36 36" width="70%" height="70%" fill="none">
        <circle cx="18" cy="13.5" r="6.5" fill="var(--background)" fillOpacity="0.88" />
        <path
          d="M5.5 33c1.6-8.4 6.3-13 12.5-13s10.9 4.6 12.5 13"
          fill="var(--background)"
          fillOpacity="0.88"
        />
      </svg>
    </span>
  )
}
