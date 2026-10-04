import type { SupabaseClient } from '@supabase/supabase-js'

export const WRITING_RHYTHMS = {
  few_days: {
    label: 'Within a few days',
    description: 'A short pause is normal. Tempa treats about four days as your usual horizon.',
    approximateDays: 4,
  },
  one_week: {
    label: 'About a week',
    description: 'You usually like to answer within roughly a week.',
    approximateDays: 7,
  },
  two_weeks: {
    label: 'Within two weeks',
    description: 'You prefer a slower correspondence and may take up to two weeks.',
    approximateDays: 14,
  },
  one_month: {
    label: 'I write slowly — up to a month',
    description: 'Long gaps are normal for you, but the other person still has a rough horizon.',
    approximateDays: 30,
  },
} as const

export type WritingRhythm = keyof typeof WRITING_RHYTHMS

export type MyWritingRhythm = {
  rhythm: WritingRhythm | null
  approximateDays: number | null
}

export type CorrespondenceRhythmState = {
  viewerId: string
  counterpartId: string
  viewerRhythm: WritingRhythm | null
  viewerApproximateDays: number | null
  viewerUsesOverride: boolean
  counterpartRhythm: WritingRhythm | null
  counterpartApproximateDays: number | null
}

type MyWritingRhythmRow = {
  rhythm: string | null
  approximate_days: number | null
}

type CorrespondenceRhythmRow = {
  viewer_id: string
  counterpart_id: string
  viewer_rhythm: string | null
  viewer_approximate_days: number | null
  viewer_uses_override: boolean
  counterpart_rhythm: string | null
  counterpart_approximate_days: number | null
}

export function isWritingRhythm(value: unknown): value is WritingRhythm {
  return typeof value === 'string' && value in WRITING_RHYTHMS
}

export function writingRhythmLabel(rhythm: WritingRhythm | null | undefined): string | null {
  return rhythm ? WRITING_RHYTHMS[rhythm].label : null
}

export function writingRhythmApproximateDays(rhythm: WritingRhythm | null | undefined): number | null {
  return rhythm ? WRITING_RHYTHMS[rhythm].approximateDays : null
}

export type RhythmTimingState = 'unset' | 'within' | 'beyond'

/**
 * Pure status resolver. Rhythm is an expectation, not a deadline: callers use
 * the result for calm wording only. A missing rhythm is always `unset`, never
 * overdue. The DB owns the same horizons via tempa_private.writing_rhythm_days.
 */
export function rhythmTimingState({
  waitingSince,
  rhythm,
  now = new Date(),
}: {
  waitingSince: string | Date | null
  rhythm: WritingRhythm | null
  now?: Date
}): RhythmTimingState {
  if (!waitingSince || !rhythm) return 'unset'

  const start = waitingSince instanceof Date ? waitingSince : new Date(waitingSince)
  if (Number.isNaN(start.getTime())) return 'unset'

  const horizonMs = WRITING_RHYTHMS[rhythm].approximateDays * 24 * 60 * 60 * 1000
  return now.getTime() <= start.getTime() + horizonMs ? 'within' : 'beyond'
}

export function rhythmStatusCopy({
  whoseTurn,
  timing,
  counterpartPseudonym,
}: {
  whoseTurn: 'viewer' | 'counterpart'
  timing: RhythmTimingState
  counterpartPseudonym: string
}): string | null {
  if (timing === 'unset') return null

  if (whoseTurn === 'viewer') {
    return timing === 'within'
      ? 'Your turn · within your usual rhythm'
      : 'Your turn · a little beyond your usual rhythm'
  }

  return timing === 'within'
    ? `Waiting on ${counterpartPseudonym} · within their usual rhythm`
    : 'Quiet right now'
}

export async function getMyWritingRhythm(
  supabase: SupabaseClient
): Promise<MyWritingRhythm | null> {
  const { data, error } = await supabase.rpc('get_my_writing_rhythm')
  if (error) {
    console.error('[writing-rhythm] get_my_writing_rhythm failed', {
      code: error.code,
      message: error.message,
    })
    return null
  }

  const row = (Array.isArray(data) ? data[0] : data) as MyWritingRhythmRow | null
  if (!row) return null

  return {
    rhythm: isWritingRhythm(row.rhythm) ? row.rhythm : null,
    approximateDays: typeof row.approximate_days === 'number' ? row.approximate_days : null,
  }
}

export async function setMyWritingRhythm(
  supabase: SupabaseClient,
  rhythm: WritingRhythm
) {
  return supabase.rpc('set_my_writing_rhythm', { p_rhythm: rhythm })
}

export async function getCorrespondenceRhythm(
  supabase: SupabaseClient,
  correspondenceId: string
): Promise<CorrespondenceRhythmState | null> {
  const { data, error } = await supabase.rpc('get_correspondence_rhythm', {
    p_correspondence_id: correspondenceId,
  })

  if (error) {
    console.error('[writing-rhythm] get_correspondence_rhythm failed', {
      code: error.code,
      message: error.message,
    })
    return null
  }

  const row = (Array.isArray(data) ? data[0] : data) as CorrespondenceRhythmRow | null
  if (!row) return null

  return {
    viewerId: row.viewer_id,
    counterpartId: row.counterpart_id,
    viewerRhythm: isWritingRhythm(row.viewer_rhythm) ? row.viewer_rhythm : null,
    viewerApproximateDays: typeof row.viewer_approximate_days === 'number' ? row.viewer_approximate_days : null,
    viewerUsesOverride: Boolean(row.viewer_uses_override),
    counterpartRhythm: isWritingRhythm(row.counterpart_rhythm) ? row.counterpart_rhythm : null,
    counterpartApproximateDays: typeof row.counterpart_approximate_days === 'number' ? row.counterpart_approximate_days : null,
  }
}

export async function setCorrespondenceRhythmOverride(
  supabase: SupabaseClient,
  correspondenceId: string,
  rhythm: WritingRhythm | null
) {
  return supabase.rpc('set_correspondence_rhythm_override', {
    p_correspondence_id: correspondenceId,
    p_rhythm: rhythm,
  })
}
