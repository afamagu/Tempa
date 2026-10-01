import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.join(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const layout = read('app/layout.tsx')
const nextConfig = read('next.config.ts')
const proxy = read('proxy.ts')

describe('root layout', () => {
  it('html lang follows the resolved locale; dir comes from the registry', () => {
    expect(layout).toContain('const locale = await getLocale();')
    expect(layout).toContain('lang={locale}')
    expect(layout).toContain('dir={localeDirection(locale)}')
    expect(layout).not.toContain('lang="en"')
  })

  it('keeps connection(), fonts, writing-style variables, metadata and body classes', () => {
    expect(layout).toContain('await connection();')
    expect(layout.indexOf('await connection();')).toBeLessThan(layout.indexOf('await getLocale()'))
    expect(layout).toContain('${geistSans.variable} ${newsreader.variable} ${writingStyleFontVariables} h-full antialiased')
    expect(layout).toContain('style={writingStyleFontFaceVars}')
    expect(layout).toContain('export const metadata: Metadata')
    expect(layout).toContain('<body className="min-h-full flex flex-col">')
    expect(layout).toContain('<NextIntlClientProvider>{children}</NextIntlClientProvider>')
  })
})

describe('no locale routing', () => {
  it('next.config wraps the SAME config with the next-intl plugin; redirects and headers intact', () => {
    expect(nextConfig).toContain('createNextIntlPlugin("./i18n/request.ts")')
    expect(nextConfig).toContain('export default withNextIntl(nextConfig);')
    expect(nextConfig).toContain('source: "/admin/reports"')
    expect(nextConfig).toContain('{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }')
    expect(nextConfig).not.toMatch(/\bi18n\s*:|locales\s*:|defaultLocale/)
  })

  it('proxy only synchronizes the authenticated saved locale; it never introduces locale routing', () => {
    expect(proxy).not.toMatch(/from ['"]next-intl\/middleware['"]|createMiddleware\s*\(/)
    expect(proxy).not.toMatch(/\[locale\]|\/fr\/|\/es\/|\/pt\//)
    expect(proxy).toContain('LOCALE_COOKIE')
    expect(proxy).toContain('interfaceLocale')
    expect(proxy).toContain("response.cookies.set(LOCALE_COOKIE, interfaceLocale")
  })

  it('no [locale] route segment and no /fr/ /es/ /pt/ paths exist', () => {
    const stack = [path.join(root, 'app')]
    while (stack.length) {
      const dir = stack.pop()!
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (!statSync(full).isDirectory()) continue
        expect(name, full).not.toMatch(/^\[\.*locale\]$|^\[lang\]$|^(en|fr|es|pt)$/)
        stack.push(full)
      }
    }
  })
})
