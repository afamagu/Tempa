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

  it('renders the editor with the server-read value only on a successful read', () => {
    expect(source).toContain('preferenceResult.ok')
    expect(source).toContain('<NotificationsEditor initialEnabled={preferenceResult.enabled} />')
  })

  it('renders a recoverable error instead of the editor when the read fails — never a guessed on/off state', () => {
    expect(source).toContain('Could not load your letter-arrival setting right now')
    expect(source).toContain('href="/you/notifications"')
    expect(source).not.toMatch(/preferenceResult\.ok\s*\?\s*<NotificationsEditor[\s\S]*:\s*<NotificationsEditor/)
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


describe('/you/notifications — reply-reminder email operational truth', () => {
  const preferenceSource = readFileSync(path.join(__dirname, 'reply-reminder-preference.tsx'), 'utf8')

  it('reads the service-only reply-reminder email kill switch on the server', () => {
    expect(source).toContain("createServiceClient()")
    expect(source).toContain("from('reply_reminder_system_config')")
    expect(source).toContain("select('sending_enabled')")
    expect(source).toContain('emailSendingEnabled={replyReminderEmailSendingEnabled}')
  })

  it('does not present reply-reminder email delivery as live while operations has it disabled', () => {
    expect(preferenceSource).toContain('emailSendingEnabled')
    expect(preferenceSource).toContain('disabled={!remindersEnabled || !emailSendingEnabled}')
    expect(preferenceSource).toContain('Reply-reminder email delivery is not currently active.')
    expect(preferenceSource).toContain('Your saved preference will be kept')
  })
})
