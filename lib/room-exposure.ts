import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import type { DiscoveryCandidate, DiscoverySurface } from '@/lib/discovery'

/**
 * Records only the bounded candidates that were actually selected for a
 * rendered discovery surface. Ranking must never depend on this write
 * succeeding, so failures are observable in server logs but fail open.
 */
export async function recordRoomExposureOpportunities(
  viewerId: string,
  candidates: Pick<DiscoveryCandidate, 'userId'>[],
  surface: DiscoverySurface
): Promise<void> {
  const candidateIds = [...new Set(candidates.map((candidate) => candidate.userId))]
  if (candidateIds.length === 0) return

  try {
    const service = createServiceClient()
    const { error } = await service.rpc('record_room_exposures', {
      p_viewer: viewerId,
      p_candidate_ids: candidateIds,
      p_surface: surface,
    })
    if (error) console.error('Room exposure recording failed', { surface, code: error.code, message: error.message })
  } catch (error) {
    console.error('Room exposure recording unavailable', { surface, error })
  }
}
