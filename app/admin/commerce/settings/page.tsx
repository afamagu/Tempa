import { createClient } from '@/lib/supabase/server'
import { callAdminCommerce, isCommerceAdmin, type Overview } from '@/lib/admin-commerce'
import { flutterwaveApiConfig, flutterwaveWebhookConfig, testFlutterwaveConnection } from '@/lib/payments/flutterwave'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Card, Pill } from '../ui'

const SWITCHES: { key: keyof Overview['switches']; label: string; what: string }[] = [
  { key: 'commerce_enabled', label: 'Commerce', what: 'Master switch for member-facing commerce. Admin tools work either way.' },
  { key: 'credit_spend_enabled', label: 'Credit spending', what: 'Members unlocking products with Credits.' },
  { key: 'fiat_checkout_enabled', label: 'Fiat checkout', what: 'Members buying Credit packs with money.' },
  { key: 'live_payments_enabled', label: 'Live payments', what: 'Real money instead of test mode.' },
  { key: 'gifts_enabled', label: 'Gifts', what: 'Members sending Gifts in a correspondence.' },
  { key: 'home_shelf_enabled', label: 'Home shelf', what: 'The commerce shelf on Home.' },
]

/**
 * Deliberately read-only. Turning commerce on is a launch-gate action with
 * its own reviewed, verified SQL — never a toggle in this checkpoint.
 * Provider secrets are never stored in the database or shown here.
 */
type CheckoutConfig = {
  markets: { provider: string; market: string; currency: string; enabled: boolean }[]
  testers: { member: string; member_id: string; note: string | null; created_at: string }[]
  unmatched_events: number
  needs_attention: number
}

export default async function CommerceSettingsPage() {
  const supabase = await createClient()
  if (!(await isCommerceAdmin(supabase))) {
    return <p className="text-[14px] text-red-700">Commerce diagnostics are limited to admins.</p>
  }

  const apiConfig = flutterwaveApiConfig()
  const webhookConfig = flutterwaveWebhookConfig()
  const [{ data, error }, checkout, flutterwaveConnection] = await Promise.all([
    callAdminCommerce<Overview>(supabase, 'admin_commerce_overview'),
    callAdminCommerce<CheckoutConfig>(supabase, 'admin_commerce_checkout_config'),
    testFlutterwaveConnection(),
  ])
  if (error || !data) return <p className="text-[14px] text-red-700">{error?.message}</p>

  const connectionLabel = {
    connected: 'Connected',
    missing_config: 'Secret missing',
    wrong_key_type: 'Wrong key type',
    unauthorized: 'Rejected by Flutterwave',
    provider_error: 'Provider/network error',
  }[flutterwaveConnection.status]

  const connectionTone =
    flutterwaveConnection.status === 'connected'
      ? 'good'
      : flutterwaveConnection.status === 'provider_error'
        ? 'warn'
        : 'bad'
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Settings</h1>
        <p className={adminMetadataClass}>Current state only. Activation belongs to the launch gate and can’t be changed from here.</p>
      </div>
      <Card title="Commercial switches">
        <ul className="divide-y divide-foreground/10">
          {SWITCHES.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className={adminTableTextClass}>{s.label}</p>
                <p className={adminTableSecondaryClass}>{s.what}</p>
              </div>
              <Pill tone={data.switches[s.key] ? 'good' : 'quiet'}>{data.switches[s.key] ? 'On' : 'Off'}</Pill>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Payment providers" note="Credentials live only in server environment settings — never here.">
        <ul className="divide-y divide-foreground/10">
          {data.providers.map((p) => (
            <li key={p.code} className="flex items-center justify-between gap-3 py-2.5">
              <p className={adminTableTextClass}>{p.display_name}</p>
              <Pill tone={p.checkout_enabled ? 'good' : 'quiet'}>{p.checkout_enabled ? (p.live_mode_enabled ? 'Live' : 'Test mode') : 'Disabled'}</Pill>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Flutterwave v3 test connection"
        note="Read-only diagnostic. It checks Tempa’s server configuration and authenticates one GET request to Flutterwave. It never creates a charge and never displays a key."
      >
        <ul className="divide-y divide-foreground/10">
          <li className="flex items-center justify-between gap-3 py-2.5">
            <p className={adminTableTextClass}>API mode</p>
            <Pill tone="quiet">V3 test</Pill>
          </li>
          <li className="flex items-center justify-between gap-3 py-2.5">
            <p className={adminTableTextClass}>Test secret key</p>
            <Pill tone={apiConfig.ok ? 'good' : 'bad'}>{apiConfig.ok ? 'Configured' : apiConfig.reason === 'not_test_key' ? 'Wrong key type' : 'Missing'}</Pill>
          </li>
          <li className="flex items-center justify-between gap-3 py-2.5">
            <p className={adminTableTextClass}>Webhook secret hash</p>
            <Pill tone={webhookConfig.ok ? 'good' : 'warn'}>{webhookConfig.ok ? 'Configured' : 'Not configured'}</Pill>
          </li>
          <li className="flex items-center justify-between gap-3 py-2.5">
            <p className={adminTableTextClass}>Flutterwave API</p>
            <Pill tone={connectionTone}>{connectionLabel}</Pill>
          </li>
        </ul>
        <p className={adminTableSecondaryClass}>
          A missing webhook hash does not block checkout initialization anymore; it only blocks webhook verification.
        </p>
      </Card>
      {checkout.data && (
        <Card
          title="Checkout eligibility"
          note="Where each provider may sell Credit packs. A '*' price is only a price fallback — it never makes a market eligible."
        >
          {checkout.data.markets.length === 0 ? (
            <p className={adminTableSecondaryClass}>No markets are eligible.</p>
          ) : (
            <ul className="divide-y divide-foreground/10">
              {checkout.data.markets.map((m) => (
                <li key={`${m.provider}-${m.market}-${m.currency}`} className="flex items-center justify-between gap-3 py-2.5">
                  <p className={adminTableTextClass}>
                    {m.provider} · {m.market} · {m.currency}
                  </p>
                  <Pill tone={m.enabled ? 'good' : 'quiet'}>{m.enabled ? 'Eligible' : 'Off'}</Pill>
                </li>
              ))}
            </ul>
          )}
          <p className={adminTableSecondaryClass}>
            Test-checkout members: {checkout.data.testers.length === 0 ? 'none' : checkout.data.testers.map((t) => t.member).join(', ')}
            {' · '}payments needing attention: {checkout.data.needs_attention} · unmatched provider events: {checkout.data.unmatched_events}
          </p>
        </Card>
      )}
    </div>
  )
}
