import type { SupabaseClient } from '@supabase/supabase-js'

// Free-text key rather than an enum — future guides (First letters,
// Photos & trust, Postcards, Closing a correspondence, Safety) don't
// need a migration to add. 'moments' and 'minds' exist today, tracked
// as fully independent completions — finishing one never marks the
// other, and neither is ever recurring once completed.
//
// Onboarding & First-Use checkpoint — 'people'/'board'/'dispatch_
// composer'/'postcard' added for the new lightweight FeatureIntroduction
// system (app/feature-introduction.tsx). Same guide_completions table,
// same free-text column, zero SQL — this is exactly the extensibility
// this type's own original comment anticipated. Each is a small, quiet,
// point-of-first-encounter introduction, never the full walkthrough
// treatment 'moments'/'minds' get.
//
// Post-onboarding corrections checkpoint (Q2) — 'dispatch_reading' added
// for the first-authenticated-read Dispatch introduction
// (app/board/[dispatchId]/page.tsx), same lightweight pattern. Deliberately
// its own key, never reused from 'dispatch_composer' (writing a Dispatch)
// or 'board' (browsing the Board) — completing either of those must never
// silently mark the reading introduction complete, since they teach
// different moments a member encounters at different times.
export type GuideKey =
  | 'moments'
  | 'minds'
  | 'people'
  | 'board'
  | 'dispatch_composer'
  | 'postcard'
  | 'dispatch_reading'

export type GuideWriteError = { message: string; code?: string } | null

/** Tracked per USER, not per correspondence — completing the Moments
 * walkthrough once means it never auto-shows again anywhere. */
export async function hasCompletedGuide(
  supabase: SupabaseClient,
  userId: string,
  guideKey: GuideKey
): Promise<boolean> {
  const { data, error } = await supabase
    .from('guide_completions')
    .select('user_id')
    .eq('user_id', userId)
    .eq('guide_key', guideKey)
    .maybeSingle()

  // Logged, not thrown: the safe default when the read itself fails is
  // to treat the guide as not-yet-completed (the tutorial can show
  // again), never the reverse — silently treating a read failure as
  // "completed" would permanently hide a mandatory tutorial nobody ever
  // actually finished. But a failure here should be visible, not
  // indistinguishable from a genuine "never completed" row.
  if (error) {
    console.error('[guide] completion read failed', {
      guideKey,
      message: error.message,
      code: error.code,
    })
  }

  return data !== null
}

/** Postgres's unique_violation SQLSTATE — raised on a duplicate
 * (user_id, guide_key) primary key. */
const UNIQUE_VIOLATION = '23505'

/**
 * Idempotent — replaying a guide from Tempa Guide calls this again
 * harmlessly rather than needing to check completion state first.
 *
 * Plain INSERT, not upsert: a completion is write-once-per-(user,
 * guide) and never mutated after the fact (there is no field on this
 * row a repeat call would ever need to change — completed_at is
 * deliberately not re-sent), so there is nothing for an UPDATE to do.
 * A duplicate call hits the primary key and raises 23505
 * (unique_violation), which is treated as success — the guide IS
 * completed, exactly as if this call had done it. This also means the
 * table only ever needs INSERT privilege, never UPDATE: no UPDATE grant
 * and no UPDATE RLS policy have to exist for this to work, which is
 * both simpler and a smaller permission surface than upsert +
 * grant-update + a policy restricting it to `auth.uid() = user_id`
 * (see docs/sql/2026-09-01-guide-completions-update-grant.sql's
 * comparison of the two designs).
 *
 * Returns the write's error (if any) instead of swallowing it — a
 * caller must check this and log failures; none may assume the write
 * succeeded just because this resolved without throwing (a normal
 * Supabase query error never throws — it resolves to `{ error }`).
 */
export async function markGuideCompleted(
  supabase: SupabaseClient,
  guideKey: GuideKey
): Promise<{ error: GuideWriteError }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: { message: 'markGuideCompleted called with no authenticated user.' } }
  }

  const { error } = await supabase
    .from('guide_completions')
    .insert({ user_id: user.id, guide_key: guideKey })

  if (error && error.code !== UNIQUE_VIOLATION) {
    return { error: { message: error.message, code: error.code } }
  }

  return { error: null }
}
