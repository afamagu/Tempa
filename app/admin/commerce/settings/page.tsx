import { createClient } from '@/lib/supabase/server'
import { callAdminCommerce, type Overview } from '@/lib/admin-commerce'
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
export default async function CommerceSettingsPage() {
  const supabase = await createClient()
  const { data, error } = await callAdminCommerce<Overview>(supabase, 'admin_commerce_overview')
  if (error || !data) return <p className="text-[14px] text-red-700">{error?.message}</p>
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
    </div>
  )
}
