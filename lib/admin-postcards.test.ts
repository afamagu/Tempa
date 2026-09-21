import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listPostcards,
  addPostcard,
  createPostcardVersion,
  setPostcardActive,
  formatPostcardSentCount,
  filterAdminPostcards,
  type AdminPostcard,
} from './admin-postcards'
import { createFakePostcards } from './__tests__/simulatePostcardRpcs'

const ADMIN = 'user-admin'
const MODERATOR = 'user-moderator'
const MEMBER = 'user-member'

function client(fake: ReturnType<typeof createFakePostcards>) {
  return fake as unknown as SupabaseClient
}

function seeded(viewerId: string | null, staff?: Record<string, 'moderator' | 'admin'>) {
  return createFakePostcards({
    viewerId,
    staff,
    catalog: [
      { key: 'essaouira', title: 'Essaouira', countryCode: 'MA', isActive: true },
      { key: 'bangkokAfterRain', title: 'Bangkok', countryCode: 'TH', isActive: true },
    ],
    versions: [
      {
        id: 'pv-essaouira-1',
        postcardKey: 'essaouira',
        versionNumber: 1,
        title: 'Essaouira',
        location: 'Atlantic Morocco',
        collection: 'Atlantic Morocco Collection',
        postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
        footerText: 'Tempa Postcard · Atlantic Morocco Collection',
        frontImagePath: '/postcards/essaouira.jpg',
        motionSrc: '/postcards/essaouira-living.mp4',
        durationSeconds: 10.04,
        revealLineAlignment: null,
        isCurrent: true,
      },
      {
        id: 'pv-bangkok-1',
        postcardKey: 'bangkokAfterRain',
        versionNumber: 1,
        title: 'Bangkok',
        location: 'Thailand after rain',
        collection: 'Thailand After Rain Collection',
        postmarkText: 'BANGKOK\nTHAILAND',
        footerText: 'Tempa Postcard · Thailand After Rain Collection',
        frontImagePath: '/postcards/bangkok-after-rain.jpg',
        motionSrc: '/postcards/bangkok-after-rain-living.mp4',
        durationSeconds: 10.04,
        revealLineAlignment: null,
        isCurrent: true,
      },
    ],
  })
}

const VALID_INPUT = {
  title: 'Essaouira',
  location: 'Atlantic Morocco',
  collection: 'Atlantic Morocco Collection',
  postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
  footerText: 'Tempa Postcard · Atlantic Morocco Collection',
  frontImagePath: '/postcards/essaouira.jpg',
}

describe('admin_list_postcards — admin floor, active AND inactive both listed', () => {
  it('a moderator cannot list Postcards admin — this is admin-floor', async () => {
    const fake = seeded(MODERATOR, { [MODERATOR]: 'moderator' })
    const { data, error } = await listPostcards(client(fake))
    expect(error).not.toBeNull()
    expect(data).toEqual([])
  })

  it('an admin sees every Postcard, active and inactive both, none hidden', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    fake._catalog.find((c) => c.key === 'bangkokAfterRain')!.isActive = false
    const { data, error } = await listPostcards(client(fake))
    expect(error).toBeNull()
    expect(data.map((d) => d.key).sort()).toEqual(['bangkokAfterRain', 'essaouira'])
    expect(data.find((d) => d.key === 'bangkokAfterRain')?.isActive).toBe(false)
  })

  it('times sent reflects every letter that has ever used any version of that key', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    fake._letterPostcards.push(
      { letterId: 'letter-1', postcardVersionId: 'pv-essaouira-1', revealLine: null, backMessage: 'Hi', senderPseudonymSnapshot: 'S' },
      { letterId: 'letter-2', postcardVersionId: 'pv-essaouira-1', revealLine: null, backMessage: 'Hi', senderPseudonymSnapshot: 'S' }
    )
    const { data } = await listPostcards(client(fake))
    expect(data.find((d) => d.key === 'essaouira')?.timesSent).toBe(2)
    expect(data.find((d) => d.key === 'bangkokAfterRain')?.timesSent).toBe(0)
  })
})

