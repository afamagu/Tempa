import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LEDGER_LABELS, PRODUCT_TYPE_LABELS, callAdminCommerce, formatCredits, type MemberCredits } from '@/lib/admin-commerce'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Card, Empty, Pill, formatDate } from '../ui'
import MemberPicker from '../member-picker'
import CreditOperation from './credit-operation'

export default async function CommerceCreditsPage({ searchParams }: { searchParams: Promise<{ member?: string }> }) {
  const { member } = await searchParams
  const supabase = await createClient()
  const res = member ? await callAdminCommerce<MemberCredits>(supabase, 'admin_commerce_member', { p_user_id: member }) : null
  const m = res?.data

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Credits</h1>
        <p className={adminMetadataClass}>
          Grants and corrections go through the ledger with a reason and an audit record. Balances are never edited directly and ledger history is never deleted.
          Refunds and chargebacks get their own tools later — don’t use a correction for them.
        </p>
      </div>
      <MemberPicker basePath="/admin/commerce/credits" />
      {res?.error && <p className="text-[14px] text-red-700">{res.error.message}</p>}
      {m && (
        <>
          <Card
            title={m.member.label}
            note={m.member.closed ? 'This account is closed. Records are kept; grants are not possible.' : undefined}
            action={<Pill tone={Number(m.balance) < 0 ? 'bad' : 'quiet'}>{formatCredits(m.balance)}</Pill>}
          >
            <CreditOperation memberId={m.member.id} memberLabel={m.member.label} balance={Number(m.balance)} closed={m.member.closed} />
          </Card>

          <Card title="Ledger" note="Newest first. Every movement, with who made it and why.">
            {m.ledger.length === 0 ? (
              <Empty>No Credit movements yet.</Empty>
            ) : (
              <ul className="divide-y divide-foreground/10">
                {m.ledger.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span className={adminTableTextClass}>
                      {LEDGER_LABELS[l.entry_type] ?? l.entry_type}
                      {l.item ? ` · ${l.item}` : ''}{' '}
                      <span className={Number(l.delta) < 0 ? 'text-red-700' : 'text-accent'}>
                        {Number(l.delta) > 0 ? '+' : ''}
                        {l.delta}
                      </span>
                    </span>
                    <span className={adminTableSecondaryClass}>
                      = {formatCredits(l.balance_after)} · {formatDate(l.created_at)}
                      {l.actor ? ` · ${l.actor}` : ''}
                    </span>
                    {l.reason && <span className={`w-full ${adminTableSecondaryClass}`}>“{l.reason}”</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Owned products"
            action={
              <Link href={`/admin/commerce/entitlements?member=${m.member.id}`} className="text-[13px] text-foreground/60 underline underline-offset-4">
                Grant a product
              </Link>
            }
          >
            {m.entitlements.length === 0 ? (
              <Empty>Nothing owned yet.</Empty>
            ) : (
              <ul className="divide-y divide-foreground/10">
                {m.entitlements.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span className={adminTableTextClass}>
                      {e.title} <span className="text-muted">· {PRODUCT_TYPE_LABELS[e.product_type]}</span>
                    </span>
                    <span className={adminTableSecondaryClass}>
                      {{ purchase: 'Bought', bundle: 'From a bundle', promotional_grant: 'Promotion', admin_grant: 'Admin grant' }[e.source_type] ?? e.source_type} ·{' '}
                      {formatDate(e.granted_at)} {e.state === 'revoked' ? '· revoked' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
