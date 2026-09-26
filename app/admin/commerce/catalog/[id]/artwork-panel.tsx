'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadPostcardArtworkImage } from '@/lib/postcard-images'
import type { ProductDetail } from '@/lib/admin-commerce'
import { adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Card, ConfirmAction, Empty, ErrorNote, Pill, formatDate, useAdminAction } from '../../ui'

/**
 * Versions are immutable once created (a version members already hold is
 * never edited). A change is a new version, which becomes current.
 * Postcards keep their own frozen postcard_versions (managed in Content →
 * Postcards); Gifts and Keepsakes use commerce_product_versions here.
 */
export default function ArtworkPanel({ detail }: { detail: ProductDetail }) {
  const p = detail.product
  const { run, error, setError } = useAdminAction()
  const [uploading, setUploading] = useState(false)

  if (p.product_type === 'postcard') {
    return (
      <Card
        title="Artwork"
        note="Each edit creates a new version; every Postcard already sent keeps its own frozen artwork."
        action={
          <Link href="/admin/content/postcards" className="text-[13px] text-foreground/60 underline underline-offset-4">
            New version in Content → Postcards
          </Link>
        }
      >
        {detail.postcard_versions.length === 0 ? <Empty>No artwork yet.</Empty> : <VersionList rows={detail.postcard_versions.map((v) => ({ ...v, used: v.times_sent > 0, usedLabel: v.times_sent > 0 ? `Sent ${v.times_sent}×` : null }))} />}
      </Card>
    )
  }

  if (p.product_type === 'bundle') return null

  return (
    <Card title="Artwork" note="Upload a new version to change the artwork. Earlier versions stay unchanged for anyone who already has them.">
      {detail.versions.length === 0 ? (
        <Empty>No artwork yet — upload the first version.</Empty>
      ) : (
        <VersionList
          rows={detail.versions.map((v) => ({ ...v, used: v.in_use, usedLabel: v.in_use ? 'In use' : null }))}
          onMakeCurrent={(id) => run('admin_commerce_set_current_version', { p_version_id: id, p_reason: null })}
        />
      )}
      <label className="inline-flex cursor-pointer items-center gap-2 text-[14px] text-foreground/80 underline underline-offset-4">
        {uploading ? 'Uploading…' : 'Upload new version'}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={uploading}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            setUploading(true)
            const { path, error: uploadError } = await uploadPostcardArtworkImage(createClient(), p.slug, file)
            setUploading(false)
            if (!path) {
              setError({ code: 'upload', message: uploadError ?? 'Could not upload that image.' })
              return
            }
            await run('admin_commerce_add_version', { p_product_id: p.id, p_title: p.title, p_image_path: path, p_reason: null })
          }}
        />
      </label>
      <ErrorNote error={error} />
    </Card>
  )
}

function VersionList({
  rows,
  onMakeCurrent,
}: {
  rows: { id: string; version_number: number; title: string | null; image: string; is_current: boolean; created_at: string; used: boolean; usedLabel: string | null }[]
  onMakeCurrent?: (id: string) => Promise<boolean>
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {rows.map((v) => (
        <li key={v.id} className="space-y-1.5">
          <div className="aspect-[9/16] overflow-hidden rounded border border-foreground/10 bg-foreground/[.04]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={v.image} alt={`Version ${v.version_number}`} loading="lazy" className="h-full w-full object-cover" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={adminTableTextClass}>v{v.version_number}</span>
            {v.is_current && <Pill tone="good">Current</Pill>}
            {v.usedLabel && <Pill>{v.usedLabel}</Pill>}
          </div>
          <p className={adminTableSecondaryClass}>{formatDate(v.created_at)}</p>
          {!v.is_current && onMakeCurrent && (
            <ConfirmAction label="Make current" message={`Show version ${v.version_number} to members from now on?`} onConfirm={() => onMakeCurrent(v.id)} />
          )}
        </li>
      ))}
    </ul>
  )
}
