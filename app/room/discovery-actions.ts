'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentRoomQuestion } from '@/lib/questions'
import { getDiscoveryPage, type DiscoveryRequest } from '@/lib/discovery'
import { discoveryEntries } from '@/lib/discovery-entries'
import { recordRoomExposureOpportunities } from '@/lib/room-exposure'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function loadMorePeople(request: DiscoveryRequest, shownIds: string[], profileLed = false) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { entries: [], hasMore: false, error: 'signIn' as const }
  if (!request || typeof request !== 'object' || !Array.isArray(shownIds) || shownIds.length > 600 || shownIds.some((id) => typeof id !== 'string' || !UUID.test(id))) {
    return { entries: [], hasMore: false, error: 'failed' as const }
  }
  // Never trust a caller-supplied Question id as the live Question.
  const live = request.questionId ? await getCurrentRoomQuestion(supabase) : null
  if (request.questionId && request.questionId !== live?.id) return { entries: [], hasMore: false, error: 'changed' as const }
  const page = await getDiscoveryPage(supabase, {
    country: String(request.country ?? '').slice(0, 100), gender: String(request.gender ?? '').slice(0, 100),
    ageRange: String(request.ageRange ?? '').slice(0, 20), language: String(request.language ?? '').slice(0, 100),
    intent: String(request.intent ?? '').slice(0, 100), search: String(request.search ?? '').slice(0, 80),
    questionId: live?.id, browseStartedAt: request.browseStartedAt, profileLed, excludeUserIds: [...new Set(shownIds)], offset: 0, limit: 6,
  })
  if (page.unavailable) return { entries: [], hasMore: true, error: 'failed' as const }
  await recordRoomExposureOpportunities(user.id, page.candidates, live ? 'room_question' : 'room')
  return { entries: await discoveryEntries(supabase, page.candidates), hasMore: page.filteredCount > page.candidates.length, error: null }
}
