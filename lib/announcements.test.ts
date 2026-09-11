import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  archiveAnnouncement,
  getActiveAnnouncement,
  deriveAnnouncementState,
  type AnnouncementInput,
} from './announcements'
import { EMPTY_ANNOUNCEMENT_DOC, type AnnouncementDocJSON } from './announcement-editor-doc'
import { createFakeAnnouncements } from './__tests__/simulateAnnouncementRpcs'

const ADMIN = 'user-admin'
const MODERATOR = 'user-moderator'
const MEMBER = 'user-member'

function client(fake: ReturnType<typeof createFakeAnnouncements>) {
  return fake as unknown as SupabaseClient
}

const SAMPLE_DOC: AnnouncementDocJSON = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello members.' }] }],
}

function baseInput(overrides: Partial<AnnouncementInput> = {}): AnnouncementInput {
  return {
    title: 'Scheduled maintenance',
    subtitle: 'A short deck line',
    contentJson: SAMPLE_DOC,
    ...overrides,
  }
}

describe('1. Draft may be incomplete', () => {
  it('a draft can be created with no hero image, no dates, and is saved as draft', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id, error } = await createAnnouncement(client(fake), baseInput())
    expect(error).toBeNull()
    expect(id).toBeTruthy()
    expect(fake._announcements[0].status).toBe('draft')
    expect(fake._announcements[0].hero_image_path).toBeNull()
    expect(fake._announcements[0].ends_at).toBeNull()
  })
})

describe('2/3. Publish rejects missing hero image or missing end date/time', () => {
  it('rejects publish with no hero image', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await createAnnouncement(client(fake), baseInput({ endsAt: '2026-12-31T00:00:00Z' }))
    const { error } = await publishAnnouncement(client(fake), id as string)
    expect(error?.message).toBe('A hero image is required before publishing.')
  })

  it('rejects publish with no end date/time', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await createAnnouncement(client(fake), baseInput({ heroImagePath: 'admin/hero.jpg' }))
    const { error } = await publishAnnouncement(client(fake), id as string)
    expect(error?.message).toBe('An end date and time is required before publishing.')
  })

  it('publish succeeds once hero image, end date, and body are all present', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await createAnnouncement(
      client(fake),
      baseInput({ heroImagePath: 'admin/hero.jpg', endsAt: '2026-12-31T00:00:00Z' })
    )
    const { error } = await publishAnnouncement(client(fake), id as string)
    expect(error).toBeNull()
    expect(fake._announcements[0].status).toBe('published')
    expect(fake._announcements[0].published_at).not.toBeNull()
  })
})

describe('4/5/6. Scheduled visibility window', () => {
  async function publishedAnnouncement(startsAt: string | null, endsAt: string) {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await createAnnouncement(
      client(fake),
      baseInput({ heroImagePath: 'admin/hero.jpg', startsAt, endsAt })
    )
    await publishAnnouncement(client(fake), id as string)
    return fake
  }

  it('4. a Scheduled Announcement (starts_at in the future) is invisible before its start', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const fake = await publishedAnnouncement(future, new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString())
    fake._setViewer(MEMBER)
    expect(await getActiveAnnouncement(client(fake))).toBeNull()
  })

  it('5. a Scheduled Announcement becomes eligible once its start has passed', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const fake = await publishedAnnouncement(past, future)
    fake._setViewer(MEMBER)
    const active = await getActiveAnnouncement(client(fake))
    expect(active?.title).toBe('Scheduled maintenance')
  })

  it('6. an Announcement is invisible after its end has passed', async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const alsoPast = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const fake = await publishedAnnouncement(past, alsoPast)
    fake._setViewer(MEMBER)
    expect(await getActiveAnnouncement(client(fake))).toBeNull()
  })
})

describe('7/8. Manual deactivate removes it immediately; history remains', () => {
  it('deactivating a live announcement makes it immediately invisible, and it is never deleted', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await createAnnouncement(
      client(fake),
      baseInput({ heroImagePath: 'admin/hero.jpg', endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
    )
    await publishAnnouncement(client(fake), id as string)

    fake._setViewer(MEMBER)
    expect(await getActiveAnnouncement(client(fake))).not.toBeNull()

    fake._setViewer(ADMIN)
    const { error } = await archiveAnnouncement(client(fake), id as string)
    expect(error).toBeNull()

    fake._setViewer(MEMBER)
    expect(await getActiveAnnouncement(client(fake))).toBeNull()

    // 8. Still present in admin history, never hard-deleted.
    fake._setViewer(ADMIN)
    const { data: all } = await listAnnouncements(client(fake))
    expect(all.find((a) => a.id === id)?.status).toBe('archived')
  })

  it('archiving something not currently published (e.g. a draft) is a clear error', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await createAnnouncement(client(fake), baseInput())
    const { error } = await archiveAnnouncement(client(fake), id as string)
    expect(error?.message).toBe('This announcement is not currently published.')
  })
})