describe('admin_add_postcard — creates a brand new catalog key AND its Version 1', () => {
  it('freezes the story on each version while showing the current story in admin', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    await addPostcard(client(fake), 'kyoto', 'JP', { ...VALID_INPUT, storyText: 'The first telling.' })
    await createPostcardVersion(client(fake), 'kyoto', { ...VALID_INPUT, storyText: 'The revised telling.' })
    const versions = fake._versions.filter((v) => v.postcardKey === 'kyoto')
    expect(versions.map((v) => v.storyText)).toEqual(['The first telling.', 'The revised telling.'])
    expect((await listPostcards(client(fake))).data.find((p) => p.key === 'kyoto')?.storyText).toBe('The revised telling.')
  })

  it('stages an imported card inactive, while ordinary manual additions stay active', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    await addPostcard(client(fake), 'story_01', 'MA', VALID_INPUT, true)
    await addPostcard(client(fake), 'manual_01', 'MA', VALID_INPUT)
    expect(fake._catalog.find((c) => c.key === 'story_01')?.isActive).toBe(false)
    expect(fake._catalog.find((c) => c.key === 'manual_01')?.isActive).toBe(true)
  })

  it('rejects an unauthenticated caller', async () => {
    const fake = seeded(null)
    const { error } = await addPostcard(client(fake), 'kyoto', 'JP', VALID_INPUT)
    expect(error?.message).toBe('Authentication required.')
  })

  it('rejects a non-admin caller', async () => {
    const fake = seeded(MEMBER)
    const { error } = await addPostcard(client(fake), 'kyoto', 'JP', VALID_INPUT)
    expect(error?.message).toBe('Not authorized.')
  })

  it('rejects a duplicate key', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await addPostcard(client(fake), 'essaouira', 'MA', VALID_INPUT)
    expect(error?.message).toBe('A postcard with this key already exists.')
  })

  it('rejects a key with invalid characters', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await addPostcard(client(fake), 'Kyoto!', 'JP', VALID_INPUT)
    expect(error?.message).toMatch(/lowercase letters, numbers, and underscores/)
  })

  it('rejects a missing required field', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await addPostcard(client(fake), 'kyoto', 'JP', { ...VALID_INPUT, title: '' })
    expect(error?.message).toBe('A title is required.')
  })

  it('creates the catalog key and its current Version 1 for a valid admin submission', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { data, error } = await addPostcard(client(fake), 'kyoto', 'JP', {
      ...VALID_INPUT,
      title: 'Kyoto',
      location: 'Kyoto, Japan',
    })
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(fake._catalog.some((c) => c.key === 'kyoto' && c.isActive)).toBe(true)
    const version = fake._versions.find((v) => v.postcardKey === 'kyoto')
    expect(version?.versionNumber).toBe(1)
    expect(version?.isCurrent).toBe(true)
  })

  it('audit-logs the creation', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    await addPostcard(client(fake), 'kyoto', 'JP', VALID_INPUT)
    expect(fake._auditLog.some((a) => a.action === 'postcard_created')).toBe(true)
  })
})

describe('admin_create_postcard_version — the shared primitive behind Edit Metadata and Replace Artwork', () => {
  it('rejects a non-admin caller', async () => {
    const fake = seeded(MEMBER)
    const { error } = await createPostcardVersion(client(fake), 'essaouira', VALID_INPUT)
    expect(error?.message).toBe('Not authorized.')
  })

  it('rejects an unknown key', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await createPostcardVersion(client(fake), 'not-a-real-key', VALID_INPUT)
    expect(error?.message).toBe('Postcard not found.')
  })

  it('creates a NEW version (never mutating the existing one) and marks it current', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { data, error } = await createPostcardVersion(client(fake), 'essaouira', {
      ...VALID_INPUT,
      title: 'Essaouira (updated)',
    })
    expect(error).toBeNull()
    const versionsForKey = fake._versions.filter((v) => v.postcardKey === 'essaouira')
    expect(versionsForKey).toHaveLength(2)
    const v1 = versionsForKey.find((v) => v.versionNumber === 1)!
    const v2 = versionsForKey.find((v) => v.versionNumber === 2)!
    expect(v1.title).toBe('Essaouira')
    expect(v1.isCurrent).toBe(false)
    expect(v2.title).toBe('Essaouira (updated)')
    expect(v2.isCurrent).toBe(true)
    expect(v2.id).toBe(data)
  })

  it('a letter that already sent Version 1 keeps resolving Version 1 forever, even after Version 2 becomes current', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    fake._letterPostcards.push({
      letterId: 'letter-old',
      postcardVersionId: 'pv-essaouira-1',
      revealLine: null,
      backMessage: 'Sent under v1.',
      senderPseudonymSnapshot: 'Sender',
    })
    await createPostcardVersion(client(fake), 'essaouira', { ...VALID_INPUT, title: 'Essaouira (updated)' })

    const oldLetterVersionId = fake._letterPostcards.find((lp) => lp.letterId === 'letter-old')!.postcardVersionId
    expect(oldLetterVersionId).toBe('pv-essaouira-1')
    const frozenVersion = fake._versions.find((v) => v.id === oldLetterVersionId)!
    expect(frozenVersion.title).toBe('Essaouira')
    expect(frozenVersion.isCurrent).toBe(false)
  })
})

