import { describe, expect, it } from 'vitest'
import { directoryUrl, parseDirectoryFilters } from './directory-state'

describe('Discover People URL contract', () => {
  it('defaults to writers who left a Board letter', () => {
    expect(parseDirectoryFilters({})).toEqual({})
    expect(directoryUrl(parseDirectoryFilters({}))).toBe('/board/people')
  })

  it('makes profiles without letters an explicit opt-in', () => {
    expect(parseDirectoryFilters({ letters: 'all' }).letters).toBe('all')
    expect(directoryUrl({ country:'Japan',letters:'all' })).toBe('/board/people?country=Japan&letters=all')
    expect(parseDirectoryFilters({ letters: 'on' }).letters).toBeUndefined()
  })

  it('keeps country and language filters in return URLs and discards unknown redirect params', () => {
    const filters = parseDirectoryFilters({ country:'Nigeria', language:'English',returnTo:'https://evil.example' })
    expect(directoryUrl(filters,true)).toBe('/board/people?country=Nigeria&language=English&restore=1')
    expect(directoryUrl(filters)).toBe('/board/people?country=Nigeria&language=English')
  })

  it('preserves established advanced filters without making them default', () => {
    const filters = parseDirectoryFilters({
      age:'35-44',gender:'Woman',intent:'Pen pals',interest:'art', search:'writers',
    })
    expect(directoryUrl(filters)).toContain('age=35-44')
    expect(directoryUrl(filters)).toContain('gender=Woman')
    expect(directoryUrl(filters)).toContain('intent=Pen+pals')
    expect(directoryUrl(filters)).toContain('interest=art')
    expect(directoryUrl(filters)).toContain('search=writers')
  })

  it('clips overlong search values and ignores array/injected fields', () => {
    const filters=parseDirectoryFilters({search:'x'.repeat(150),country:['US','AU'],restore:'1'})
    expect(filters.search).toHaveLength(80)
    expect(filters.country).toBeUndefined()
    expect(directoryUrl(filters)).not.toContain('restore')
  })
})
