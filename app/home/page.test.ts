import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The new Home hierarchy replaces the former standalone Recommended Minds
// sections. Data selection and unread semantics are tested in their libraries.
const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('Home — Arrivals, Room conversation, Board, announcement', () => {
  it('keeps correspondence first and the Room available when mail is waiting', () => {
    expect(source.indexOf('pageTitleClass}>Arrivals')).toBeLessThan(source.indexOf('aria-labelledby="home-room-heading"'))
    expect(source).toContain('<MailOnTheWay />')
    expect(source).toContain('deriveArrivals(allLetters, user.id)')
    const roomSection = source.slice(source.indexOf('aria-labelledby="home-room-heading"'), source.indexOf('aria-labelledby="home-board-heading"'))
    expect(roomSection).not.toContain('awaitingReply.length')
  })

  it('places the Board after the Room and the announcement last', () => {
    const room = source.indexOf('aria-labelledby="home-room-heading"')
    const board = source.indexOf('aria-labelledby="home-board-heading"')
    const announcement = source.indexOf('<AnnouncementTeaser')
    expect(room).toBeGreaterThan(-1)
    expect(board).toBeGreaterThan(room)
    expect(announcement).toBeGreaterThan(board)
  })

  it('uses the same live Question for answer cards, CTA and more-answer browsing', () => {
    expect(source).toContain('questionId: currentRoomQuestion.id')
    expect(source).toContain('getQuestionAnswerEncounters(supabase, currentRoomQuestion.id, user.id')
    expect(source).toContain('/question/${currentRoomQuestion.id}?source=home_room')
    expect(source).toContain('/room?question=${currentRoomQuestion.id}')
    expect(source).not.toContain('<RecommendedMindCard')
  })

  it('prefers different Board authors, then fills a small pool without duplicate Dispatches', () => {
    expect(source).toContain('seenBoardAuthors.has(item.authorId)')
    expect(source).toContain('seenBoardIds.has(item.id)')
    expect(source).toContain('homeBoardItems.length < HOME_BOARD_COUNT')
    expect(source).toContain('excludeUserIds: [...seenBoardAuthors]')
  })

  it('bounds Home answers at three and records only the selected candidates', () => {
    expect(source).toContain('const HOME_ROOM_ANSWER_COUNT = 3')
    expect(source).toContain('limit: 24')
    expect(source).toContain('!readIds.has(candidate.answerId)')
    expect(source).toContain('slice(0, HOME_ROOM_ANSWER_COUNT)')
    expect(source).toContain("recordRoomExposureOpportunities(user.id, roomCandidates, 'home_room')")
  })

  it('preserves editorial bylines and original member writing', () => {
    expect(source).toContain('editorialTitleFor(editorialBylines, answer.pseudonym)')
    expect(source).toContain('body: answer.body')
    expect(source).not.toContain('translateFields')
  })

  it('puts new copy through the interface dictionaries', () => {
    expect(source).toContain("getTranslations('RoomEngagement')")
    for (const key of ['thisWeek','readEdit','answerQuestion','peopleSaid','moreAnswers','findWriter']) expect(source).toContain(`t('${key}')`)
  })
})
