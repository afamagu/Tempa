import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('public profile Mark identity', () => {
  it('reads the public opaque mark_id and resolves its flat PNG object name', () => {
    expect(source).toContain(".select('id, pseudonym, country, gender, gender_custom, age_range, mark_id')")
    expect(source).toContain("publicProfileMarkUrl(supabase, `${profile.mark_id}.png`)")
  })

  it('renders the profile Mark when present and preserves Mindform for grandfathered profiles', () => {
    expect(source).toContain('<ProfileIdentityMark')
    expect(source).toContain("label={markUrl ? `${profile.pseudonym}'s Mark` : undefined}")
    expect(source).toContain('identifier={profile.id}')
  })
})