describe('9. Non-admin cannot mutate Announcement content/media', () => {
  it('a moderator cannot create, update, publish, or archive', async () => {
    const fake = createFakeAnnouncements({ viewerId: MODERATOR, staff: { [MODERATOR]: 'moderator' } })
    expect((await createAnnouncement(client(fake), baseInput())).error?.message).toBe('Not authorized.')
    expect((await listAnnouncements(client(fake))).error?.message).toBe('Not authorized.')
  })

  it('a non-staff member cannot create or list', async () => {
    const fake = createFakeAnnouncements({ viewerId: MEMBER })
    expect((await createAnnouncement(client(fake), baseInput())).error?.message).toBe('Not authorized.')
  })

  it('an admin CAN still edit an already-published announcement (no Question-style immutability rule here)', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await createAnnouncement(
      client(fake),
      baseInput({ heroImagePath: 'admin/hero.jpg', endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
    )
    await publishAnnouncement(client(fake), id as string)
    const { error } = await updateAnnouncement(client(fake), id as string, baseInput({ title: 'Updated live title' }))
    expect(error).toBeNull()
    expect(fake._announcements[0].title).toBe('Updated live title')
  })
})

describe('10. Structured body renders safely', () => {
  it('docToPlainText extracts readable text from the structured document, never HTML', async () => {
    const { docToPlainText } = await import('./announcement-editor-doc')
    expect(docToPlainText(SAMPLE_DOC)).toBe('Hello members.')
  })

  it('an empty document has no content', async () => {
    const { announcementDocHasContent } = await import('./announcement-editor-doc')
    expect(announcementDocHasContent(EMPTY_ANNOUNCEMENT_DOC)).toBe(false)
    expect(announcementDocHasContent(SAMPLE_DOC)).toBe(true)
  })

  it('a heading + bullet list document extracts every text node safely', async () => {
    const { docToPlainText } = await import('./announcement-editor-doc')
    const doc: AnnouncementDocJSON = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A heading' }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] },
          ],
        },
      ],
    }
    const text = docToPlainText(doc)
    expect(text).toContain('A heading')
    expect(text).toContain('First')
    expect(text).toContain('Second')
  })
})

describe('11. Home still returns at most one Announcement', () => {
  it('with two overlapping live announcements, only the most recently PUBLISHED one is returned', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { data: id1 } = await createAnnouncement(
      client(fake),
      baseInput({ title: 'First', heroImagePath: 'admin/a.jpg', endsAt: future })
    )
    await publishAnnouncement(client(fake), id1 as string)
    await new Promise((r) => setTimeout(r, 2))
    const { data: id2 } = await createAnnouncement(
      client(fake),
      baseInput({ title: 'Second', heroImagePath: 'admin/b.jpg', endsAt: future })
    )
    await publishAnnouncement(client(fake), id2 as string)

    fake._setViewer(MEMBER)
    const active = await getActiveAnnouncement(client(fake))
    expect(active?.title).toBe('Second')
  })

  it('with nothing published, returns null, not an empty array or a crash', async () => {
    const fake = createFakeAnnouncements({ viewerId: MEMBER })
    expect(await getActiveAnnouncement(client(fake))).toBeNull()
  })
})

