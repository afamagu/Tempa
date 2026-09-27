'use client'

import { useEffect, useRef } from 'react'
import { GOOGLE_GSI_SCRIPT_SRC, createGoogleNonce, type GoogleNonce } from '@/lib/google-identity'

/**
 * The ONE place Google Identity Services is loaded and its button
 * rendered (imported only by app/sign-in/page.tsx). Google issues an ID
 * token only to its own rendered button (or One Tap), so the button's
 * look is Google's; Tempa chooses theme/shape/text/width.
 *
 * `google.accounts.id.initialize()` runs ONCE per page load (Google's
 * guidance), with ONE nonce generated for that page. The page submits at
 * most one credential per page load (app/sign-in/page.tsx); a retry
 * reloads the page, which yields a fresh initialize and a fresh nonce —
 * so a nonce is never reused across submitted attempts.
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

// Page-lifetime GIS state: one initialize, one nonce. The callback is
// fixed at initialize time, so it forwards to whichever mounted button
// currently owns the handler.
let initialized: { clientId: string; nonce: GoogleNonce } | null = null
let initializing: Promise<GoogleNonce> | null = null
let deliverCredential: ((credential: string, rawNonce: string) => void) | null = null

async function initializeOnce(clientId: string, joinIntent: boolean): Promise<GoogleNonce> {
  if (initialized && initialized.clientId === clientId) return initialized.nonce
  if (!initializing) {
    initializing = (async () => {
      const nonce = await createGoogleNonce()
      window.google!.accounts.id.initialize({
        client_id: clientId,
        nonce: nonce.hashed,
        context: joinIntent ? 'signup' : 'signin',
        ux_mode: 'popup',
        auto_select: false,
        itp_support: true,
        use_fedcm_for_button: true,
        callback: (response) => {
          if (response.credential) deliverCredential?.(response.credential, nonce.raw)
        },
      })
      initialized = { clientId, nonce }
      return nonce
    })().finally(() => {
      initializing = null
    })
  }
  return initializing
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
  /** GIS could not load (blocked, offline). */
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
    const handler = (credential: string, rawNonce: string) => onCredentialRef.current(credential, rawNonce)
    deliverCredential = handler

    loadGsiScript()
      .then(() => initializeOnce(clientId, joinIntent))
      .then(() => {
        if (cancelled || !containerRef.current || !window.google?.accounts?.id) return
        containerRef.current.replaceChildren()
        // Rendering a button again (e.g. after a re-mount) is fine; only
        // initialize is once per page.
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: joinIntent ? 'signup_with' : 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          width: Math.min(400, Math.max(200, containerRef.current.offsetWidth || 320)),
        })
      })
      .catch(() => {
        if (!cancelled) onUnavailableRef.current()
      })

    return () => {
      cancelled = true
      if (deliverCredential === handler) deliverCredential = null
    }
  }, [clientId, joinIntent])

  return <div ref={containerRef} className="flex min-h-[44px] w-full justify-center" data-testid="google-identity-button" />
}
