'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { FACET_LABELS, type Facet, type ProductDetail, type Term } from '@/lib/admin-commerce'
import { primaryButtonClass } from '@/app/profile/ui'
import { adminTableSecondaryClass } from '@/app/admin/admin-ui'
import { Card, ErrorNote, useAdminAction } from '../../ui'

const ORDER: Facet[] = ['place', 'mood', 'occasion', 'world', 'story', 'tag']

/** Facets are many-to-many: a Postcard can be a place, a mood and an occasion at once. */
export default function FacetsPanel({
  productId,
  assigned,
  taxonomy,
  collections,
}: {
  productId: string
  assigned: ProductDetail['terms']
  taxonomy: Term[]
  collections: ProductDetail['collections']
}) {
  const { run, pending, error } = useAdminAction()
  const [selected, setSelected] = useState(() => new Set(assigned.map((t) => t.id)))
  const [saved, setSaved] = useState(false)
  const byFacet = useMemo(() => ORDER.map((f) => ({ facet: f, terms: taxonomy.filter((t) => t.facet === f && t.state !== 'inactive') })).filter((g) => g.terms.length > 0), [taxonomy])
  const dirty = selected.size !== assigned.length || assigned.some((t) => !selected.has(t.id))

  return (
    <Card
      title="Facets & collections"
      note="Only published terms with human names are shown to members."
      action={
        <Link href="/admin/commerce/facets" className="text-[13px] text-foreground/60 underline underline-offset-4">
          Manage facets
        </Link>
      }
    >
      {byFacet.length === 0 ? (
        <p className={adminTableSecondaryClass}>No facet terms yet.</p>
      ) : (
        <div className="space-y-3">
          {byFacet.map((g) => (
            <fieldset key={g.facet} className="space-y-1.5">
              <legend className="text-[13px] font-medium text-muted">{FACET_LABELS[g.facet]}</legend>
              <div className="flex flex-wrap gap-1.5">
                {g.terms.map((t) => {
                  const on = selected.has(t.id)
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setSaved(false)
                        setSelected((s) => {
                          const n = new Set(s)
                          if (on) n.delete(t.id)
                          else n.add(t.id)
                          return n
                        })
                      }}
                      className={`rounded-full border px-3 py-1 text-[13px] ${on ? 'border-foreground/70 bg-foreground text-background' : 'border-foreground/15 text-foreground/80'}`}
                    >
                      {t.label}
                      {t.state === 'draft' && <span className="ml-1 opacity-60">(draft)</span>}
                      {!t.human_label && <span className="ml-1 opacity-60">· needs a name</span>}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || pending}
          className={`${primaryButtonClass} !py-2 text-[14px] disabled:opacity-50`}
          onClick={async () => {
            if (await run('admin_commerce_set_product_terms', { p_product_id: productId, p_term_ids: [...selected] })) setSaved(true)
          }}
        >
          Save facets
        </button>
        {saved && <span className="text-[14px] text-accent">Saved</span>}
      </div>
      <ErrorNote error={error} />
      <p className={adminTableSecondaryClass}>
        Collections: {collections.length === 0 ? 'none' : collections.map((c) => c.title).join(', ')} ·{' '}
        <Link href="/admin/commerce/collections" className="underline underline-offset-4">
          manage
        </Link>
      </p>
    </Card>
  )
}
