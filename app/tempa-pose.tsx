export type TempaPoseName =
  | 'neutral'
  | 'thinking'
  | 'welcome'
  | 'one-moment'
  | 'presenting'
  | 'ready'

// Where each pose's approved, transparent-background art will live once
// it's manually added — nothing reads these paths yet (no <img> points
// at them below), they only document the swap target so adding real art
// later is a drop-in file replacement, not a rewrite of every tutorial
// that references a pose.
const POSE_ASSET_PATHS: Record<TempaPoseName, string> = {
  neutral: '/tempa/neutral.png',
  thinking: '/tempa/thinking.png',
  welcome: '/tempa/welcome.png',
  'one-moment': '/tempa/one-moment.png',
  presenting: '/tempa/presenting.png',
  ready: '/tempa/ready.png',
}

/**
 * Tempa's canonical pose slot — the platform guide character, appearing
 * directly on guide/tutorial pages rather than inside a separate
 * illustrated card. This renders a restrained placeholder mark today
 * (no AI-generated imagery, per product direction) so tutorials can
 * already be laid out around Tempa's presence; swapping in the real
 * approved pose art later means replacing the file at
 * POSE_ASSET_PATHS[pose] and rendering it here, with no change required
 * at any call site.
 */
export default function TempaPose({ pose, size = 96 }: { pose: TempaPoseName; size?: number }) {
  return (
    <span
      role="img"
      aria-label={`Tempa — ${pose.replace('-', ' ')}`}
      data-tempa-pose={pose}
      data-tempa-asset={POSE_ASSET_PATHS[pose]}
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: 'color-mix(in srgb, var(--accent) 16%, transparent)' }}
    >
      <svg viewBox="0 0 48 48" width="64%" height="64%" fill="none" aria-hidden="true">
        <path
          d="M14 30c-2 5-2 9 2 12M34 30c2 5 2 9-2 12M20 33c-1 5 0 9 1 11M28 33c1 5 0 9-1 11M24 34c0 5 0 9 0 11"
          stroke="var(--accent)"
          strokeOpacity="0.75"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="24" cy="19" r="14" fill="var(--accent)" fillOpacity="0.85" />
        <circle cx="18.5" cy="18" r="2.4" fill="var(--background)" />
        <circle cx="29.5" cy="18" r="2.4" fill="var(--background)" />
        <path
          d="M19 25c2 2.2 8 2.2 10 0"
          stroke="var(--background)"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </span>
  )
}
