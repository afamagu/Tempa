import type { SupabaseClient } from '@supabase/supabase-js'
import { genderDisplay } from '@/lib/discovery'
import { publicProfileMarkUrl } from '@/lib/profile-marks'

// Member introductions ("People to meet") — the client-side data layer.
// Selection, Safety/discovery eligibility, newcomer priority and ranking
// all live in Postgres (public.get_member_introductions — see
// docs/sql/2026-10-14-member-introductions.sql); this module only calls
// the three self-scoped RPCs, maps the (at most seven) rows, and owns the
// once-per-visit suppression.

export const MAX_INTRODUCTIONS = 7

export type IntroductionConsumeReason = 'advanced' | 'write' | 'profile'

export type IntroductionCard = {
  candidateId: string
  pseudonym: string
  identityLine: string
  markUrl: string | null
  languages: string[]
  intents: string[]
  sharedLanguages: string[]
  sharedIntents: string[]
  answerId: string
  prompt: string
  body: string
}

type IntroductionRow = {
  candidate_id: string
  pseudonym: string
  country: string | null
  gender: string | null
  gender_custom: string | null
  age_range: string | null
  mark_id: string | null
  languages: string[] | null
  intent: string[] | null
  shared_languages: string[] | null
  shared_intents: string[] | null
  answer_id: string
  prompt: string | null
  body: string
}

export function toIntroductionCards(rows: IntroductionRow[], markUrlFor: (markId: string) => string): IntroductionCard[] {
  const seen = new Set<string>()
  const cards: IntroductionCard[] = []
  for (const row of rows) {
    if (seen.has(row.candidate_id)) continue
    seen.add(row.candidate_id)
    cards.push({
      candidateId: row.candidate_id,
      pseudonym: row.pseudonym,
      identityLine: [row.country, genderDisplay(row.gender, row.gender_custom), row.age_range].filter(Boolean).join(' · '),
      markUrl: row.mark_id ? markUrlFor(row.mark_id) : null,
      languages: row.languages ?? [],
      intents: row.intent ?? [],
      sharedLanguages: row.shared_languages ?? [],
      sharedIntents: row.shared_intents ?? [],
      answerId: row.answer_id,
      prompt: row.prompt ?? '',
      body: row.body,
    })
    if (cards.length === MAX_INTRODUCTIONS) break
  }
  return cards
}

/** Never throws: any failure means "nothing to show" (fail open). */
export async function loadMemberIntroductions(supabase: SupabaseClient): Promise<IntroductionCard[]> {
  try {
    const { data, error } = await supabase.rpc('get_member_introductions', { p_limit: MAX_INTRODUCTIONS })
    if (error || !Array.isArray(data)) return []
    return toIntroductionCards(data as IntroductionRow[], (markId) => publicProfileMarkUrl(supabase, `${markId}.png`))
  } catch {
    return []
  }
}

export async function markIntroductionPresented(supabase: SupabaseClient, candidateId: string): Promise<void> {
  try {
    await supabase.rpc('mark_member_introduction_presented', { p_candidate_id: candidateId })
  } catch {
    // Best effort — never interrupts reading.
  }
}

/** Resolves once recorded, or after `timeoutMs` so navigation is never held hostage. */
export async function consumeIntroduction(
  supabase: SupabaseClient,
  candidateId: string,
  reason: IntroductionConsumeReason,
  timeoutMs = 1500
): Promise<void> {
  const call = Promise.resolve(
    supabase.rpc('consume_member_introduction', { p_candidate_id: candidateId, p_reason: reason })
  ).then(
    () => undefined,
    () => undefined
  )
  await Promise.race([call, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
}

// ---- Once per visit -------------------------------------------------
// A "visit" = one browser tab session (sessionStorage survives refresh
// and in-app navigation, and is cleared when the tab/browser session
// ends) × one Supabase auth session (the access token's session_id
// claim changes on every sign-in, so sign-out → sign-in is a new visit
// even in the same tab). Durable candidate history lives in the
// database, never here.

const VISIT_KEY_PREFIX = 'tempa.introductions.handled:'

export function sessionIdFromAccessToken(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null
  const payload = accessToken.split('.')[1]
  if (!payload) return null
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')))
    const id = typeof json.session_id === 'string' ? json.session_id : typeof json.sub === 'string' ? json.sub : null
    return id
  } catch {
    return null
  }
}

export function visitStorageKey(sessionId: string): string {
  return `${VISIT_KEY_PREFIX}${sessionId}`
}

export function isVisitHandled(storage: Pick<Storage, 'getItem'> | null, sessionId: string): boolean {
  try {
    return storage?.getItem(visitStorageKey(sessionId)) === '1'
  } catch {
    // Storage unavailable: treat as handled rather than risk re-showing
    // the stack on every navigation.
    return true
  }
}

export function markVisitHandled(storage: Pick<Storage, 'setItem'> | null, sessionId: string): void {
  try {
    storage?.setItem(visitStorageKey(sessionId), '1')
  } catch {
    // ignore
  }
}

export function isForwardSwipe(dx: number, dy: number): boolean {
  // Same deliberate-gesture threshold People uses; LEFT only. A right
  // swipe never goes back — there is no previous card.
  return dx <= -60 && Math.abs(dx) > Math.abs(dy) * 1.25
}
