'use client'

import { useMemo, useState } from 'react'
import { lifecycleLabel, type CatalogItem, type Collection } from '@/lib/admin-commerce'
import { compactSecondaryButtonClass, inputClass, primaryButtonClass } from '@/app/profile/ui'
import { adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Card, ConfirmAction, Empty, ErrorNote, Field, Pill, formatDate, selectClass, useAdminAction } from '../ui'

type Form = { id: string | null; title: string; description: string; state: Collection['state']; publish_at: string; is_featured: boolean; display_order: string }

const toLocal = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '')

export default function CollectionsManager({ collections, catalog, homeShelfEnabled }: { collections: Collection[]; catalog: CatalogItem[]; homeShelfEnabled: boolean }) {
  const [form, setForm] = useState<Form | null>(null)
  const [editingProducts, setEditingProducts] = useState<string | null>(null)
  const featured = collections.filter((c) => c.is_featured && c.state === 'published')

  return (
    <div className="space-y-5">
      <Card
        title="Collections"
        action={
          <button
            type="button"
            className={compactSecondaryButtonClass}
            onClick={() => setForm({ id: null, title: '', description: '', state: 'draft', publish_at: '', is_featured: false, display_order: String(collections.length + 1) })}
          >
            New collection
          </button>
        }
      >
        {form && <CollectionForm form={form} setForm={setForm} />}
        {collections.length === 0 ? (
          <Empty>No collections yet.</Empty>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {collections.map((c) => (
              <li key={c.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className={adminTableTextClass}>
                      {c.title} <Pill tone={c.state === 'published' ? 'good' : 'quiet'}>{c.state === 'published' ? (c.publish_at && new Date(c.publish_at) > new Date() ? 'Scheduled' : 'Published') : c.state === 'draft' ? 'Draft' : c.state === 'inactive' ? 'Inactive' : 'Scheduled'}</Pill>
                      {c.is_featured && <Pill tone="warn">Featured</Pill>}
                    </p>
                    <p className={adminTableSecondaryClass}>
                      {c.products.length} {c.products.length === 1 ? 'product' : 'products'} · order {c.display_order}
                      {c.publish_at ? ` · from ${formatDate(c.publish_at)}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" className={compactSecondaryButtonClass} onClick={() => setEditingProducts(editingProducts === c.id ? null : c.id)}>
                      Products
                    </button>
                    <button
                      type="button"
                      className={compactSecondaryButtonClass}
                      onClick={() =>
                        setForm({ id: c.id, title: c.title, description: c.description ?? '', state: c.state, publish_at: toLocal(c.publish_at), is_featured: c.is_featured, display_order: String(c.display_order) })
                      }
                    >
                      Edit
                    </button>
                  </div>
                </div>
                {editingProducts === c.id && <ProductOrder collection={c} catalog={catalog} onDone={() => setEditingProducts(null)} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <FeaturedOrder featured={featured} />

      <Card title="Home shelf" note="The future “Something you might send” shelf on Home.">
        <p className={adminTableSecondaryClass}>
          {homeShelfEnabled ? 'On.' : 'Off — it opens at a later launch gate (Settings).'} Its contents will follow the Featured order above.
        </p>
      </Card>
    </div>
  )
}

function CollectionForm({ form, setForm }: { form: Form; setForm: (f: Form | null) => void }) {
  const { run, pending, error } = useAdminAction()
  const up = (k: keyof Form, v: string | boolean) => setForm({ ...form, [k]: v })
  return (
    <form
      className="space-y-3 rounded-md border border-foreground/10 bg-foreground/[.02] p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await run('admin_commerce_save_collection', {
          p_id: form.id,
          p_title: form.title,
          p_state: form.state,
          p_description: form.description || null,
          p_is_featured: form.is_featured,
          p_display_order: Number(form.display_order) || 0,
          p_publish_at: form.publish_at ? new Date(form.publish_at).toISOString() : null,
        })
        if (ok) setForm(null)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">
          <input value={form.title} onChange={(e) => up('title', e.target.value)} required maxLength={140} className={inputClass} />
        </Field>
        <Field label="State">
          <select value={form.state} onChange={(e) => up('state', e.target.value)} className={selectClass}>
            <option value="draft">Draft (hidden)</option>
            <option value="published">Published</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <Field label="Description (optional)">
          <input value={form.description} onChange={(e) => up('description', e.target.value)} maxLength={2000} className={inputClass} />
        </Field>
        <Field label="Visible from (optional)" hint="For seasonal collections.">
          <input type="datetime-local" value={form.publish_at} onChange={(e) => up('publish_at', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Order">
          <input inputMode="numeric" value={form.display_order} onChange={(e) => up('display_order', e.target.value.replace(/[^\d-]/g, ''))} className={inputClass} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-[14px]">
          <input type="checkbox" checked={form.is_featured} onChange={(e) => up('is_featured', e.target.checked)} /> Featured
        </label>
      </div>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}>
          {pending ? 'Saving…' : 'Save collection'}
        </button>
        <button type="button" className={compactSecondaryButtonClass} onClick={() => setForm(null)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function move<T>(xs: T[], i: number, d: number): T[] {
  const j = i + d
  if (j < 0 || j >= xs.length) return xs
  const n = [...xs]
  ;[n[i], n[j]] = [n[j], n[i]]
  return n
}

function ProductOrder({ collection, catalog, onDone }: { collection: Collection; catalog: CatalogItem[]; onDone: () => void }) {
  const { run, pending, error } = useAdminAction()
  const [ids, setIds] = useState(() => collection.products.map((p) => p.id))
  const [q, setQ] = useState('')
  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])
  const matches = q.trim() ? catalog.filter((c) => !ids.includes(c.id) && c.title.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : []
  return (
    <div className="space-y-2 rounded-md border border-foreground/10 p-3">
      {ids.length === 0 ? (
        <p className={adminTableSecondaryClass}>No products yet.</p>
      ) : (
        <ol className="space-y-1">
          {ids.map((id, i) => {
            const c = byId.get(id)
            return (
              <li key={id} className="flex items-center gap-2 text-[14px]">
                <span className="w-5 text-right text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">
                  {c?.title ?? 'Unknown'} {c && <span className="text-muted">· {lifecycleLabel(c.lifecycle_state, c.publish_at)}</span>}
                </span>
                <button type="button" aria-label="Move up" className={compactSecondaryButtonClass} onClick={() => setIds((x) => move(x, i, -1))}>
                  ↑
                </button>
                <button type="button" aria-label="Move down" className={compactSecondaryButtonClass} onClick={() => setIds((x) => move(x, i, 1))}>
                  ↓
                </button>
                <button type="button" aria-label="Remove" className={compactSecondaryButtonClass} onClick={() => setIds((x) => x.filter((y) => y !== id))}>
                  ×
                </button>
              </li>
            )
          })}
        </ol>
      )}
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a product…" aria-label="Find a product to add" className={inputClass} />
      {matches.length > 0 && (
        <ul className="space-y-1">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="text-[14px] underline underline-offset-4"
                onClick={() => {
                  setIds((x) => [...x, m.id])
                  setQ('')
                }}
              >
                + {m.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}
          onClick={async () => {
            if (await run('admin_commerce_set_collection_products', { p_collection_id: collection.id, p_product_ids: ids })) onDone()
          }}
        >
          Save products & order
        </button>
        <button type="button" className={compactSecondaryButtonClass} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function FeaturedOrder({ featured }: { featured: Collection[] }) {
  const { run, error } = useAdminAction()
  const [order, setOrder] = useState(() => featured.map((c) => c.id))
  const byId = new Map(featured.map((c) => [c.id, c]))
  const shelf = order.flatMap((id) => byId.get(id)?.products.filter((p) => p.lifecycle_state === 'published') ?? [])
  const seen = new Set<string>()
  const preview = shelf.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true))).slice(0, 12)
  return (
    <Card title="Featured order" note="Published featured collections, in this order, lead the marketplace’s Featured view.">
      {featured.length === 0 ? (
        <Empty>No published featured collections — members see the catalogue in title order.</Empty>
      ) : (
        <>
          <ol className="space-y-1">
            {order.map((id, i) => (
              <li key={id} className="flex items-center gap-2 text-[14px]">
                <span className="w-5 text-right text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{byId.get(id)?.title}</span>
                <button type="button" aria-label="Move up" className={compactSecondaryButtonClass} onClick={() => setOrder((x) => move(x, i, -1))}>
                  ↑
                </button>
                <button type="button" aria-label="Move down" className={compactSecondaryButtonClass} onClick={() => setOrder((x) => move(x, i, 1))}>
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <ConfirmAction label="Save featured order" message="Apply this order to the marketplace’s Featured view?" onConfirm={() => run('admin_commerce_reorder_collections', { p_collection_ids: order })} />
          <p className={adminTableSecondaryClass}>
            Featured preview: {preview.length === 0 ? 'no published products yet' : preview.map((p) => p.title).join(' · ')}
          </p>
        </>
      )}
      <ErrorNote error={error} />
    </Card>
  )
}