describe('admin_set_postcard_active — stops NEW sends only, never affects historical letters', () => {
  it('rejects a non-admin caller', async () => {
    const fake = seeded(MEMBER)
    const { error } = await setPostcardActive(client(fake), 'essaouira', false)
    expect(error?.message).toBe('Not authorized.')
  })

  it('rejects an already-active Postcard being activated again', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await setPostcardActive(client(fake), 'essaouira', true)
    expect(error?.message).toBe('This Postcard is already active.')
  })

  it('deactivates a Postcard, and it stays visible in admin_list_postcards (never hidden), just inactive', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await setPostcardActive(client(fake), 'essaouira', false)
    expect(error).toBeNull()
    const { data } = await listPostcards(client(fake))
    expect(data.find((d) => d.key === 'essaouira')?.isActive).toBe(false)
  })
})

// Independent SQL review correction pass (2026-09-22) — regression
// coverage against the REAL, live, mixed-case key `bangkokAfterRain`
// specifically (not a lowercase synthetic fixture), proving Admin can
// still fully operate on it after the lower()-stripping fix to
// admin_create_postcard_version/admin_set_postcard_active.
describe('mixed-case key regression — the real live bangkokAfterRain key', () => {
  it('A. admin_list_postcards lists it under its exact original casing', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { data, error } = await listPostcards(client(fake))
    expect(error).toBeNull()
    expect(data.some((d) => d.key === 'bangkokAfterRain')).toBe(true)
    expect(data.some((d) => d.key === 'bangkokafterrain')).toBe(false)
  })

  it('B. admin_create_postcard_version creates Version 2 for it', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { data, error } = await createPostcardVersion(client(fake), 'bangkokAfterRain', {
      title: 'Bangkok After Rain',
      location: 'Thailand after rain',
      collection: 'Thailand After Rain Collection',
      postmarkText: 'BANGKOK\nTHAILAND',
      footerText: 'Tempa Postcard · Thailand After Rain Collection',
      frontImagePath: '/postcards/bangkok-after-rain.jpg',
    })
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    const versionsForKey = fake._versions.filter((v) => v.postcardKey === 'bangkokAfterRain')
    expect(versionsForKey).toHaveLength(2)
  })

  it('C. the new version preserves the exact postcard_key — never bangkokafterrain', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { data } = await createPostcardVersion(client(fake), 'bangkokAfterRain', {
      title: 'Bangkok After Rain',
      location: 'Thailand after rain',
      collection: 'Thailand After Rain Collection',
      postmarkText: 'BANGKOK\nTHAILAND',
      footerText: 'Tempa Postcard · Thailand After Rain Collection',
      frontImagePath: '/postcards/bangkok-after-rain.jpg',
    })
    const newVersion = fake._versions.find((v) => v.id === data)!
    expect(newVersion.postcardKey).toBe('bangkokAfterRain')
    expect(fake._versions.some((v) => v.postcardKey === 'bangkokafterrain')).toBe(false)
  })

  it('D. admin_set_postcard_active can deactivate it', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await setPostcardActive(client(fake), 'bangkokAfterRain', false)
    expect(error).toBeNull()
    expect(fake._catalog.find((c) => c.key === 'bangkokAfterRain')?.isActive).toBe(false)
  })

  it('E. admin_set_postcard_active can then reactivate it', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    await setPostcardActive(client(fake), 'bangkokAfterRain', false)
    const { error } = await setPostcardActive(client(fake), 'bangkokAfterRain', true)
    expect(error).toBeNull()
    expect(fake._catalog.find((c) => c.key === 'bangkokAfterRain')?.isActive).toBe(true)
  })

  it('F. never accidentally creates or looks up "bangkokafterrain" — a lookup by the lowercase form fails as not found, proving no silent normalization happens for an existing key', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await createPostcardVersion(client(fake), 'bangkokafterrain', {
      title: 'Should not resolve',
      location: 'x',
      collection: 'x',
      postmarkText: 'x',
      footerText: 'x',
      frontImagePath: 'x',
    })
    expect(error?.message).toBe('Postcard not found.')
    expect(fake._catalog.some((c) => c.key === 'bangkokafterrain')).toBe(false)
  })

  it('catalog title stays in sync with the current version after a title-changing new version, while the original version keeps its own frozen title', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    await createPostcardVersion(client(fake), 'bangkokAfterRain', {
      title: 'Bangkok After Rain',
      location: 'Thailand after rain',
      collection: 'Thailand After Rain Collection',
      postmarkText: 'BANGKOK\nTHAILAND',
      footerText: 'Tempa Postcard · Thailand After Rain Collection',
      frontImagePath: '/postcards/bangkok-after-rain.jpg',
    })
    expect(fake._catalog.find((c) => c.key === 'bangkokAfterRain')?.title).toBe('Bangkok After Rain')
    const v1 = fake._versions.find((v) => v.postcardKey === 'bangkokAfterRain' && v.versionNumber === 1)!
    expect(v1.title).toBe('Bangkok')
  })
})

