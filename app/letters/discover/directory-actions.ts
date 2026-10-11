'use server'

import { createClient } from '@/lib/supabase/server'
import { getRoomDirectoryPage, type DirectoryFilters } from '@/lib/room-directory'

/** Called only by the finite, intentional Discover People browser. */
export async function loadDirectoryPeople(input: {
  filters: DirectoryFilters
  seed: string
  afterUserId?: string | null
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { entries: [], hasMore: false, error: 'Please sign in again.' }
  if (!input || typeof input !== 'object' || !input.filters || typeof input.seed !== 'string') {
    return { entries: [], hasMore: false, error: 'Invalid directory request.' }
  }
  return getRoomDirectoryPage(supabase, input.filters, input.seed, input.afterUserId ?? null)
}
