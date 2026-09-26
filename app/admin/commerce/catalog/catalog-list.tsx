'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { PRODUCT_TYPE_LABELS, formatCredits, lifecycleLabel, lifecycleTone, type CatalogItem, type ProductType } from '@/lib/admin-commerce'
import { inputClass, primaryButtonClass, compactSecondaryButtonClass } from '@/app/profile/ui'
import { adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Empty, ErrorNote, Field, Pill, selectClass, useAdminAction } from '../ui'

const TYPES: { key: 'all' | ProductType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'postcard', label: 'Postcards' },
  { key: 'gift', label: 'Gifts' },
  { key: 'keepsake_template', label: 'Keepsakes' },
  { key: 'credit_pack', label: 'Credit packs' },
  { key: 'bundle', label: 'Bundles' },
]

export default function CatalogList({ items, initialAttention = false }: { items: CatalogItem[]; initialAttention?: boolean }) {
  const [type, setType] = useState<'all' | ProductType>('all')
  const [state, setState] = useState<'all' | 'draft' | 'live' | 'off'>('all')
  const [attention, setAttention] = useState(initialAttention)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((i) => {
      if (type !== 'all' && i.product_type !== type) return false
      const label = lifecycleLabel(i.lifecycle_state, i.publish_at)
      if (state === 'draft' && label !== 'Draft') return false
      if (state === 'live' && !(label === 'Published' || label === 'Scheduled')) return false
      if (state === 'off' && !(label === 'Off sale' || label === 'Retired')) return false
      if (attention && i.ready && !i.review_flag) return false
      if (needle && !`${i.title} ${i.slug} ${i.postcard_key ?? ''}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [items, type, state, attention, q])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" aria-label="Search products" className={`${inputClass} sm:max-w-xs`} />
        <button type="button" className={`${primaryButtonClass} !py-2 text-[14px]`} onClick={() => setCreating((v) => !v)}>
          New product
        </button>
      </div>
      {creating && <NewProduct onDone={() => setCreating(false)} />}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Product type">
        {TYPES.map((t) => (
          <Chip key={t.key} on={type === t.key} onClick={() => setType(t.key)}>
            {t.label}
          </Chip>
        ))}
        <span className="mx-1 w-px self-stretch bg-foreground/10" aria-hidden="true" />
        {(['all', 'draft', 'live', 'off'] as const).map((s) => (
          <Chip key={s} on={state === s} onClick={() => setState(s)}>
            {{ all: 'Any state', draft: 'Drafts', live: 'On sale', off: 'Off sale' }[s]}
          </Chip>
        ))}
        <Chip on={attention} onClick={() => setAttention((v) => !v)}>
          Needs attention
        </Chip>
      </div>

      {shown.length === 0 ? (
        <Empty>{items.length === 0 ? 'No products yet.' : 'Nothing matches these filters.'}</Empty>
      ) : (
        <ul className="divide-y divide-foreground/10 rounded-lg border border-foreground/10 bg-background">
          {shown.map((i) => {
            const label = lifecycleLabel(i.lifecycle_state, i.publish_at)
            return (
              <li key={i.id}>
                <Link href={`/admin/commerce/catalog/${i.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-foreground/[.03] focus-visible:bg-foreground/[.03] focus-visible:outline-none">
                  <span className="h-14 w-10 shrink-0 overflow-hidden rounded border border-foreground/10 bg-foreground/[.04]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {i.thumbnail && <img src={i.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-medium ${adminTableTextClass}`}>{i.title}</span>
                    <span className={`block truncate ${adminTableSecondaryClass}`}>
                      {PRODUCT_TYPE_LABELS[i.product_type]}
                      {' · '}
                      {i.product_type === 'credit_pack'
                        ? formatCredits(i.credit_amount)
                        : i.product_type === 'bundle'
                          ? 'Bundle price from its version'
                          : i.is_complimentary
                            ? 'Complimentary'
                            : i.price !== null
                              ? formatCredits(i.price)
                              : 'No price yet'}
                      {i.owners > 0 ? ` · ${i.owners} ${i.owners === 1 ? 'owner' : 'owners'}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Pill tone={lifecycleTone(label)}>{label}</Pill>
                    {(!i.ready || i.review_flag) && <span className="text-[12px] text-muted">{i.review_flag ? 'Review pending' : 'Incomplete'}</span>}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${on ? 'border-foreground/70 bg-foreground text-background' : 'border-foreground/15 text-foreground/80 hover:border-foreground/30'}`}
    >
      {children}
    </button>
  )
}

function NewProduct({ onDone }: { onDone: () => void }) {
  const router = useRouter()
  const { run, pending, error } = useAdminAction()
  const [type, setType] = useState<'gift' | 'keepsake_template' | 'credit_pack' | 'bundle'>('gift')
  const [title, setTitle] = useState('')
  const [complimentary, setComplimentary] = useState(false)
  const [credits, setCredits] = useState('')
  return (
    <form
      className="space-y-3 rounded-lg border border-foreground/10 bg-background p-4"
      onSubmit={async (e) => {
        e.preventDefault()
        await run<string>(
          'admin_commerce_create_product',
          {
            p_product_type: type,
            p_title: title,
            p_is_complimentary: complimentary,
            p_credit_amount: type === 'credit_pack' ? Number(credits) || null : null,
            p_entitlement_model: type === 'keepsake_template' ? 'durable' : null,
          },
          (id) => {
            onDone()
            router.push(`/admin/commerce/catalog/${id}`)
          }
        )
      }}
    >
      <p className="text-[14px] text-muted">New products always start as drafts. Postcards are added in Content → Postcards.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className={selectClass}>
            <option value="gift">Gift</option>
            <option value="keepsake_template">Keepsake (kept by the member)</option>
            <option value="credit_pack">Credit pack</option>
            <option value="bundle">Bundle</option>
          </select>
        </Field>
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={140} className={inputClass} />
        </Field>
        {type === 'credit_pack' ? (
          <Field label="Credits granted" hint="Whole Credits, e.g. 300">
            <input inputMode="numeric" value={credits} onChange={(e) => setCredits(e.target.value.replace(/\D/g, ''))} required className={inputClass} />
          </Field>
        ) : type !== 'bundle' ? (
          <label className="flex items-center gap-2 self-end pb-2 text-[14px]">
            <input type="checkbox" checked={complimentary} onChange={(e) => setComplimentary(e.target.checked)} /> Complimentary (no Credits)
          </label>
        ) : null}
      </div>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending || !title.trim()} className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}>
          {pending ? 'Creating…' : 'Create draft'}
        </button>
        <button type="button" onClick={onDone} className={compactSecondaryButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  )
}