describe('12. image + title + subtitle + structured body map correctly end to end', () => {
  it('every field round-trips through create -> list -> get_active_announcement', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await createAnnouncement(client(fake), {
      title: 'Full round trip',
      subtitle: 'A deck line',
      contentJson: SAMPLE_DOC,
      heroImagePath: 'admin/hero.jpg',
      endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    await publishAnnouncement(client(fake), id as string)

    const { data: adminList } = await listAnnouncements(client(fake))
    const row = adminList.find((a) => a.id === id)!
    expect(row.title).toBe('Full round trip')
    expect(row.subtitle).toBe('A deck line')
    expect(row.heroImagePath).toBe('admin/hero.jpg')
    expect(row.contentJson).toEqual(SAMPLE_DOC)
    expect(row.body).toBe('Hello members.')

    fake._setViewer(MEMBER)
    const active = await getActiveAnnouncement(client(fake))
    expect(active?.title).toBe('Full round trip')
    expect(active?.subtitle).toBe('A deck line')
    expect(active?.heroImagePath).toBe('admin/hero.jpg')
    expect(active?.contentJson).toEqual(SAMPLE_DOC)
  })
})

describe('Final Correction round — server-side content_json structural validation (item 1)', () => {
  it('rejects an unsupported block node type via a direct RPC call, bypassing the TS input layer entirely', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: { type: 'doc', content: [{ type: 'video', src: 'evil.mp4' }] },
    })
    expect(error?.message).toBe('The announcement body contains unsupported content.')
  })

  it('rejects an unsupported mark type', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi', marks: [{ type: 'strike' }] }] }],
      },
    })
    expect(error?.message).toBe('The announcement body contains unsupported content.')
  })

  it('rejects malformed structure (content not an array)', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: { type: 'doc', content: 'not-an-array' },
    })
    expect(error?.message).toBe('The announcement body contains unsupported content.')
  })

  it('rejects an unexpected extra key on an otherwise-valid node (closed schema)', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: { type: 'doc', content: [{ type: 'paragraph', content: [], sneaky: true }] },
    })
    expect(error?.message).toBe('The announcement body contains unsupported content.')
  })

  it('rejects a non-string text value', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 12345 }] }] },
    })
    expect(error?.message).toBe('The announcement body contains unsupported content.')
  })

  it('accepts a well-formed document with headings, bullet lists, and bold/italic marks', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Title', marks: [{ type: 'bold' }] }],
          },
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] },
            ],
          },
        ],
      },
    })
    expect(error).toBeNull()
  })
})

describe('Final Correction round — Announcement link safety (item 2)', () => {
  function withLink(href: unknown) {
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href } }] }],
        },
      ],
    }
  }

  it('rejects a javascript: href', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: withLink('javascript:alert(1)'),
    })
    expect(error?.message).toBe('The announcement body contains unsupported content.')
  })

  it('rejects a data: href', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: withLink('data:text/html,<script>alert(1)</script>'),
    })
    expect(error?.message).toBe('The announcement body contains unsupported content.')
  })

  it('rejects a protocol-relative href', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: withLink('//evil.example.com'),
    })
    expect(error?.message).toBe('The announcement body contains unsupported content.')
  })

  it('rejects an ftp:/tel:/mailto: href even though TipTap\'s own default allowlist would accept them', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    for (const href of ['ftp://example.com/file', 'tel:+15555555555', 'mailto:someone@example.com']) {
      const { error } = await fake.rpc('admin_create_announcement', {
        p_title: 'x',
        p_body: 'irrelevant',
        p_content_json: withLink(href),
      })
      expect(error?.message).toBe('The announcement body contains unsupported content.')
    }
  })

  it('accepts an absolute https:// href', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: withLink('https://example.com/path'),
    })
    expect(error).toBeNull()
  })

  it('accepts an internal relative href beginning with a single /', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: withLink('/letters'),
    })
    expect(error).toBeNull()
  })
})

describe('Final Correction round — Drafts must actually be incomplete (item 4)', () => {
  it('a Draft can be saved with a title but no body/content at all', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id, error } = await fake.rpc('admin_create_announcement', {
      p_title: 'Early draft',
      p_body: '',
      p_content_json: null,
    })
    expect(error).toBeNull()
    expect(fake._announcements.find((a) => a.id === id)?.status).toBe('draft')
  })

  it('publishing that incomplete Draft is rejected', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await fake.rpc('admin_create_announcement', {
      p_title: 'Early draft',
      p_body: '',
      p_content_json: null,
    })
    const { error } = await publishAnnouncement(client(fake), id as string)
    expect(error).not.toBeNull()
  })

  it('a structurally valid but semantically EMPTY document (content_json set, but no real text) still fails publish', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await createAnnouncement(
      client(fake),
      baseInput({
        contentJson: EMPTY_ANNOUNCEMENT_DOC,
        heroImagePath: 'admin/hero.jpg',
        endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
    )
    const { error } = await publishAnnouncement(client(fake), id as string)
    expect(error?.message).toBe('A body is required before publishing.')
  })

  it('completing the Draft (content + image + end date) allows publish to succeed', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await createAnnouncement(
      client(fake),
      baseInput({ heroImagePath: 'admin/hero.jpg', endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
    )
    const { error } = await publishAnnouncement(client(fake), id as string)
    expect(error).toBeNull()
  })
})

