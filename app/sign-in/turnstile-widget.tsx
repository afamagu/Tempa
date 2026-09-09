'use client'

import { useEffect, useImperativeHandle, useRef } from 'react'

/**
 * Pre-beta email auth bot protection (2026-09-15) — the ONE place
 * Cloudflare's Turnstile script/widget is loaded and rendered. Scoped
 * deliberately to this single file, imported only by app/sign-in/page.tsx,
 * so the third-party script never loads on any other page. Managed mode
 * (Cloudflare's own default widget behavior — nearly invisible for a
 * normal human, escalating to a visible challenge only when Cloudflare's
 * own risk signal warrants it) is configured on the Cloudflare Turnstile
 * dashboard side, against the site key itself — nothing here chooses a
 * "mode"; this component just renders whatever the site key was
 * configured as.
 *
 * No device fingerprinting or persistent tracking is added here — this
 * is exactly Cloudflare's own official widget, rendered once per mount,
 * producing a single-use, short-lived token per successful challenge.
 */

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
        }
      ) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
    }
  }
}

// Module-level so the script is fetched at most once even if this
// component mounts more than once during the page's lifetime (e.g. the
// user toggles between "Sign in" and "Create an account" framing, which
// re-renders but doesn't unmount SignInForm here — this guards a future
// caller that might unmount/remount it instead).
let turnstileScriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') {
    // SSR: never touches the DOM. The real load happens on the client
    // after hydration, inside the effect below.
    return Promise.resolve()
  }

  if (window.turnstile) return Promise.resolve()

  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = TURNSTILE_SCRIPT_SRC
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => {
        turnstileScriptPromise = null
        reject(new Error('Failed to load Turnstile'))
      }
      document.head.appendChild(script)
    })
  }

  return turnstileScriptPromise
}

export type TurnstileWidgetHandle = {
  /** Turnstile tokens are single-use — the caller resets after every
   * submission attempt (success or failure) so the next attempt always
   * carries a fresh token, never a stale/consumed one. */
  reset: () => void
}

export default function TurnstileWidget({
  siteKey,
  onVerify,
  onExpire,
  onError,
  ref,
}: {
  siteKey: string
  onVerify: (token: string) => void
  onExpire: () => void
  onError: () => void
  ref?: React.Ref<TurnstileWidgetHandle>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  // Callbacks are recreated every render by the caller (inline
  // arrow functions in SignInForm) — kept in refs so the render effect
  // below only re-runs when siteKey itself actually changes, never on
  // every keystroke/state update in the parent.
  const onVerifyRef = useRef(onVerify)
  const onExpireRef = useRef(onExpire)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onVerifyRef.current = onVerify
    onExpireRef.current = onExpire
    onErrorRef.current = onError
  })

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current)
      }
    },
  }))

  useEffect(() => {
    let cancelled = false

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onVerifyRef.current(token),
          'expired-callback': () => onExpireRef.current(),
          'error-callback': () => onErrorRef.current(),
        })
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current()
      })

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [siteKey])

  return <div ref={containerRef} />
}