// Release Polish Pass — fixes the "2 sents" copy bug with natural,
// singular-correct wording.
describe('formatPostcardSentCount', () => {
  it('0 → "Not sent yet"', () => {
    expect(formatPostcardSentCount(0)).toBe('Not sent yet')
  })

  it('1 → "Sent once" — never "1 sent" or "1 sents"', () => {
    expect(formatPostcardSentCount(1)).toBe('Sent once')
  })

  it('2 → "Sent 2 times" — never "2 sents"', () => {
    expect(formatPostcardSentCount(2)).toBe('Sent 2 times')
  })

  it('a large count still reads naturally', () => {
    expect(formatPostcardSentCount(47)).toBe('Sent 47 times')
  })
})

describe('filterAdminPostcards — Admin Postcards catalogue search', () => {
  const ESSAOUIRA: AdminPostcard = {
    key: 'essaouira',
    isActive: true,
    createdAt: '2026-09-14T00:00:00Z',
    currentVersionId: 'pv-essaouira-1',
    versionNumber: 1,
    title: 'Essaouira',
    countryCode: 'MA',
    location: 'Atlantic Morocco',
    collection: 'Atlantic Morocco Collection',
    postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
    footerText: 'Tempa Postcard · Atlantic Morocco Collection',
    frontImagePath: '/postcards/essaouira.jpg',
    motionSrc: null,
    durationSeconds: null,
    revealLineAlignment: null,
    timesSent: 2,
  }
  const BANGKOK: AdminPostcard = {
    key: 'bangkokAfterRain',
    isActive: true,
    createdAt: '2026-09-14T00:00:00Z',
    currentVersionId: 'pv-bangkok-1',
    versionNumber: 1,
    title: 'Bangkok',
    countryCode: 'TH',
    location: 'Thailand after rain',
    collection: 'Thailand After Rain Collection',
    postmarkText: 'BANGKOK\nTHAILAND',
    footerText: 'Tempa Postcard · Thailand After Rain Collection',
    frontImagePath: '/postcards/bangkok-after-rain.jpg',
    motionSrc: null,
    durationSeconds: null,
    revealLineAlignment: null,
    timesSent: 2,
  }
  const CATALOG = [ESSAOUIRA, BANGKOK]

  it('an empty query returns every Postcard unfiltered', () => {
    expect(filterAdminPostcards(CATALOG, '')).toEqual(CATALOG)
    expect(filterAdminPostcards(CATALOG, '   ')).toEqual(CATALOG)
  })

  it('matches by country code, case-insensitively', () => {
    expect(filterAdminPostcards(CATALOG, 'TH').map((p) => p.key)).toEqual(['bangkokAfterRain'])
    expect(filterAdminPostcards(CATALOG, 'th').map((p) => p.key)).toEqual(['bangkokAfterRain'])
  })

  it('matches by location text containing a country name', () => {
    expect(filterAdminPostcards(CATALOG, 'Thailand').map((p) => p.key)).toEqual(['bangkokAfterRain'])
    expect(filterAdminPostcards(CATALOG, 'Morocco').map((p) => p.key)).toEqual(['essaouira'])
  })

  it('matches by title', () => {
    expect(filterAdminPostcards(CATALOG, 'Bangkok').map((p) => p.key)).toEqual(['bangkokAfterRain'])
  })

  it('matches by the exact internal key, including its mixed case', () => {
    expect(filterAdminPostcards(CATALOG, 'bangkokAfterRain').map((p) => p.key)).toEqual(['bangkokAfterRain'])
  })

  it('a query matching nothing returns an empty list', () => {
    expect(filterAdminPostcards(CATALOG, 'Kyoto')).toEqual([])
  })
})