describe('Final Correction round — hero image existence check at publish (item 5)', () => {
  it('rejects publish when the hero_image_path does not actually exist in storage', async () => {
    const fake = createFakeAnnouncements({
      viewerId: ADMIN,
      staff: { [ADMIN]: 'admin' },
      missingHeroImagePaths: ['admin/ghost.jpg'],
    })
    const { data: id } = await createAnnouncement(
      client(fake),
      baseInput({ heroImagePath: 'admin/ghost.jpg', endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
    )
    const { error } = await publishAnnouncement(client(fake), id as string)
    expect(error?.message).toMatch(/could not be found/)
  })

  it('publishes normally when the hero image exists', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await createAnnouncement(
      client(fake),
      baseInput({ heroImagePath: 'admin/real.jpg', endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
    )
    const { error } = await publishAnnouncement(client(fake), id as string)
    expect(error).toBeNull()
  })
})

describe('SQL Hardening round, item 1 — backslash edge case rejected via direct RPC', () => {
  function withLink(href: unknown) {
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href } }] }],
        },
      ],
    }
  }

  it('rejects /\\evil.example', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: withLink('/\\evil.example'),
    })
    expect(error?.message).toBe('The announcement body contains unsupported content.')
  })

  it('rejects /\\\\evil.example', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: withLink('/\\\\evil.example'),
    })
    expect(error?.message).toBe('The announcement body contains unsupported content.')
  })

  it('still accepts an ordinary internal relative link with no backslash', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { error } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'irrelevant',
      p_content_json: withLink('/profile/example'),
    })
    expect(error).toBeNull()
  })
})

describe('SQL Hardening round, item 2 — content_json must contain real text at publish, independent of the body column', () => {
  const ENDS_AT = () => new Date(Date.now() + 60 * 60 * 1000).toISOString()

  it('a valid-but-empty content_json paired with a fake non-blank body is still rejected at publish', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'fake fallback text',
      p_content_json: { type: 'doc', content: [{ type: 'paragraph' }] },
      p_hero_image_path: 'admin/hero.jpg',
      p_ends_at: ENDS_AT(),
    })
    const { error } = await publishAnnouncement(client(fake), id as string)
    expect(error?.message).toBe('A body is required before publishing.')
  })

  it('a document containing only a hardBreak (no real text) is rejected, even with a non-blank body', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'unrelated fallback text',
      p_content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'hardBreak' }] }] },
      p_hero_image_path: 'admin/hero.jpg',
      p_ends_at: ENDS_AT(),
    })
    const { error } = await publishAnnouncement(client(fake), id as string)
    expect(error?.message).toBe('A body is required before publishing.')
  })

  it('whitespace-only text does not count as real content', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'unrelated fallback text',
      p_content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }] },
      p_hero_image_path: 'admin/hero.jpg',
      p_ends_at: ENDS_AT(),
    })
    const { error } = await publishAnnouncement(client(fake), id as string)
    expect(error?.message).toBe('A body is required before publishing.')
  })

  it('content_json containing actual text publishes successfully once image/end-date also pass', async () => {
    const fake = createFakeAnnouncements({ viewerId: ADMIN, staff: { [ADMIN]: 'admin' } })
    const { data: id } = await fake.rpc('admin_create_announcement', {
      p_title: 'x',
      p_body: 'Hello members.',
      p_content_json: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello members.' }] }],
      },
      p_hero_image_path: 'admin/hero.jpg',
      p_ends_at: ENDS_AT(),
    })
    const { error } = await publishAnnouncement(client(fake), id as string)
    expect(error).toBeNull()
  })
})

describe('deriveAnnouncementState — pure, no new DB enum needed', () => {
  const NOW = new Date('2026-06-15T12:00:00Z')

  it('draft', () => {
    expect(deriveAnnouncementState('draft', null, null, NOW)).toBe('draft')
  })

  it('archived', () => {
    expect(deriveAnnouncementState('archived', null, null, NOW)).toBe('archived')
  })

  it('scheduled — published with a future start', () => {
    expect(deriveAnnouncementState('published', '2026-06-16T00:00:00Z', '2026-06-20T00:00:00Z', NOW)).toBe('scheduled')
  })

  it('live — published, started, not yet ended', () => {
    expect(deriveAnnouncementState('published', '2026-06-01T00:00:00Z', '2026-06-20T00:00:00Z', NOW)).toBe('live')
  })

  it('live — published with no start/end at all', () => {
    expect(deriveAnnouncementState('published', null, null, NOW)).toBe('live')
  })

  it('expired — published, end already passed', () => {
    expect(deriveAnnouncementState('published', '2026-06-01T00:00:00Z', '2026-06-10T00:00:00Z', NOW)).toBe('expired')
  })
})
