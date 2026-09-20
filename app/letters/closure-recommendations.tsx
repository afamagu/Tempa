import { createClient } from '@/lib/supabase/server'
import { sectionTitleClass, sectionLabelClass, helperTextClass } from '@/app/profile/ui'
import DiscoveryResults, { type DiscoveryEntry } from '@/app/minds/discovery-results'
import { publicProfileMarkUrl } from '@/lib/profile-marks'

// No client-side count parameter — the database function fixes this at
// 3 internally (a product ceiling, not a UI preference) and can't be
// asked for more.
type RecommendationRow = {
  answer_id: string
  user_id: string
  question_id: string
  body: string
  pseudonym: string
  country: string
  gender: string | null
  gender_custom: string | null
  age_range: string
  prompt: string
}

function genderDisplay(gender: string | null, genderCustom: string | null) {
  if (!gender || gender === 'Prefer not to say') return null
  if (gender === 'Self-describe') return genderCustom || null
  return gender
}

// The same icon used for the Minds destination in primary navigation —
// one consistent mark for "this is the Minds/discovery concept,"
// wherever it shows up.
function MindsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4.5-4.5" />
    </svg>
  )
}

/**
 * Shown after a sender sees a first-contact letter's closure (recipient
 * or system) — a small, finite nudge back to Minds rather than a dead
 * end. Reuses the exact answer-card component Minds/Explore uses; this
 * is not a second recommendation UI. The candidate query lives in
 * get_post_closure_recommendations (docs/sql/2026-08-30-letters.sql),
 * not here, since it needs account age (for a modest newer-member
 * weighting) which isn't safely readable cross-user outside a
 * SECURITY DEFINER function — see the build guide for why that couldn't
 * just reuse Minds' own TypeScript query path.
 *
 * Deliberately wrapped in its own tonal surface, well separated from
 * whatever letter sits above it — this is Tempa recommending something,
 * not a continuation of the correspondence the member was just reading.
 *
 * Takes the letter's own id, not a recipient id to exclude — the browser
 * never gets to assert who the "just closed" recipient is. The function
 * derives that from the letter itself after verifying the caller is
 * really its sender and that it's really closed.
 */
export default async function ClosureRecommendations({
  letterId,
}: {
  letterId: string
}) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('get_post_closure_recommendations', {
    p_letter_id: letterId,
  })

  if (error || !data || data.length === 0) {
    return null
  }

  const rows = data as RecommendationRow[]
  const { data: profiles } = await supabase
    .from('public_profiles')
    .select('id, mark_id')
    .in('id', [...new Set(rows.map((row) => row.user_id))])
  const markIdByUserId = new Map((profiles ?? []).map((profile) => [profile.id, profile.mark_id]))

  // The recommendation RPC remains response-first and unchanged. Resolve only
  // its already-authorized candidates' public mark_id values in one batched,
  // block-aware public_profiles lookup.
  const entries: DiscoveryEntry[] = rows.map((row) => ({
    userId: row.user_id,
    pseudonym: row.pseudonym,
    country: row.country,
    genderDisplay: genderDisplay(row.gender, row.gender_custom),
    ageRange: row.age_range,
    markUrl: markIdByUserId.get(row.user_id)
      ? publicProfileMarkUrl(supabase, `${markIdByUserId.get(row.user_id)}.png`)
      : null,
    response: { id: row.answer_id, body: row.body, prompt: row.prompt },
  }))

  return (
    // Release Polish Pass — a small uppercase "Discover" eyebrow now
    // opens this section, the same restrained kicker token every other
    // distinct section on this page family uses — an unmistakable
    // signal that a new editorial section has begun, not a continuation
    // of the letter above it.
    <div className="mt-10 rounded-md border-t-2 border-foreground/15 bg-background p-5 sm:p-6">
      <p className={sectionLabelClass}>Discover</p>
      <div className="mt-1.5 flex items-center gap-2">
        <MindsIcon />
        <p className={sectionTitleClass}>Other minds you might like to meet</p>
      </div>
      <p className={`mt-1 ${helperTextClass}`}>A few answers you may want to read next.</p>
      <div className="mt-5">
        <DiscoveryResults entries={entries} />
      </div>
    </div>
  )
}
