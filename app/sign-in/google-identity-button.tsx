'use client'

import { useEffect, useRef } from 'react'
import { GOOGLE_GSI_SCRIPT_SRC, createGoogleNonce } from '@/lib/google-identity'

/**
 * The ONE place Google Identity Services is loaded and its button
 * rendered (imported only by app/sign-in/page.tsx). Google issues an ID
 * token only to its own rendered button (or One Tap), so the button's
 * look is Google's; Tempa chooses theme/shape/text/width. Each attempt
 * gets a fresh nonce: after a credential is delivered the widget is
 * re-initialized, so a retry never reuses one.
 */

type GsiCredentialResponse = { credential?: string }

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: GsiCredentialResponse) => void
            nonce: string
            context?: 'signin' | 'signup'
            ux_mode?: 'popup'
            auto_select?: boolean
            itp_support?: boolean
            use_fedcm_for_button?: boolean
          }) => void
          renderButton: (
            parent: HTMLElement,
            options: {
              type: 'standard'
              theme: 'outline' | 'filled_blue' | 'filled_black'
              size: 'large'
              text: 'continue_with' | 'signup_with'
              shape: 'rectangular' | 'pill'
              logo_alignment: 'left' | 'center'
              width: number
            }
          ) => void
          cancel: () => void
        }
      }
    }
  }
}

let gsiScriptPromise: Promise<void> | null = null

function loadGsiScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.google?.accounts?.id) return Promise.resolve()
  if (!gsiScriptPromise) {
    gsiScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = GOOGLE_GSI_SCRIPT_SRC
      // GIS copies its own script's nonce onto the <style> it injects, so
      // that stylesheet satisfies the page CSP (proxy.ts) instead of
      // needing 'unsafe-inline'. The page nonce is read from a script
      // Next.js already nonced.
      const pageNonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce
      if (pageNonce) script.nonce = pageNonce
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => {
        gsiScriptPromise = null
        reject(new Error('Failed to load Google Identity Services'))
      }
      document.head.appendChild(script)
    })
  }
  return gsiScriptPromise
}

export default function GoogleIdentityButton({
  clientId,
  joinIntent,
  onCredential,
  onUnavailable,
}: {
  clientId: string
  joinIntent: boolean
  /** Receives the Google ID token and the RAW nonce it is bound to. */
  onCredential: (credential: string, rawNonce: string) => void
  /** GIS could not load (blocked, offline) — the page falls back. */
  onUnavailable: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onCredentialRef = useRef(onCredential)
  const onUnavailableRef = useRef(onUnavailable)
  useEffect(() => {
    onCredentialRef.current = onCredential
    onUnavailableRef.current = onUnavailable
  })

  useEffect(() => {
    let cancelled = false

    async function setup() {
      const nonce = await createGoogleNonce()
      if (cancelled || !containerRef.current || !window.google?.accounts?.id) return
      const gsi = window.google.accounts.id
      gsi.initialize({
        client_id: clientId,
        nonce: nonce.hashed,
        context: joinIntent ? 'signup' : 'signin',
        ux_mode: 'popup',
        auto_select: false,
        itp_support: true,
        use_fedcm_for_button: true,
        callback: (response) => {
          if (cancelled) return
          if (response.credential) onCredentialRef.current(response.credential, nonce.raw)
          // Fresh nonce for any further attempt.
          void setup()
        },
      })
      containerRef.current.replaceChildren()
      gsi.renderButton(containerRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: joinIntent ? 'signup_with' : 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'center',
        width: Math.min(400, Math.max(200, containerRef.current.offsetWidth || 320)),
      })
    }

    loadGsiScript()
      .then(setup)
      .catch(() => {
        if (!cancelled) onUnavailableRef.current()
      })

    return () => {
      cancelled = true
      window.google?.accounts?.id?.cancel()
    }
  }, [clientId, joinIntent])

  return <div ref={containerRef} className="flex min-h-[44px] w-full justify-center" data-testid="google-identity-button" />
}
