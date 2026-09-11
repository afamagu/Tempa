'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  type AdminAnnouncement,
} from '@/lib/announcements'
import { uploadAnnouncementHeroImage, resolveAnnouncementImageUrl } from '@/lib/announcement-images'
import { EMPTY_ANNOUNCEMENT_DOC, announcementDocHasContent, type AnnouncementDocJSON } from '@/lib/announcement-editor-doc'
import { secondaryButtonClass, primaryButtonClass, inputClass, fieldLabelClass, helperTextClass } from '@/app/profile/ui'
import AnnouncementEditor from './announcement-editor'
import AnnouncementBody from '@/app/announcement-body'

const DURATION_PRESETS = [
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
]

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInputValue(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

/**
 * The Announcement composer — used for both Create and Edit (Section
 * B6). A small publishing desk: hero image, title, subtitle, the
 * structured body editor, then Publishing (start now/scheduled, end
 * date+time with convenience duration presets), a restrained inline
 * Preview approximating Home's own rendering, and explicit Save
 * Draft/Publish actions. A real (published) Announcement needs a hero
 * image and an end date — enforced server-side
 * (announcements_publish_requirements/admin_publish_announcement) —
 * this form just surfaces that requirement clearly before the admin
 * even tries.
 */
export default function AnnouncementComposer({
  initial,
  onDone,
}: {
  initial?: AdminAnnouncement
  onDone: () => void
}) {
  const router = useRouter()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? '')
  const [contentJson, setContentJson] = useState<AnnouncementDocJSON>(initial?.contentJson ?? EMPTY_ANNOUNCEMENT_DOC)
  const [heroImagePath, setHeroImagePath] = useState<string | null>(initial?.heroImagePath ?? null)
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string | null>(null)
  const [startMode, setStartMode] = useState<'now' | 'scheduled'>(
    initial?.startsAt ? 'scheduled' : 'now'
  )
  const [startsAt, setStartsAt] = useState(toLocalInputValue(initial?.startsAt))
  const [endsAt, setEndsAt] = useState(toLocalInputValue(initial?.endsAt))
  const [showPreview, setShowPreview] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEdit = Boolean(initial)

  async function handleHeroFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setUploading(false)
      setError('You must be signed in to upload an image.')
      return
    }
    const { path, error: uploadError } = await uploadAnnouncementHeroImage(supabase, user.id, file)
    if (uploadError || !path) {
      setUploading(false)
      setError(uploadError ?? 'Could not upload that image. Please try again.')
      return
    }
    const { url } = await resolveAnnouncementImageUrl(supabase, path)
    setHeroImagePath(path)
    setHeroPreviewUrl(url)
    setUploading(false)
  }

  function applyDuration(days: number) {
    const startBase = startMode === 'now' || !startsAt ? new Date() : new Date(startsAt)
    const end = new Date(startBase.getTime() + days * 24 * 60 * 60 * 1000)
    setEndsAt(toLocalInputValue(end.toISOString()))
  }

  function buildInput() {
    return {
      title,
      subtitle,
      contentJson,
      heroImagePath,
      startsAt: startMode === 'now' ? null : fromLocalInputValue(startsAt),
      endsAt: fromLocalInputValue(endsAt),
    }
  }

  async function handleSaveDraft() {
    if (title.trim().length === 0) {
      setError('A title is required.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const input = buildInput()
    const saveError = isEdit
      ? (await updateAnnouncement(supabase, initial!.id, input)).error
      : (await createAnnouncement(supabase, input)).error
    setBusy(false)
    if (saveError) {
      setError(saveError.message || 'Could not save this announcement. Please try again.')
      return
    }
    router.refresh()
    onDone()
  }

  async function handlePublish() {
    if (title.trim().length === 0) {
      setError('A title is required.')
      return
    }
    if (!announcementDocHasContent(contentJson)) {
      setError('A body is required before publishing.')
      return
    }
    if (!heroImagePath) {
      setError('A hero image is required before publishing.')
      return
    }
    if (!endsAt) {
      setError('An end date and time is required before publishing.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const input = buildInput()

    const { data: newId, error: saveError } = isEdit
      ? await updateAnnouncement(supabase, initial!.id, input).then((r) => ({ data: initial!.id, error: r.error }))
      : await createAnnouncement(supabase, input)

    if (saveError || !newId) {
      setBusy(false)
      setError(saveError?.message || 'Could not save this announcement. Please try again.')
      return
    }

    const { error: publishError } = await publishAnnouncement(supabase, newId)
    setBusy(false)
    if (publishError) {
      setError(publishError.message || 'Could not publish this announcement. Please try again.')
      return
    }
    router.refresh()
    onDone()
  }

  return (
    <div className="space-y-6 rounded-md border border-foreground/10 p-4">
      <div className="space-y-4">
        <p className="text-[13px] font-medium uppercase tracking-wider text-muted">Content</p>

        <div>
          <label className={fieldLabelClass}>Hero image (3:2, recommended 1200 × 800)</label>
          <div className="mt-2 flex items-start gap-4">
            <div className="aspect-[3/2] w-40 shrink-0 overflow-hidden rounded-md border border-foreground/15 bg-surface-shell">
              {heroPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={heroPreviewUrl} alt="" className="h-full w-full object-cover" />
              ) : heroImagePath ? (
                <div className="flex h-full items-center justify-center">
                  <p className={helperTextClass}>Image saved</p>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className={helperTextClass}>No image</p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className={`inline-flex cursor-pointer items-center ${secondaryButtonClass}`}>
                {uploading ? 'Uploading…' : 'Upload image'}
                <input type="file" accept="image/*" className="hidden" onChange={handleHeroFile} disabled={uploading} />
              </label>
              <p className={helperTextClass}>Required before Publish/Schedule. Not required for a Draft.</p>
            </div>
          </div>
        </div>

        <div>
          <label className={fieldLabelClass} htmlFor="announcement-title">
            Title
          </label>
          <input
            id="announcement-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </div>

        <div>
          <label className={fieldLabelClass} htmlFor="announcement-subtitle">
            Subtitle / deck (optional)
          </label>
          <input
            id="announcement-subtitle"
            type="text"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            className={`mt-1 ${inputClass} font-serif italic`}
          />
        </div>

        <div>
          <label className={fieldLabelClass}>Body</label>
          <div className="mt-1">
            <AnnouncementEditor content={contentJson} onChange={setContentJson} />
          </div>
        </div>
      </div>

      <div className="space-y-4 border-t border-foreground/10 pt-4">
        <p className="text-[13px] font-medium uppercase tracking-wider text-muted">Publishing</p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={fieldLabelClass}>Start</label>
            <select
              value={startMode}
              onChange={(e) => setStartMode(e.target.value as 'now' | 'scheduled')}
              className={`mt-1 ${inputClass}`}
            >
              <option value="now">Now</option>
              <option value="scheduled">Scheduled</option>
            </select>
          </div>
          {startMode === 'scheduled' && (
            <div>
              <label className={fieldLabelClass} htmlFor="announcement-starts-at">
                Start date &amp; time
              </label>
              <input
                id="announcement-starts-at"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={fieldLabelClass} htmlFor="announcement-ends-at">
              End date &amp; time
            </label>
            <input
              id="announcement-ends-at"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DURATION_PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                onClick={() => applyDuration(preset.days)}
                className="rounded-full border border-foreground/15 px-2.5 py-1 text-[13px] text-foreground/70 transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <p className={helperTextClass}>A real Announcement must have an end date before it can be published.</p>
      </div>

      <div className="border-t border-foreground/10 pt-4">
        <button type="button" onClick={() => setShowPreview((v) => !v)} className={secondaryButtonClass}>
          {showPreview ? 'Hide preview' : 'Preview'}
        </button>
        {showPreview && (
          <div className="mx-auto mt-3 max-w-sm space-y-3 rounded-md border border-foreground/10 p-4">
            {heroPreviewUrl && (
              <div className="aspect-[3/2] overflow-hidden rounded-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={heroPreviewUrl} alt="" className="h-full w-full object-cover" />
              </div>
            )}
            <p className="font-serif text-xl font-medium text-foreground">{title || 'Untitled announcement'}</p>
            {subtitle && <p className="font-serif italic text-foreground/70">{subtitle}</p>}
            <AnnouncementBody doc={contentJson} />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2 border-t border-foreground/10 pt-4">
        <button type="button" onClick={onDone} disabled={busy} className={secondaryButtonClass}>
          Cancel
        </button>
        <button type="button" onClick={handleSaveDraft} disabled={busy} className={secondaryButtonClass}>
          {busy ? 'Saving…' : 'Save Draft'}
        </button>
        <button type="button" onClick={handlePublish} disabled={busy} className={primaryButtonClass}>
          {busy ? 'Working…' : startMode === 'now' ? 'Publish Now' : 'Schedule'}
        </button>
      </div>
    </div>
  )
}
