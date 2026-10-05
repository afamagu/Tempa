'use server'
import { createClient } from '@/lib/supabase/server'
import { readRoomAnswers, type RoomFilters } from '@/lib/room-reading'
import { recordRoomExposureOpportunities } from '@/lib/room-exposure'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export async function loadRoomAnswers(questionId: string, shownUserIds: string[], filters: RoomFilters, limit = 6) {
  const failed = { entries: [], cursor: null, hasMore: false, error: 'Could not load these answers. Please try again.' }
  if (typeof questionId !== 'string' || !uuid.test(questionId) || !filters || typeof filters !== 'object'
    || !Array.isArray(shownUserIds) || shownUserIds.length > 600 || shownUserIds.some((id) => typeof id !== 'string' || !uuid.test(id))
    || !Number.isInteger(limit) || limit < 1 || limit > 12
    || [filters.country, filters.gender, filters.age].some(v => v !== undefined && (typeof v !== 'string' || v.length > 100))) return failed
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { ...failed, error: 'Please sign in again.' }
  const page = await readRoomAnswers(client, questionId, filters, shownUserIds, limit)
  if (page.entries.length) await recordRoomExposureOpportunities(user.id, page.entries, 'room_question')
  return page
}
