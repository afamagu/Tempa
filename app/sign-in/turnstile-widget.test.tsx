import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import TurnstileWidget from './turnstile-widget'

const SOURCE_PATH = path.join(__dirname, 'turnstile-widget.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

// Pre-beta email auth bot protection (2026-09-15) — same SSR-only/no-jsdom
// testing convention as the rest of this codebase: renderToStaticMarkup
// for what the initial render actually produces (the script/widget only
// ever loads client-side, inside an effect, so SSR never touches
// document/window), and source-text inspection for the effect-driven
// wiring itself.
describe('TurnstileWidget — SSR safety', () => {
  it('renders a plain container with no script/window access during SSR', () => {
    const html = renderToStaticMarkup(
      <TurnstileWidget siteKey="test-site-key" onVerify={() => {}} onExpire={() => {}} onError={() => {}} />
    )
    expect(html).toContain('<div')
    expect(html).not.toContain('<script')
  })

  it('the script-loading function itself guards for a server (no window) environment', () => {
    expect(source).toContain("if (typeof window === 'undefined')")
  })
})

describe('TurnstileWidget — loads the Cloudflare script exactly once', () => {
  it('caches the load promise at module scope rather than re-fetching on every mount', () => {
    expect(source).toContain('let turnstileScriptPromise: Promise<void> | null = null')
    expect(source).toContain('if (!turnstileScriptPromise) {')
  })

  it('short-circuits entirely if window.turnstile is already present (e.g. a second mount)', () => {
    expect(source).toContain('if (window.turnstile) return Promise.resolve()')
  })

  it('uses the official Cloudflare Turnstile script URL, explicit render mode', () => {
    expect(source).toContain("'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'")
  })
})

describe('TurnstileWidget — callback wiring', () => {
  it('wires verify/expired/error callbacks to the render() call, via refs so re-renders never re-create the widget', () => {
    expect(source).toContain('callback: (token) => onVerifyRef.current(token)')
    expect(source).toContain("'expired-callback': () => onExpireRef.current()")
    expect(source).toContain("'error-callback': () => onErrorRef.current()")
  })

  it('the render effect depends only on siteKey, not on the callback props themselves', () => {
    const effectStart = source.indexOf('useEffect(() => {\n    let cancelled = false')
    const effectEnd = source.indexOf('}, [siteKey])', effectStart)
    expect(effectStart).toBeGreaterThan(-1)
    expect(effectEnd).toBeGreaterThan(effectStart)
  })

  it('a script-load failure is treated the same as a widget error-callback', () => {
    expect(source).toContain('.catch(() => {')
    expect(source).toContain('if (!cancelled) onErrorRef.current()')
  })
})

describe('TurnstileWidget — reset handle and cleanup', () => {
  it('exposes an imperative reset() that calls window.turnstile.reset with this widget\'s own id', () => {
    expect(source).toContain('useImperativeHandle(ref, () => ({')
    expect(source).toContain('window.turnstile.reset(widgetIdRef.current)')
  })

  it('removes the widget on unmount, never leaking a stale rendered challenge', () => {
    expect(source).toContain('window.turnstile.remove(widgetIdRef.current)')
    expect(source).toContain('cancelled = true')
  })
})
