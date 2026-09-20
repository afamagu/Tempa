import { describe, expect, it } from 'vitest'
import {
  inspectPostcardImportSelection,
  POSTCARD_IMPORT_IGNORED_FILES,
  POSTCARD_IMPORT_MANIFEST,
  validatePostcardImportManifest,
} from './postcard-import-manifest'

describe('Tempa Places import manifest', () => {
  it('contains 36 unique designs: 35 animated and one still-only', () => {
    const result = validatePostcardImportManifest(POSTCARD_IMPORT_MANIFEST)
    expect(result.errors).toEqual([])
    expect(POSTCARD_IMPORT_MANIFEST).toHaveLength(36)
    expect(result.images.size).toBe(36)
    expect(result.motions.size).toBe(35)
    expect(POSTCARD_IMPORT_MANIFEST.filter((entry) => entry.motionFilename === null).map((entry) => entry.key)).toEqual(
      ['lahore_walled_city'],
    )
  })

  it('preserves both Bangkok and both Yogyakarta designs as siblings', () => {
    expect(POSTCARD_IMPORT_MANIFEST.filter((entry) => entry.title === 'Bangkok')).toHaveLength(1)
    expect(POSTCARD_IMPORT_MANIFEST.filter((entry) => entry.title === 'Yogyakarta')).toHaveLength(2)
  })

  it('locks the visually reviewed non-obvious motion pairings', () => {
    const byKey = new Map(POSTCARD_IMPORT_MANIFEST.map((entry) => [entry.key, entry]))
    expect(byKey.get('yogyakarta_old_quarter')?.motionFilename).toBe('Yogyakarta 2.mp4')
    expect(byKey.get('yogyakarta_borobudur_sunrise')?.motionFilename).toBe('Yogyakarta 1.mp4')
    expect(byKey.get('lahore_badshahi_gardens')?.motionFilename).toBe('Lahoe 1.mp4')
  })

  it('records the byte-identical Dhaka duplicate as intentionally ignored', () => {
    expect(POSTCARD_IMPORT_IGNORED_FILES).toEqual(['Dhaka 2 Buriganga, Bangladesh.png'])
  })

  it('preflights a resumable folder selection without uploading', () => {
    const files = POSTCARD_IMPORT_MANIFEST.flatMap((entry) =>
      [entry.imageFilename, entry.motionFilename].filter((name): name is string => Boolean(name)),
    )
    files.push(POSTCARD_IMPORT_IGNORED_FILES[0], 'notes.txt')
    const result = inspectPostcardImportSelection(files, new Set(['bangkok_2']))
    expect(result.ready).toHaveLength(35)
    expect(result.skipped.map((entry) => entry.key)).toEqual(['bangkok_2'])
    expect(result.missing).toEqual([])
    expect(result.ignored).toEqual(['Dhaka 2 Buriganga, Bangladesh.png'])
    expect(result.unrecognized).toEqual(['notes.txt'])
  })

  it('does not require files for designs that are already installed', () => {
    const result = inspectPostcardImportSelection([], new Set(['amsterdam_canal_ring']))
    expect(result.missing).not.toContain('AmsterdamCanal Ring, Netherlands.png')
    expect(result.missing).toContain('Bangkok Thailand image 2.png')
  })

  it('matches the live Admin RPC key contract exactly', () => {
    expect(POSTCARD_IMPORT_MANIFEST.every((entry) => /^[a-z][a-z0-9_]*$/.test(entry.key))).toBe(true)
    expect(validatePostcardImportManifest([{ ...POSTCARD_IMPORT_MANIFEST[0], key: 'invalid-key' }]).errors).toEqual([
      'Invalid key: invalid-key',
    ])
  })
})
