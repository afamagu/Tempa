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

const RHYTHM_COPY = {
  en: {
    heading: 'Your usual rhythm',
    help: 'This is not a deadline. It gives the other person a rough idea of what silence normally means for you.',
    values: {
      few_days: { label: 'Within a few days', description: 'A short pause is normal.' },
      one_week: { label: 'About a week', description: 'You usually like to answer within roughly a week.' },
      two_weeks: { label: 'Within two weeks', description: 'You prefer a slower correspondence.' },
      one_month: { label: 'I write slowly — up to a month', description: 'Long gaps are normal for you, but there is still a rough horizon.' },
    },
  },
  fr: {
    heading: 'Votre rythme habituel',
    help: 'Ce n’est pas une échéance. Cela donne à l’autre personne une idée approximative de ce que signifie normalement votre silence.',
    values: {
      few_days: { label: 'Sous quelques jours', description: 'Une courte pause est normale.' },
      one_week: { label: 'Environ une semaine', description: 'Vous aimez généralement répondre sous environ une semaine.' },
      two_weeks: { label: 'Dans les deux semaines', description: 'Vous préférez une correspondance plus lente.' },
      one_month: { label: 'J’écris lentement — jusqu’à un mois', description: 'Les longues pauses sont normales pour vous, mais il existe tout de même un horizon approximatif.' },
    },
  },
  es: {
    heading: 'Tu ritmo habitual',
    help: 'No es una fecha límite. Le da a la otra persona una idea aproximada de lo que suele significar tu silencio.',
    values: {
      few_days: { label: 'En unos días', description: 'Una pausa corta es normal.' },
      one_week: { label: 'Aproximadamente una semana', description: 'Normalmente te gusta responder en alrededor de una semana.' },
      two_weeks: { label: 'En un plazo de dos semanas', description: 'Prefieres una correspondencia más pausada.' },
      one_month: { label: 'Escribo despacio — hasta un mes', description: 'Las pausas largas son normales para ti, pero sigue habiendo un horizonte aproximado.' },
    },
  },
  pt: {
    heading: 'O seu ritmo habitual',
    help: 'Isto não é um prazo. Dá à outra pessoa uma noção aproximada do que o seu silêncio normalmente significa.',
    values: {
      few_days: { label: 'Dentro de alguns dias', description: 'Uma pausa curta é normal.' },
      one_week: { label: 'Cerca de uma semana', description: 'Normalmente prefere responder dentro de aproximadamente uma semana.' },
      two_weeks: { label: 'Dentro de duas semanas', description: 'Prefere uma correspondência mais lenta.' },
      one_month: { label: 'Escrevo devagar — até um mês', description: 'Pausas longas são normais para si, mas continua a existir um horizonte aproximado.' },
    },
  },
} as const

export type WritingRhythmLocale = keyof typeof RHYTHM_COPY

export function writingRhythmCopy(locale: string) {
  const base = locale.split('-')[0] as WritingRhythmLocale
  return RHYTHM_COPY[base] ?? RHYTHM_COPY.en
}

export function writingRhythmOptions(locale: string) {
  const copy = writingRhythmCopy(locale)
  return (Object.keys(WRITING_RHYTHMS) as WritingRhythm[]).map((value) => ({
    value,
    label: copy.values[value].label,
    description: copy.values[value].description,
  }))
}

export function isWritingRhythm(value: unknown): value is WritingRhythm {
  return typeof value === 'string' && value in WRITING_RHYTHMS
}

export function writingRhythmLabel(
  rhythm: WritingRhythm | null | undefined,
  locale = 'en'
): string | null {
  return rhythm ? writingRhythmCopy(locale).values[rhythm].label : null
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
