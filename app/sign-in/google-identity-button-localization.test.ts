import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { INTERFACE_LOCALES } from '@/i18n/config'

const source = readFileSync(path.join(__dirname, 'google-identity-button.tsx'), 'utf8')

describe('Google Identity button localization', () => {
  it('uses Tempa\'s current interface locale for the rendered Google button', () => {
    expect(INTERFACE_LOCALES.map((entry) => entry.code)).toEqual(['en', 'fr', 'es', 'pt'])
    expect(source).toContain("import { useLocale } from 'next-intl'")
    expect(source).toContain('const locale = useLocale()')
    expect(source).toMatch(/renderButton\([\s\S]*?\{[\s\S]*?locale,[\s\S]*?\}\)/)
  })

  it('re-renders the button when locale changes without making locale part of GIS initialization', () => {
    expect(source).toContain('}, [clientId, joinIntent, locale])')
    expect(source.match(/\.initialize\(\{/g)).toHaveLength(1)
    const initializeBlock = source.slice(source.indexOf('window.google!.accounts.id.initialize({'), source.indexOf('initialized = { clientId, nonce }'))
    expect(initializeBlock).not.toContain('locale')
    expect(source).toContain('if (initialized && initialized.clientId === clientId) return initialized.nonce')
  })

  it('keeps the existing nonce and credential-forwarding flow intact', () => {
    expect(source).toContain('nonce: nonce.hashed')
    expect(source).toContain('deliverCredential?.(response.credential, nonce.raw)')
    expect(source).toContain("ux_mode: 'popup'")
  })
})
