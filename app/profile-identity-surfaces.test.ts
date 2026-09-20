import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(__dirname, '..')
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8')

const surfaces = [
  'app/minds/discovery-results.tsx',
  'app/minds/[userId]/profile-mark-viewer.tsx',
  'app/letters/people-grid.tsx',
  'app/letters/search-results-panel.tsx',
  'app/letters/with/[userId]/page.tsx',
  'app/letters/[letterId]/page.tsx',
  'app/home/arrival-sender-link.tsx',
  'app/home/recommended-mind-card.tsx',
  'app/board/dispatch-author-link.tsx',
  'app/board/dispatch-preview.tsx',
  'app/board/dispatch-author-link.tsx',
  'app/admin/members/members-directory.tsx',
  'app/admin/members/[id]/page.tsx',
] as const

describe('canonical member identity surfaces', () => {
  it.each(surfaces)('%s uses the shared Mark/Mindform renderer', (file) => {
    expect(read(file)).toContain('ProfileIdentityMark')
  })

  it('the public profile delegates its identity art to the interactive canonical Mark viewer', () => {
    expect(read('app/minds/[userId]/page.tsx')).toContain('ProfileMarkViewer')
  })

  it('keeps saved Marks in their native composition everywhere through the canonical renderer', () => {
    const renderer = read('app/profile-identity-mark.tsx')
    expect(renderer).toContain('object-contain')
    expect(renderer).not.toContain('object-cover')
    expect(renderer).not.toContain('rounded-full')
    expect(renderer).toContain('<Mindform')
  })

  it('does not replace the anonymous shared-Dispatch identity with a profile Mark', () => {
    const shared = read('app/d/[shareToken]/shared-dispatch-view.tsx')
    expect(shared).not.toContain('ProfileIdentityMark')
    expect(shared).not.toContain('mark_id')
  })
})
