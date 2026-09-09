import type { SupabaseClient } from '@supabase/supabase-js'

// Free-text key rather than an enum — matches GuideKey's reasoning — so
// a future per-correspondence feature notice doesn't need a migration
// to add. Only 'moments_available' exists today.
export type CorrespondenceFeatureKey = 'moments_available'

/** Tracked per (user, correspondence EPISODE, feature) — deliberately
 * NOT the same table as guide_completions. A closed episode and any
 * later new episode between the same two people get independent rows,
 * and each participant's acknowledgement is independent of the
 * other's. */
export async function hasAcknowledgedCorrespondenceFeature(
  supabase: SupabaseClient,
  userId: string,
  correspondenceId: string,
  featureKey: CorrespondenceFeatureKey
): Promise<boolean> {
  const { data } = await supabase
    .from('correspondence_feature_acknowledgements')
    .select('user_id')
    .eq('user_id', userId)
    .eq('correspondence_id', correspondenceId)
    .eq('feature_key', featureKey)
    .maybeSingle()

  return data !== null
}

export type AcknowledgementWriteError = { message: string; code?: string } | null

/** Postgres's unique_violation SQLSTATE — raised on a duplicate
 * (user_id, correspondence_id, feature_key) primary key. */
const UNIQUE_VIOLATION = '23505'

/** Idempotent — safe to call even if already acknowledged. Always
 * writes under the caller's own auth.uid(); there is no parameter that
 * could target another user's row.
 *
 * Plain INSERT, not upsert, for the same reason as markGuideCompleted
 * (lib/guide.ts): an acknowledgement is write-once-per-(user,
 * correspondence, feature) and never mutated after the fact —
 * acknowledged_at is deliberately not re-sent, so a conflict-path
 * UPDATE would have nothing to actually change. A duplicate call hits
 * the primary key and raises 23505 (unique_violation), treated as
 * success. This table's RLS (see
 * 2026-09-01-correspondence-feature-acknowledgements.sql) only ever
 * defined SELECT and INSERT policies "so both remain fully denied under
 * RLS regardless of any future grant" — deliberately, per that file's
 * own comment — so plain INSERT is not just simpler than upsert here,
 * it's the only shape that matches the access this table actually
 * grants; upsert's ON CONFLICT DO UPDATE path would additionally need a
 * new UPDATE RLS policy (auth.uid() = user_id AND
 * is_correspondence_participant(correspondence_id)) that does not
 * currently exist.
 *
 * Returns the write's error (if any) rather than swallowing it, so a
 * caller can log a failure here distinctly from a guide_completions
 * failure. A caller must never let this failing block navigation — see
 * MomentsWalkthroughGate. */
export async function acknowledgeCorrespondenceFeature(
  supabase: SupabaseClient,
  correspondenceId: string,
  featureKey: CorrespondenceFeatureKey
): Promise<{ error: AcknowledgementWriteError }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: { message: 'acknowledgeCorrespondenceFeature called with no authenticated user.' } }
  }

  const { error } = await supabase.from('correspondence_feature_acknowledgements').insert({
    user_id: user.id,
    correspondence_id: correspondenceId,
    feature_key: featureKey,
  })

  if (error && error.code !== UNIQUE_VIOLATION) {
    return { error: { message: error.message, code: error.code } }
  }

  return { error: null }
}
