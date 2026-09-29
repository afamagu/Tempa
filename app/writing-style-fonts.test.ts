import { describe, expect, it } from 'vitest'

// primaryFontFamily is pure; importing the module would invoke next/font,
// so the helper is re-derived from source text and executed here.
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'writing-style-fonts.ts'), 'utf8')

describe('primaryFontFamily', () => {
  it('keeps only the face itself, dropping next/font’s fallback face', () => {
    const body = source.match(/export function primaryFontFamily\(fontFamily: string\): string \{([\s\S]*?)\n\}/)![1]
    const primaryFontFamily = new Function('fontFamily', body) as (f: string) => string
    expect(primaryFontFamily("'Courier Prime', 'Courier Prime Fallback'")).toBe("'Courier Prime'")
    expect(primaryFontFamily("'__Courier_Prime_1a2b3c', '__Courier_Prime_Fallback_1a2b3c'")).toBe("'__Courier_Prime_1a2b3c'")
  })
})
