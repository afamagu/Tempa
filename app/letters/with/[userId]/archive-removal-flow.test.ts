import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const listSource = readFileSync(path.join(__dirname, 'archive-list.tsx'), 'utf8')
const actionsSource = readFileSync(path.join(__dirname, 'archive-actions.tsx'), 'utf8')

describe('Letterbox removal flow', () => {
  it('keeps one familiar trash action beside Print', () => {
    expect(actionsSource).toContain('function TrashIcon()')
    expect(actionsSource).toContain('aria-label="Remove selected letters"')
    expect(actionsSource).toContain('Order a printed copy')
    expect(actionsSource).not.toContain('Remove selected</button>')
  })

  it('confirms removal inside the archive rather than in the person header or a page overlay', () => {
    expect(listSource).toContain('Remove this letter from your Letterbox?')
    expect(listSource).toContain('Nothing is deleted for {otherPseudonym}.')
    expect(listSource).toContain('>Keep<')
    expect(listSource).not.toContain('fixed inset-0')
    expect(listSource).not.toContain('window.location.reload')
  })
})
