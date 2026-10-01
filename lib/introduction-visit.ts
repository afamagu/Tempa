// Visit timing is UI suppression only. Database introduction history remains
// the authority for who is eligible and which cards have actually been seen.
export const INTRODUCTION_RETURN_AFTER_MS = 20 * 60 * 1000
export type IntroductionVisitMode = 'initial' | 'return'
type Store = Pick<Storage, 'getItem' | 'setItem'> | null
export type IntroductionVisitState = {
  handledAt: number | null
  lastActiveAt: number
  awaySince: number | null
  pendingReturn: boolean
}
const memory = new Map<string, IntroductionVisitState>()
const key = (sessionId: string) => `tempa.introductions.visit.v2:${sessionId}`
export function readIntroductionVisit(storage: Store, sessionId: string): IntroductionVisitState | null {
  try {
    if (!storage) return memory.get(sessionId) ?? null
    const raw = storage.getItem(key(sessionId))
    if (!raw) return null
    if (raw) {
      const state = JSON.parse(raw) as IntroductionVisitState
      if ((state.handledAt === null || Number.isFinite(state.handledAt)) && Number.isFinite(state.lastActiveAt)
        && (state.awaySince === null || Number.isFinite(state.awaySince)) && typeof state.pendingReturn === 'boolean') return state
    }
  } catch { /* In-memory suppression survives menu navigation if storage fails. */ }
  return memory.get(sessionId) ?? null
}
function write(storage: Store, sessionId: string, state: IntroductionVisitState) {
  memory.set(sessionId, state)
  try { storage?.setItem(key(sessionId), JSON.stringify(state)) } catch { /* best effort */ }
}
function due(state: IntroductionVisitState | null, now: number): IntroductionVisitMode | null {
  if (!state || state.handledAt === null) return 'initial'
  if (state.pendingReturn || now - (state.awaySince ?? state.lastActiveAt) >= INTRODUCTION_RETURN_AFTER_MS) return 'return'
  return null
}
export function claimIntroductionVisit(storage: Store, sessionId: string, now: number): IntroductionVisitMode | null {
  const state = readIntroductionVisit(storage, sessionId)
  const mode = due(state, now)
  if (!mode) return null
  // Reserve before fetching so remounts/refreshes do not start another stack.
  write(storage, sessionId, { handledAt: now, lastActiveAt: now, awaySince: null, pendingReturn: false })
  return mode
}
export function noteIntroductionActivity(storage: Store, sessionId: string, now: number) {
  const state = readIntroductionVisit(storage, sessionId)
  write(storage, sessionId, {
    handledAt: state?.handledAt ?? null, lastActiveAt: now, awaySince: null,
    pendingReturn: state?.pendingReturn === true || due(state, now) === 'return',
  })
}
export function noteIntroductionAway(storage: Store, sessionId: string, now: number) {
  const state = readIntroductionVisit(storage, sessionId)
  if (state) write(storage, sessionId, { ...state, awaySince: state.awaySince ?? now })
}

let presence: { sessionId: string; stop: () => void } | null = null
/** Keep presence across focused composer routes, which do not mount AppShell.
 * This tracker performs no auth calls, fetches or database mutations. */
export function ensureIntroductionPresence(storage: Store, sessionId: string) {
  if (presence?.sessionId === sessionId) return
  presence?.stop()
  let focused = document.hasFocus()
  let lastActivity = 0
  const active = () => !document.hidden && focused
  const away = () => {
    focused = false
    noteIntroductionAway(storage, sessionId, Date.now())
  }
  const returned = () => {
    focused = document.hasFocus()
    if (active()) noteIntroductionActivity(storage, sessionId, Date.now())
  }
  const visibility = () => { if (document.hidden) away(); else returned() }
  const activity = () => {
    if (active() && Date.now() - lastActivity >= 30000) {
      lastActivity = Date.now()
      noteIntroductionActivity(storage, sessionId, lastActivity)
    }
  }
  const timer = window.setInterval(() => {
    if (active()) noteIntroductionActivity(storage, sessionId, Date.now())
  }, 60000)
  window.addEventListener('blur', away)
  window.addEventListener('focus', returned)
  window.addEventListener('pagehide', away)
  window.addEventListener('pageshow', returned)
  document.addEventListener('visibilitychange', visibility)
  document.addEventListener('pointerdown', activity)
  document.addEventListener('keydown', activity)
  presence = { sessionId, stop: () => {
    window.clearInterval(timer)
    window.removeEventListener('blur', away)
    window.removeEventListener('focus', returned)
    window.removeEventListener('pagehide', away)
    window.removeEventListener('pageshow', returned)
    document.removeEventListener('visibilitychange', visibility)
    document.removeEventListener('pointerdown', activity)
    document.removeEventListener('keydown', activity)
  } }
}
export function stopIntroductionPresence() { presence?.stop(); presence = null }
