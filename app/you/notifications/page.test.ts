import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const youPageSource = readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')

describe('/you/notifications — arrival-email preference', () => {
  it('redirects a signed-out visitor to sign-in', () => {
    expect(source).toContain("redirect('/sign-in')")
  })

  it('reads the current preference via getArrivalEmailPreference, self-scoped to the signed-in user', () => {
    expect(source).toContain('getArrivalEmailPreference(supabase, user.id)')
  })

  it('renders the editor with the server-read initial value', () => {
    expect(source).toContain('<NotificationsEditor initialEnabled={enabled} />')
  })

  it('links back to /you', () => {
    expect(source).toContain('href="/you"')
  })
})

describe('/you — links to the new Notifications route', () => {
  it('links to /you/notifications, labeled "Notifications"', () => {
    expect(youPageSource).toContain('href="/you/notifications"')
    expect(youPageSource).toContain('Notifications')
  })
})
