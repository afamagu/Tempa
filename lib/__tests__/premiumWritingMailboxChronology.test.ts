import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const migration = readFileSync(
  path.join(root, 'docs/sql/2026-10-06-premium-writing-mailbox-chronology.sql'),
  'utf8'
)
const letters = readFileSync(path.join(root, 'lib/letters.ts'), 'utf8')

describe('premium writing/reading — mailbox arrival chronology', () => {
  it('keeps future incoming mail invisible while deriving viewer-specific mailbox time', () => {
    expect(migration).toContain('and l.deliver_at <= now()')
    expect(migration).toContain('when l.sender_id = auth.uid() then l.created_at')
    expect(migration).toContain('else l.deliver_at')
  })

  it('never exposes raw opened_at or a future delivery timestamp as a client column', () => {
    expect(migration).not.toMatch(/\bas opened_at\b/)
    expect(migration).not.toMatch(/\bl\.deliver_at\s*,/)
    expect(migration).toContain('end as mailbox_at')
  })

  it('orders member mailbox surfaces by mailbox_at instead of creation time', () => {
    expect(letters).toContain(".order('mailbox_at', { ascending: false })")
    expect(letters).toContain("'created_at, mailbox_at, sender_id")
  })
})
