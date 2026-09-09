import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Dispatch external-sharing checkpoint (2026-09-08), item 17: a source-
// level regression guard, not just a rendering test — proves no file
// anywhere under the private-correspondence surface (composing or
// reading a letter) ever references the Dispatch sharing contract.
// letter-body.test.tsx's "no external sharing affordance" test already
// covers rendered output for one component; this covers every source
// file in both directories, so a future addition anywhere in either
// tree is caught even before it would render anything.

const FORBIDDEN_TOKENS = ['dispatch_shares', 'get_shared_dispatch', 'share_dispatch', 'revoke_dispatch_share', 'navigator.share']

const PRIVATE_LETTER_ROOTS = [join(__dirname, '..', '..', 'app', 'letters'), join(__dirname, '..', '..', 'app', 'write')]

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath)
    }
  }
  return files
}

describe('Private correspondence — no Dispatch-sharing references anywhere', () => {
  it('no file under app/letters or app/write references any Dispatch-sharing RPC or the Web Share API', () => {
    const files = PRIVATE_LETTER_ROOTS.flatMap(collectSourceFiles)
    expect(files.length).toBeGreaterThan(0)

    const offenders: { file: string; token: string }[] = []
    for (const file of files) {
      const contents = readFileSync(file, 'utf8')
      for (const token of FORBIDDEN_TOKENS) {
        if (contents.includes(token)) offenders.push({ file, token })
      }
    }

    expect(offenders).toEqual([])
  })
})
