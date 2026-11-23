// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { GOOGLE_GSI_SCRIPT_SRC } from '@/lib/google-identity'
import SignInPage from './page'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/app/locale-actions', () => ({ setInterfaceLanguage: vi.fn() }))
vi.mock('./google-destination-action', () => ({ googleSignInDestination: vi.fn() }))

it('loads Google Identity Services only after the visitor chooses Google sign-in', async () => {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'test.apps.googleusercontent.com')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const findScript = () => document.querySelector(`script[src="${GOOGLE_GSI_SCRIPT_SRC}"]`)

  try {
    await act(async () => root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SignInPage />
      </NextIntlClientProvider>,
    ))
    expect(findScript()).toBeNull()
    expect(host.querySelector('input[type="email"]')).not.toBeNull()

    const googleButton = [...host.querySelectorAll('button')]
      .find((button) => button.textContent === en.SignIn.continueWithGoogle)
    expect(googleButton).toBeDefined()
    await act(async () => googleButton?.click())

    expect(findScript()).not.toBeNull()
    expect(host.querySelector('input[type="email"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    findScript()?.remove()
    host.remove()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  }
})
