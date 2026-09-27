import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { PUBLIC_INDEXABLE_PATHS, SITE_URL } from '@/lib/site'

// Cross-cutting static contracts for the pre-beta security posture. These
// guard verified positive controls against silent regression.

const root = path.resolve(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, name)
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel)
  }
  return out
}
const appSources = [...sourceFiles('app'), ...sourceFiles('lib'), 'proxy.ts']

describe('secrets stay server-side', () => {
  it('no privileged secret is ever exposed through a NEXT_PUBLIC_ variable', () => {
    for (const file of appSources) {
      for (const [name] of read(file).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
        expect(name, `${file}: ${name}`).not.toMatch(/SERVICE|SECRET|PRIVATE|RESEND|CRON|WEBHOOK|TOKEN/)
      }
    }
  })

  it('the service-role client is server-only and never imported by a client component', () => {
    expect(read('lib/supabase/service.ts')).toMatch(/^import 'server-only'/)
    for (const file of appSources) {
      const src = read(file)
      if (/^\s*['"]use client['"]/.test(src)) {
        expect(src, file).not.toMatch(/@\/lib\/supabase\/service/)
        expect(src, file).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
      }
    }
  })

  it('no env file is tracked by git', () => {
    const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n')
    expect(tracked.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.example'))).toEqual([])
  })
})

describe('CORS', () => {
  // Verified F-06: only Vercel's static/prerender layer adds ACAO:*; no
  // route handler may opt into cross-origin reads, least of all credentialed.
  it('no route handler sets Access-Control-Allow-* headers', () => {
    for (const file of sourceFiles('app').filter((f) => /route\.tsx?$/.test(f))) {
      expect(read(file), file).not.toMatch(/Access-Control-Allow-/i)
    }
    expect(read('next.config.ts')).not.toMatch(/Access-Control-Allow-/i)
  })
})

describe('baseline security headers', () => {
  it('next.config keeps HSTS, nosniff, frame and referrer protection', () => {
    const cfg = read('next.config.ts')
    for (const h of ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
      expect(cfg).toContain(h)
    }
  })
})

describe('crawl and disclosure files (F-09)', () => {
  it('robots allows only the public pages and disallows everything else', () => {
    const r = robots()
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules]
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ userAgent: '*', disallow: '/' })
    expect(rules[0].allow).toEqual([...PUBLIC_INDEXABLE_PATHS])
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`)
  })

  it('no member, admin, share or API path is ever invited for indexing', () => {
    for (const p of PUBLIC_INDEXABLE_PATHS) {
      expect(p).not.toMatch(/^\/(api|auth|admin|d|home|letters|board|write|you|profile|minds|question|announcement|begin|marketplace|prototypes)(\/|$)/)
    }
    expect(sitemap().map((e) => e.url)).toEqual(PUBLIC_INDEXABLE_PATHS.map((p) => `${SITE_URL}${p}`))
  })

  it('security.txt carries the RFC 9116 required fields and has not expired', () => {
    const txt = read('public/.well-known/security.txt')
    expect(txt).toMatch(/^Contact: mailto:\S+@jointempa\.com$/m)
    expect(txt).toMatch(/^Canonical: https:\/\/jointempa\.com\/\.well-known\/security\.txt$/m)
    const expires = new Date(txt.match(/^Expires: (\S+)$/m)![1])
    expect(expires.getTime()).toBeGreaterThan(Date.now())
    expect(expires.getTime() - Date.now()).toBeLessThan(400 * 24 * 3600 * 1000)
  })
})

describe('database authorization contracts (docs/sql)', () => {
  const sqlDir = path.join(root, 'docs', 'sql')
  const migrations = readdirSync(sqlDir).filter((f) => f.endsWith('.sql'))
  const stripComments = (s: string) => s.replace(/--[^\n]*/g, '')

  it('every SECURITY DEFINER function pins search_path', () => {
    let count = 0
    for (const f of migrations) {
      const sql = stripComments(readFileSync(path.join(sqlDir, f), 'utf8'))
      for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(([\s\S]*?)\$(\w*)\$/gi)) {
        if (/security\s+definer/i.test(m[2])) {
          count++
          expect(m[2], `${f}: ${m[1]}`).toMatch(/set\s+search_path/i)
        }
      }
    }
    expect(count).toBeGreaterThan(50)
  })

  it('anon is granted nothing except the public shared-Dispatch read path', () => {
    const allowed = new Set(['public.get_shared_dispatch(uuid)', 'public.dispatch_photo_is_externally_shared(text)'])
    let anonGrants = 0
    for (const f of migrations) {
      const sql = stripComments(readFileSync(path.join(sqlDir, f), 'utf8'))
      for (const g of sql.matchAll(/grant\s+([^;]*?)\s+to\s+([^;]*);/gi)) {
        if (!/\banon\b/i.test(g[2])) continue
        anonGrants++
        const target = g[1].match(/on\s+function\s+(\S+\([^)]*\))/i)?.[1]
        expect(target && allowed.has(target), `${f}: grant ${g[1]} to ${g[2]}`).toBe(true)
      }
    }
    expect(anonGrants).toBeGreaterThan(0)
  })
})
