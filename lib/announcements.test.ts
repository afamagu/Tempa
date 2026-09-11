import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  archiveAnnouncement,
  getActiveAnnouncement,
} from './announcements'
import { createFakeAnnouncements } from './__tests__/simulateAnnouncementRpcs'

const ADMIN = 'user-admin'
const MODERATOR = 'user-moderator'
const MEMBER = 'user-member'

function client(fake: ReturnType<typeof createFakeAnnouncements>) {
  return fake as unknown as SupabaseClient
}

describe('admin_create_announcement / admin_list_announcements — admin-floor only', () => {
  it('an admin can create a draft announcement', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id, error } = await createAnnouncement(client(fake), 'Scheduled maintenance', 'Tempa will be briefly unavailable.')
    expect(error).toBeNull()
    expect(id).toBeTruthy()
    expect(fake._announcements[0].status).toBe('draft')
  })

  it('rejects a blank title or body', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error: titleError } = await createAnnouncement(client(fake), '  ', 'Body')
    expect(titleError?.message).toBe('A title is required.')
    const { error: bodyError } = await createAnnouncement(client(fake), 'Title', '  ')
    expect(bodyError?.message).toBe('A body is required.')
  })

  it('a moderator cannot create an announcement — Admin-level operational control', async () => {
    const fake = createFakeAnnouncements({ viewerId: MODERATOR, staff: { [MODERATOR]: 'moderator' } })
    const { error } = await createAnnouncement(client(fake), 'Title', 'Body')
    expect(error?.message).toBe('Not authorized.')
  })

  it('a moderator cannot list announcements admin either', async () => {
    const fake = createFakeAnnouncements({ viewerId: MODERATOR, staff: { [MODERATOR]: 'moderator' } })
    const { error } = await listAnnouncements(client(fake))
    expect(error?.message).toBe('Not authorized.')
  })

  it('a non-staff member cannot create or list', async () => {
    const fake = createFakeAnnouncements({ viewerId: MEMBER })
    expect((await createAnnouncement(client(fake), 'Title', 'Body')).error?.message).toBe('Not authorized.')
    expect((await listAnnouncements(client(fake))).error?.message).toBe('Not authorized.')
  })
})

describe('admin_update_announcement / admin_publish_announcement / admin_archive_announcement', () => {
  async function seeded() {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await createAnnouncement(client(fake), 'Original title', 'Original body')
    return { fake, id: id as string }
  }

  it('an admin can edit a draft announcement', async () => {
    const { fake, id } = await seeded()
    const { error } = await updateAnnouncement(client(fake), id, 'Revised title', 'Revised body')
    expect(error).toBeNull()
    expect(fake._announcements[0].title).toBe('Revised title')
  })

  it('publishing moves status to published; publishing again is a clear idempotency error', async () => {
    const { fake, id } = await seeded()
    const first = await publishAnnouncement(client(fake), id)
    expect(first.error).toBeNull()
    expect(fake._announcements[0].status).toBe('published')

    const second = await publishAnnouncement(client(fake), id)
    expect(second.error?.message).toBe('This announcement is already published.')
  })

  it('an admin can still edit an already-published announcement (no immutability rule for Announcements)', async () => {
    const { fake, id } = await seeded()
    await publishAnnouncement(client(fake), id)
    const { error } = await updateAnnouncement(client(fake), id, 'Live edit', 'Updated while live')
    expect(error).toBeNull()
    expect(fake._announcements[0].title).toBe('Live edit')
  })

  it('unpublish (archive) moves a published announcement to archived, never deletes it', async () => {
    const { fake, id } = await seeded()
    await publishAnnouncement(client(fake), id)
    const { error } = await archiveAnnouncement(client(fake), id)
    expect(error).toBeNull()
    expect(fake._announcements[0].status).toBe('archived')
    // Still present, not deleted.
    expect(fake._announcements).toHaveLength(1)
  })

  it('archiving something not currently published is a clear error', async () => {
    const { fake, id } = await seeded()
    const { error } = await archiveAnnouncement(client(fake), id)
    expect(error?.message).toBe('This announcement is not currently published.')
  })

  it('a moderator cannot publish, unpublish, or edit', async () => {
    const { fake, id } = await seeded()
    fake._setViewer(MODERATOR)
    expect((await publishAnnouncement(client(fake), id)).error?.message).toBe('Not authorized.')
    expect((await updateAnnouncement(client(fake), id, 'x', 'y')).error?.message).toBe('Not authorized.')
  })
})

describe('get_active_announcement — the ONE currently active announcement, deterministic ranking', () => {
  it('returns null when nothing is published', async () => {
    const fake = createFakeAnnouncements({ viewerId: MEMBER })
    expect(await getActiveAnnouncement(client(fake))).toBeNull()
  })

  it('returns the most recently published announcement when more than one is active', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id1 } = await createAnnouncement(client(fake), 'First', 'First body')
    await publishAnnouncement(client(fake), id1 as string)
    // Ensure a distinct, later updated_at for the second publish.
    await new Promise((r) => setTimeout(r, 2))
    const { data: id2 } = await createAnnouncement(client(fake), 'Second', 'Second body')
    await publishAnnouncement(client(fake), id2 as string)

    fake._setViewer(MEMBER)
    const active = await getActiveAnnouncement(client(fake))
    expect(active?.title).toBe('Second')
  })

  it('a draft or archived announcement is never returned as active', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    await createAnnouncement(client(fake), 'Still a draft', 'Not published yet')
    const { data: id2 } = await createAnnouncement(client(fake), 'Was published', 'Now archived')
    await publishAnnouncement(client(fake), id2 as string)
    await archiveAnnouncement(client(fake), id2 as string)

    fake._setViewer(MEMBER)
    expect(await getActiveAnnouncement(client(fake))).toBeNull()
  })

  it('an unauthenticated caller gets null, not a thrown error — Home stays resilient', async () => {
    const fake = createFakeAnnouncements({ viewerId: null })
    expect(await getActiveAnnouncement(client(fake))).toBeNull()
  })
})
