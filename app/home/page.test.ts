import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
const source=readFileSync(new URL('./page.tsx',import.meta.url),'utf8')
describe('Home — correspondence first, then genuine Room letters',()=>{
  it('preserves real unread arrival and relationship flows',()=>{
    expect(source).toContain('deriveArrivals(allLetters, user.id)')
    expect(source).toContain('<MailOnTheWay />')
    expect(source).toContain('/letters/with/${person.userId}')
    expect(source).toContain('getRelationshipSurfacePeople(supabase, user.id)')
  })
  it('does not promote weekly public Questions or the retired Board',()=>{
    expect(source).not.toContain('<RoomQuestionCredit')
    expect(source).not.toContain('getHomeQuestionAnswers')
    expect(source).not.toContain('currentRoomQuestion.prompt')
    expect(source).not.toContain('From the Board')
    expect(source).not.toContain('The Room and Board')
    expect(source).toContain('From the Room')
  })
  it('keeps at most three author-diverse member public letters',()=>{
    expect(source).toContain('HOME_BOARD_COUNT = 3')
    expect(source).toContain("item?.publishedAs === 'member'")
    expect(source).toContain('seenBoardIds.has(item.id)')
    expect(source).toContain('seenBoardAuthors.has(item.authorId)')
    expect(source).toContain('homeBoardItems.length >= HOME_BOARD_COUNT')
  })
  it('preserves optional onboarding reminder and normal Home notices',()=>{
    expect(source).toContain('<IntroductionReminder')
    expect(source).toContain('<MemberNotices />')
    expect(source).toContain('<PublicMentions />')
    expect(source).toContain('<HomeFamiliarFaces />')
    expect(source).toContain('<AnnouncementTeaser')
  })
  it('places From the Room beneath real correspondence and before the announcement',()=>{
    const correspondence=source.indexOf('Your correspondence')
    const room=source.indexOf('id="home-board-heading"')
    const announcement=source.indexOf('<AnnouncementTeaser')
    expect(correspondence).toBeGreaterThan(-1)
    expect(room).toBeGreaterThan(correspondence)
    expect(announcement).toBeGreaterThan(room)
    expect(source).toContain('href="/room"')
  })
})
