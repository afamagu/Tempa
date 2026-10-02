'use server'
import { createClient } from '@/lib/supabase/server'
import { readRoomAnswers, type RoomCursor, type RoomFilters } from '@/lib/room-reading'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export async function loadRoomAnswers(questionId: string, cursor: RoomCursor | null, filters: RoomFilters, limit = 3) {
  const failed = { entries: [], cursor: null, hasMore: false, error: 'Could not load these answers. Please try again.' }
  if (typeof questionId !== 'string' || !uuid.test(questionId) || !filters || typeof filters !== 'object'
    || !Number.isInteger(limit) || limit < 1 || limit > 12
    || [filters.country, filters.gender, filters.age].some(v => v !== undefined && (typeof v !== 'string' || v.length > 100))
    || (cursor !== null && (!cursor || typeof cursor.answerId !== 'string' || !uuid.test(cursor.answerId) || typeof cursor.createdAt !== 'string' || !Number.isFinite(Date.parse(cursor.createdAt))))) return failed
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { ...failed, error: 'Please sign in again.' }
  return readRoomAnswers(client, questionId, filters, cursor, limit)
}
