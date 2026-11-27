import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
const legacy = read('app/minds/page.tsx')
const page = read('app/board/people/page.tsx')
describe('People directory and legacy discovery compatibility', () => {
  it('retains the old discovery URL without duplicating the directory', () => {
    expect(legacy).toContain("redirect('/room')")
    expect(read('next.config.ts')).toContain('source: "/room", destination: "/board"')
  })
  it('protects the directory and preserves the requested destination for sign-in', () => {
    expect(page).toContain("if (!user) redirect('/sign-in?next=%2Fboard%2Fpeople')")
  })
  it('uses the bounded directory query rather than loading all members into the page', () => {
    expect(page).toContain('getRoomDirectoryPage(supabase, filters, seed)')
    expect(page).not.toContain(".from('public_profiles')")
    expect(page).not.toContain(".from('question_answers')")
    expect(page).toContain('initialHasMore={page.hasMore}')
  })
  it('keeps directory filtering and stable pagination in the shared browser', () => {
    expect(page).toContain('parseDirectoryFilters(raw)')
    expect(page).toContain('<DirectoryBrowser')
    expect(page).toContain('seed={seed}')
    expect(page).toContain('restore={raw.restore')
  })
  it('keeps discovery under Board navigation and capacity does not hide browsing', () => {
    expect(page).toContain('<BoardTabs active="people"')
    expect(page).toContain('You can still explore people')
    expect(page).not.toContain('needsParticipationGate')
  })
})
