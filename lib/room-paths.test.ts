import { describe, expect, it } from 'vitest'
import {
  ROOM_HOME, ROOM_WRITE, roomLetterPath, roomLetterEditPath,
  roomLetterContactPath, historicBoardLetterPath,
} from './room-paths'

const letterId = '11111111-2222-4333-8444-555555555555'
const authorId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

describe('The Room route contract', () => {
  it('keeps the four-navigation Room root and a separate public composer', () => {
    expect(ROOM_HOME).toBe('/room')
    expect(ROOM_WRITE).toBe('/room/write')
    expect(roomLetterPath(letterId)).toBe(`/room/letters/${letterId}`)
    expect(roomLetterEditPath(letterId)).toBe(`/room/letters/${letterId}/edit`)
  })

  it('preserves precise public-letter context when starting private correspondence', () => {
    const url = new URL(roomLetterContactPath(authorId, letterId), 'https://jointempa.com')
    expect(url.pathname).toBe(`/write/${authorId}`)
    expect(url.searchParams.get('source')).toBe('room_letter')
    expect(url.searchParams.get('d')).toBe(letterId)
    expect(url.searchParams.get('returnTo')).toBe(roomLetterPath(letterId))
    expect(url.searchParams.has('a')).toBe(false)
  })

  it('refuses unsafe identifiers instead of embedding them in destination URLs', () => {
    expect(() => roomLetterPath('../../admin')).toThrow('Invalid public-letter identifier')
    expect(() => roomLetterEditPath('')).toThrow()
    expect(() => roomLetterContactPath('bad', letterId)).toThrow('Invalid recipient identifier')
  })

  it('conservatively maps historic Board readers and drops arbitrary injected navigation params', () => {
    expect(historicBoardLetterPath(letterId)).toBe(roomLetterPath(letterId))
    const query = new URLSearchParams('seed=hello&s=2026-10-10&returnTo=https%3A%2F%2Fevil.example&from=finite_board')
    const url = new URL(historicBoardLetterPath(letterId, query), 'https://jointempa.com')
    expect(url.pathname).toBe(roomLetterPath(letterId))
    expect(url.searchParams.get('seed')).toBe('hello')
    expect(url.searchParams.get('from')).toBe('finite_board')
    expect(url.searchParams.has('returnTo')).toBe(false)
  })
})
