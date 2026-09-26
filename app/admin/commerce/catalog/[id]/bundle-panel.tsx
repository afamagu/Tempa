'use client'

import { useMemo, useState } from 'react'
import { bundleCompletion, formatCredits, type BundleVersion, type CatalogItem, type ProductDetail } from '@/lib/admin-commerce'
import { inputClass, primaryButtonClass, compactSecondaryButtonClass } from '@/app/profile/ui'
import { adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Card, ConfirmAction, Empty, ErrorNote, Field, Pill, formatDate, selectClass, useAdminAction } from '../../ui'


type Draft = { product_id: string; title: string; allocation_credits: string }

/**
 * Bundles hold durable products (premium Postcards, durable Keepsakes)
 * with fixed Credit allocations. The bundle price is their sum; a member's
 * completion price is the sum for the items they don't own yet. Publishing
 * freezes a version — any change is a new version.
 */
export default function BundlePanel({ detail, catalog }: { detail: ProductDetail; catalog: CatalogItem[] }) {
  const draft = detail.bundle_versions.find((v) => v.state === 'draft') ?? null
  const durable = useMemo(
    () => catalog.filter((c) => (c.product_type === 'postcard' && !c.is_complimentary) || c.product_type === 'keepsake_template').filter((c) => c.id !== detail.product.id),
    [catalog, detail.product.id]
  )
  return (
    <Card title="Bundle versions" note="Only products members keep can be bundled — never Gifts, Credit packs or other bundles.">
      {detail.bundle_versions.length === 0 && !draft && <Empty>No versions yet — start a draft below.</Empty>}
      <ul className="space-y-3">
        {detail.bundle_versions
          .filter((v) => v.state !== 'draft')
          .map((v) => (
            <PublishedVersion key={v.id} v={v} />
          ))}
      </ul>
      <DraftEditor bundleId={detail.product.id} draft={draft} options={durable} />
    </Card>
  )
}

function PublishedVersion({ v }: { v: BundleVersion }) {
  const { run, error } = useAdminAction()
  const [owned, setOwned] = useState<Set<string>>(new Set())
  const { full, completion, allOwned } = bundleCompletion(v.items, owned)
  const live = v.state === 'published' && (!v.effective_to || new Date(v.effective_to) > new Date())
  return (
    <li className="space-y-2 rounded-md border border-foreground/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={adminTableTextClass}>
          Version {v.version_number} <Pill tone={live ? 'good' : 'quiet'}>{v.state === 'retired' ? 'Retired' : live ? 'Live' : 'Ended'}</Pill>
        </p>
        <p className={adminTableSecondaryClass}>
          {formatDate(v.effective_from)} → {v.effective_to ? formatDate(v.effective_to) : 'open'}
        </p>
      </div>
      <ul className="space-y-1">
        {v.items.map((i) => (
          <li key={i.product_id} className="flex items-center justify-between gap-2 text-[14px]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={owned.has(i.product_id)}
                onChange={(e) =>
                  setOwned((s) => {
                    const n = new Set(s)
                    if (e.target.checked) n.add(i.product_id)
                    else n.delete(i.product_id)
                    return n
                  })
                }
                aria-label={`Preview: member already owns ${i.title}`}
              />
              {i.title}
            </label>
            <span className="text-foreground/70">{formatCredits(i.allocation_credits)}</span>
          </li>
        ))}
      </ul>
      <p className={adminTableSecondaryClass}>
        Full price {formatCredits(full)} · preview: a member owning the ticked items pays{' '}
        <span className="font-medium text-foreground">{allOwned ? 'nothing (already owns all)' : formatCredits(completion)}</span>
      </p>
      {v.state === 'published' && (
        <ConfirmAction
          label="Retire version"
          message="Retire this version? The bundle can’t be bought until another version is published."
          reason
          reasonRequired
          onConfirm={(reason) => run('admin_commerce_retire_bundle_version', { p_version_id: v.id, p_reason: reason })}
        />
      )}
      <ErrorNote error={error} />
    </li>
  )
}

function DraftEditor({ bundleId, draft, options }: { bundleId: string; draft: BundleVersion | null; options: CatalogItem[] }) {
  const { run, pending, error } = useAdminAction()
  const [items, setItems] = useState<Draft[]>(() => (draft?.items ?? []).map((i) => ({ product_id: i.product_id, title: i.title, allocation_credits: String(i.allocation_credits) })))
  const [pick, setPick] = useState('')
  const [start, setStart] = useState('')
  const total = items.reduce((a, i) => a + (Number(i.allocation_credits) || 0), 0)
  const available = options.filter((o) => !items.some((i) => i.product_id === o.id))
  const save = () =>
    run<string>('admin_commerce_save_bundle_draft', {
      p_bundle_product_id: bundleId,
      p_version_id: draft?.id ?? null,
      p_items: items.map((i) => ({ product_id: i.product_id, allocation_credits: Number(i.allocation_credits) })),
      p_effective_from: start ? new Date(start).toISOString() : null,
    })

  return (
    <div className="space-y-3 border-t border-foreground/10 pt-3">
      <p className="text-[15px] font-medium">{draft ? `Draft version ${draft.version_number}` : 'New version'}</p>
      {items.length === 0 ? (
        <p className={adminTableSecondaryClass}>Add products below.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i, idx) => (
            <li key={i.product_id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[14px]">{i.title}</span>
              <input
                aria-label={`Credits allocated to ${i.title}`}
                inputMode="numeric"
                value={i.allocation_credits}
                onChange={(e) => setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, allocation_credits: e.target.value.replace(/\D/g, '') } : x)))}
                className={`${inputClass} !w-24`}
              />
              <button type="button" className={compactSecondaryButtonClass} onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))} aria-label={`Remove ${i.title}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Add a product">
          <select
            value={pick}
            onChange={(e) => {
              const o = options.find((x) => x.id === e.target.value)
              if (o) setItems((xs) => [...xs, { product_id: o.id, title: o.title, allocation_credits: o.price ? String(o.price) : '' }])
              setPick('')
            }}
            className={selectClass}
          >
            <option value="">Choose…</option>
            {available.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Starts" hint="Empty = when published.">
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <p className={adminTableTextClass}>
        Bundle price: <span className="font-medium">{formatCredits(total)}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || items.length === 0} onClick={save} className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}>
          Save draft
        </button>
        {draft && (
          <>
            <ConfirmAction
              label="Publish version"
              message="Publish this version? Its items and allocations are then frozen; the live version (if any) ends when this one starts."
              reason
              onConfirm={(reason) => run('admin_commerce_publish_bundle_version', { p_version_id: draft.id, p_reason: reason || null })}
            />
            <ConfirmAction label="Discard draft" message="Discard this draft version?" onConfirm={(reason) => run('admin_commerce_retire_bundle_version', { p_version_id: draft.id, p_reason: reason || null })} />
          </>
        )}
      </div>
      <ErrorNote error={error} />
    </div>
  )
}
