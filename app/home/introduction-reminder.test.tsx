// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { expect, it } from 'vitest'
import en from '@/messages/en.json'
import IntroductionReminder from './introduction-reminder'

it('links to the exact introduction and dismisses quietly for a day', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC"><IntroductionReminder userId="viewer" questionId="intro" /></NextIntlClientProvider>))
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/question/intro')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => host.querySelector('button')!.click())
    expect(host.textContent).toBe('')
    expect(document.cookie).toContain('tempa-introduction-viewer=')
  } finally { await act(async () => root.unmount()); host.remove(); document.cookie = 'tempa-introduction-viewer=; Path=/; Max-Age=0' }
})
