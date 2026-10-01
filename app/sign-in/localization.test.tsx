import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import es from '@/messages/es.json'
import pt from '@/messages/pt.json'

let currentSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({ useSearchParams: () => currentSearchParams }))
vi.mock('@/app/locale-actions', () => ({ setInterfaceLanguage: async () => ({ ok: true }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithOtp: async () => ({ error: null }), signInWithOAuth: async () => ({ error: null }) } }),
}))

const { default: SignInPage } = await import('./page')
const DICTIONARIES = { en, fr, es, pt } as const

function render(locale: keyof typeof DICTIONARIES, query = '') {
  currentSearchParams = new URLSearchParams(query)
  try {
    return renderToStaticMarkup(
      <NextIntlClientProvider locale={locale} messages={DICTIONARIES[locale]}>
        <SignInPage />
      </NextIntlClientProvider>
    )
  } finally {
    currentSearchParams = new URLSearchParams()
  }
}

const page = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const switcher = readFileSync(path.join(__dirname, '..', 'language-switcher.tsx'), 'utf8')

describe('/sign-in is localized', () => {
  it('French: the core sign-in copy is French, with no English core copy left', () => {
    const html = render('fr')
    for (const text of ['Une façon plus humaine de créer du lien', 'Se connecter', 'Continuer avec Google', 'Envoyer un lien de connexion', 'Nouveau sur Tempa', 'Créer un compte', 'vous@exemple.com']) {
      expect(html).toContain(text)
    }
    for (const english of ['A more human way to connect', 'Send magic link', 'Continue with Google', 'New to Tempa?', 'you@example.com']) {
      expect(html).not.toContain(english)
    }
    expect(html).toContain('>Tempa<')
  })

  it('Spanish and Portuguese render their own copy; ?intent=join uses the create-account heading', () => {
    expect(render('es')).toContain('Iniciar sesión')
    expect(render('pt')).toContain('Enviar link de acesso')
    expect(render('fr', 'intent=join')).toContain('Créez votre compte Tempa')
    expect(render('pt', 'intent=join')).toContain('Crie sua conta no Tempa')
  })

  it('auth error semantics are unchanged in every language: known codes only, localized, never raw', () => {
    expect(render('fr', 'error=link_expired')).toContain('Ce lien de connexion n’est plus valide.')
    expect(render('es', 'error=auth_failed')).toContain('Algo salió mal al iniciar sesión.')
    const banned = render('pt', 'error=account_banned')
    expect(banned).toContain('banida permanentemente')
    expect(banned).toContain('support@jointempa.com')
    expect(banned).not.toContain('Criar uma conta') // still no join invitation for a ban
    expect(render('fr', 'error=account_deleted')).toContain('Créer un nouveau compte')
    // An unknown ?error= value shows nothing at all, in any language.
    expect(render('fr', 'error=<script>alert(1)</script>')).not.toContain('script')
  })

  it('raw provider errors stay hidden: every visible error string is from the dictionary', () => {
    // The only error sinks render t(`errors.${key}`) / t(`refusals.${kind}`),
    // with keys from the pure mappers — never error.message or result.message.
    expect(page).toContain("{t(`errors.${errorKey}`)}")
    expect(page).toContain("{t(`errors.${resendError}`)}")
    expect(page).toContain("t(`refusals.${refusal.kind}`, { email: SUPPORT_EMAIL })")
    expect(page).not.toMatch(/\{\s*error\.message\s*\}|\{\s*result\.message\s*\}|setErrorKey\(result\.message\)/)
  })
})

describe('the language control on /sign-in', () => {
  it('offers the four native names, outside the sign-in form, with an accessible label', () => {
    const html = render('en')
    const select = html.slice(html.indexOf('<select'), html.indexOf('</select>'))
    expect(select.match(/<option/g)).toHaveLength(4)
    for (const name of ['English', 'Français', 'Español', 'Português']) expect(select).toContain(`>${name}</option>`)
    expect(html).toMatch(/<label[^>]*class="sr-only"[^>]*>Language<\/label>/)
    const formStart = html.indexOf('<form')
    const formEnd = html.indexOf('</form>')
    expect(html.indexOf('<select')).toBeGreaterThan(-1)
    expect(html.indexOf('<select') < formStart || html.indexOf('<select') > formEnd).toBe(true)
    expect(render('fr')).toMatch(/<label[^>]*>Langue<\/label>/)
  })

  it('switching keeps the URL: no navigation, no router push, no query rewrite, no form submit', () => {
    const code = switcher.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).toContain('await setInterfaceLanguage(next)')
    expect(code).not.toMatch(/useRouter|router\.|window\.location|history\.|href=|searchParams|requestSubmit|\.submit\(/)
    // The Server Action sets a cookie; Next re-renders the current route in
    // place, so ?next= / ?intent=join / ?error= stay exactly as they were.
  })

  it('the sign-in flows themselves are unchanged: same next sanitizing, callback URL, Turnstile gate', () => {
    expect(page).toContain("const nextPath = sanitizeInternalPath(searchParams.get('next'))")
    expect(page).toContain("const url = new URL('/auth/callback', window.location.origin)")
    expect(page).toContain("if (nextPath) url.searchParams.set('next', nextPath)")
    expect(page).toContain("const [joinIntent, setJoinIntent] = useState(() => searchParams.get('intent') === 'join')")
    expect(page).toContain("disabled={status === 'sending' || (turnstileEnabled && !captchaToken)}")
    expect(page).toContain('captchaToken: captchaToken ?? undefined,')
    expect(page).toContain('signInWithGoogleIdToken(createClient(), { credential, rawNonce, captchaToken: token })')
    expect(page).not.toMatch(/router\.(push|replace)|useLocale/)
  })
})
