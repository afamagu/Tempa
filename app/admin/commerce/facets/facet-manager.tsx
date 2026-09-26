'use client'

import { useState } from 'react'
import { FACET_LABELS, type Facet, type Term } from '@/lib/admin-commerce'
import { compactSecondaryButtonClass, inputClass, primaryButtonClass } from '@/app/profile/ui'
import { adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Card, ErrorNote, Field, Pill, selectClass, useAdminAction } from '../ui'

const FACETS: Facet[] = ['place', 'mood', 'occasion', 'world', 'story', 'tag']
type Form = { id: string | null; facet: Facet; label: string; aliases: string; country_code: string; display_order: string; state: Term['state'] }
const blank = (facet: Facet): Form => ({ id: null, facet, label: '', aliases: '', country_code: '', display_order: '0', state: 'draft' })

export default function FacetManager({ terms }: { terms: Term[] }) {
  const [facet, setFacet] = useState<Facet>('place')
  const [form, setForm] = useState<Form | null>(null)
  const list = terms.filter((t) => t.facet === facet)
  const needsName = terms.filter((t) => !t.human_label).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Facet">
        {FACETS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={facet === f}
            onClick={() => {
              setFacet(f)
              setForm(null)
            }}
            className={`rounded-full border px-3 py-1 text-[13px] ${facet === f ? 'border-foreground/70 bg-foreground text-background' : 'border-foreground/15 text-foreground/80'}`}
          >
            {FACET_LABELS[f]} <span className="opacity-60">{terms.filter((t) => t.facet === f).length}</span>
          </button>
        ))}
      </div>
      {needsName > 0 && (
        <p className="rounded-md bg-foreground/[.04] px-3 py-2 text-[13px] text-foreground/80">
          {needsName} {needsName === 1 ? 'term is' : 'terms are'} still named with an internal code (like “MA”). Give each a human name before publishing — until then members never see them.
        </p>
      )}

      <Card
        title={FACET_LABELS[facet]}
        action={
          <button type="button" className={compactSecondaryButtonClass} onClick={() => setForm(blank(facet))}>
            New term
          </button>
        }
      >
        {form && <TermForm form={form} setForm={setForm} />}
        {list.length === 0 ? (
          <p className={adminTableSecondaryClass}>No {FACET_LABELS[facet].toLowerCase()} yet.</p>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {list.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className={adminTableTextClass}>
                    {t.label} <Pill tone={t.state === 'published' ? 'good' : 'quiet'}>{t.state === 'published' ? 'Published' : t.state === 'draft' ? 'Draft' : 'Inactive'}</Pill>
                    {!t.human_label && <Pill tone="warn">Needs a human name</Pill>}
                  </p>
                  <p className={adminTableSecondaryClass}>
                    {t.products} {t.products === 1 ? 'product' : 'products'}
                    {t.aliases.length > 0 ? ` · also: ${t.aliases.join(', ')}` : ''}
                    {t.country_code ? ` · ${t.country_code}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className={compactSecondaryButtonClass}
                  onClick={() =>
                    setForm({ id: t.id, facet: t.facet, label: t.label, aliases: t.aliases.join(', '), country_code: t.country_code ?? '', display_order: String(t.display_order), state: t.state })
                  }
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function TermForm({ form, setForm }: { form: Form; setForm: (f: Form | null) => void }) {
  const { run, pending, error } = useAdminAction()
  const up = (k: keyof Form, v: string) => setForm({ ...form, [k]: v })
  return (
    <form
      className="space-y-3 rounded-md border border-foreground/10 bg-foreground/[.02] p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await run('admin_commerce_save_term', {
          p_id: form.id,
          p_facet: form.facet,
          p_label: form.label,
          p_state: form.state,
          p_aliases: form.aliases.split(',').map((a) => a.trim()).filter(Boolean),
          p_country_code: form.facet === 'place' ? form.country_code || null : null,
          p_display_order: Number(form.display_order) || 0,
          p_slug: null,
        })
        if (ok) setForm(null)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name members see" hint={form.facet === 'place' ? 'A human name — “Morocco”, never “MA”.' : undefined}>
          <input value={form.label} onChange={(e) => up('label', e.target.value)} required maxLength={80} className={inputClass} />
        </Field>
        <Field label="Search aliases" hint="Comma-separated, e.g. Maghreb, Marrakech">
          <input value={form.aliases} onChange={(e) => up('aliases', e.target.value)} className={inputClass} />
        </Field>
        {form.facet === 'place' && (
          <Field label="Country code (internal)" hint="Optional ISO code, e.g. MA">
            <input value={form.country_code} onChange={(e) => up('country_code', e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))} className={inputClass} />
          </Field>
        )}
        <Field label="Order">
          <input inputMode="numeric" value={form.display_order} onChange={(e) => up('display_order', e.target.value.replace(/[^\d-]/g, ''))} className={inputClass} />
        </Field>
        <Field label="State">
          <select value={form.state} onChange={(e) => up('state', e.target.value)} className={selectClass}>
            <option value="draft">Draft (hidden)</option>
            <option value="published">Published</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      </div>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={compactSecondaryButtonClass} onClick={() => setForm(null)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
