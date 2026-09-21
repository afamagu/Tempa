'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { setPostcardActive, createPostcardVersion, formatPostcardSentCount, type AdminPostcard } from '@/lib/admin-postcards'
import { uploadPostcardArtworkImage, uploadPostcardArtworkVideo } from '@/lib/postcard-images'
import type { PostcardRevealLineAlignment } from '@/lib/moments'
import {
  secondaryButtonClass,
  primaryButtonClass,
  inputClass,
  fieldLabelClass,
  helperTextClass,
} from '@/app/profile/ui'
import { adminMetadataClass, adminTableTextClass } from '@/app/admin/admin-ui'

const ALIGNMENTS: PostcardRevealLineAlignment[] = [
  'top-left',
  'top-center',
  'top-right',
  'center',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

/**
 * Admin Phase 2A-2 — one Postcard's admin row. "Edit Postcard" is ONE
 * form covering both descriptive metadata and artwork, because they're
 * the same underlying action server-side (admin_create_postcard_version
 * always creates a brand-new immutable version, regardless of which
 * fields the admin actually changed) — the owner never needs to know
 * that distinction exists. No Delete control anywhere: Activate/
 * Deactivate is the only state-changing action besides creating a new
 * version, matching this checkpoint's own "no hard-delete" instruction.
 */
export default function PostcardRow({ postcard }: { postcard: AdminPostcard }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState(postcard.title)
  const [location, setLocation] = useState(postcard.location)
  const [collection, setCollection] = useState(postcard.collection)
  const [postmarkText, setPostmarkText] = useState(postcard.postmarkText)
  const [footerText, setFooterText] = useState(postcard.footerText)
  const [storyText, setStoryText] = useState(postcard.storyText)
  const [frontImagePath, setFrontImagePath] = useState(postcard.frontImagePath)
  const [motionSrc, setMotionSrc] = useState(postcard.motionSrc ?? '')
  const [durationSeconds, setDurationSeconds] = useState(
    postcard.durationSeconds !== null ? String(postcard.durationSeconds) : ''
  )
  const [revealLineAlignment, setRevealLineAlignment] = useState<PostcardRevealLineAlignment | ''>(
    postcard.revealLineAlignment ?? ''
  )
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingVideo, setUploadingVideo] = useState(false)

  async function toggleActive() {
    setBusy(true)
    setError(null)
    const { error: actionError } = await setPostcardActive(createClient(), postcard.key, !postcard.isActive)
    setBusy(false)
    if (actionError) {
      setError(actionError.message || 'Could not update this Postcard. Please try again.')
      return
    }
    router.refresh()
  }

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingImage(true)
    setError(null)
    const { path, error: uploadError } = await uploadPostcardArtworkImage(createClient(), postcard.key, file)
    setUploadingImage(false)
    if (uploadError || !path) {
      setError(uploadError ?? 'Could not upload that image. Please try again.')
      return
    }
    setFrontImagePath(path)
  }

  async function handleVideoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingVideo(true)
    setError(null)
    const { path, error: uploadError } = await uploadPostcardArtworkVideo(createClient(), postcard.key, file)
    setUploadingVideo(false)
    if (uploadError || !path) {
      setError(uploadError ?? 'Could not upload that video. Please try again.')
      return
    }
    setMotionSrc(path)
  }

  async function saveVersion() {
    if (
      title.trim().length === 0 ||
      location.trim().length === 0 ||
      collection.trim().length === 0 ||
      postmarkText.trim().length === 0 ||
      footerText.trim().length === 0 ||
      frontImagePath.trim().length === 0
    ) {
      setError('Every field except the motion asset is required.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: actionError } = await createPostcardVersion(createClient(), postcard.key, {
      title,
      location,
      collection,
      postmarkText,
      footerText,
      storyText,
      frontImagePath,
      motionSrc: motionSrc.trim() || null,
      durationSeconds: durationSeconds.trim() ? Number(durationSeconds) : null,
      revealLineAlignment: revealLineAlignment || null,
    })
    setBusy(false)
    if (actionError) {
      setError(actionError.message || 'Could not save this Postcard. Please try again.')
      return
    }
    setEditing(false)
    router.refresh()
  }

  return (
    <div className="space-y-3 rounded-md border border-foreground/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3 min-w-0">
          <div className="aspect-[3/2] w-24 shrink-0 overflow-hidden rounded-md border border-foreground/10 bg-surface-shell">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={postcard.frontImagePath} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0">
            <p className={adminMetadataClass}>
              {postcard.key} · {postcard.countryCode} · v{postcard.versionNumber}
            </p>
            <p className={`mt-0.5 ${adminTableTextClass}`}>{postcard.title}</p>
            <p className={adminMetadataClass}>
              {postcard.location} · {postcard.collection}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`rounded-full px-2 py-0.5 text-[14px] font-medium ${
              postcard.isActive ? 'bg-accent/10 text-accent' : 'bg-foreground/[.06] text-foreground/60'
            }`}
          >
            {postcard.isActive ? 'Active' : 'Inactive'}
          </span>
          <span className={adminMetadataClass}>{formatPostcardSentCount(postcard.timesSent)}</span>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {editing ? (
        <div className="space-y-3 rounded-md border border-foreground/10 bg-surface-shell p-3">
          <p className={helperTextClass}>
            Saving creates a brand-new version. Every Postcard already sent keeps its own frozen wording and
            artwork exactly as it was — nothing here can change what a recipient already received.
          </p>

          <div>
            <label className={fieldLabelClass}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`mt-1 ${inputClass}`} />
          </div>
          <div>
            <label className={fieldLabelClass}>Location</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className={`mt-1 ${inputClass}`} />
          </div>
          <div>
            <label className={fieldLabelClass}>Collection</label>
            <input
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <label className={fieldLabelClass}>Postmark text</label>
            <textarea
              value={postmarkText}
              onChange={(e) => setPostmarkText(e.target.value)}
              rows={2}
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <label className={fieldLabelClass}>Footer text</label>
            <input
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <label className={fieldLabelClass}>Story on the right side of the back</label>
            <textarea value={storyText} onChange={(e) => setStoryText(e.target.value)} maxLength={600} rows={5} className={`mt-1 ${inputClass}`} />
          </div>

          <div>
            <label className={fieldLabelClass}>Front artwork</label>
            <div className="mt-1 flex items-center gap-3">
              <div className="aspect-[3/2] w-20 shrink-0 overflow-hidden rounded-md border border-foreground/10 bg-background">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={frontImagePath} alt="" className="h-full w-full object-cover" />
              </div>
              <label className={`inline-flex cursor-pointer items-center ${secondaryButtonClass}`}>
                {uploadingImage ? 'Uploading…' : 'Replace image'}
                <input type="file" accept="image/*" className="hidden" onChange={handleImageFile} disabled={uploadingImage} />
              </label>
            </div>
          </div>

          <div>
            <label className={fieldLabelClass}>Living Reveal motion asset (optional)</label>
            <div className="mt-1 flex items-center gap-3">
              <p className={helperTextClass}>{motionSrc ? 'A motion asset is attached.' : 'No motion asset.'}</p>
              <label className={`inline-flex cursor-pointer items-center ${secondaryButtonClass}`}>
                {uploadingVideo ? 'Uploading…' : motionSrc ? 'Replace video' : 'Add video'}
                <input type="file" accept="video/mp4" className="hidden" onChange={handleVideoFile} disabled={uploadingVideo} />
              </label>
              {motionSrc && (
                <button type="button" onClick={() => setMotionSrc('')} className={helperTextClass}>
                  Remove
                </button>
              )}
            </div>
          </div>

          {motionSrc && (
            <div className="flex flex-wrap gap-3">
              <div>
                <label className={fieldLabelClass}>Duration (seconds)</label>
                <input
                  type="number"
                  step="0.01"
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(e.target.value)}
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div>
                <label className={fieldLabelClass}>Reveal Line alignment</label>
                <select
                  value={revealLineAlignment}
                  onChange={(e) => setRevealLineAlignment(e.target.value as PostcardRevealLineAlignment | '')}
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="">Default (bottom-center)</option>
                  {ALIGNMENTS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setTitle(postcard.title)
                setLocation(postcard.location)
                setCollection(postcard.collection)
                setPostmarkText(postcard.postmarkText)
                setFooterText(postcard.footerText)
                setStoryText(postcard.storyText)
                setFrontImagePath(postcard.frontImagePath)
                setMotionSrc(postcard.motionSrc ?? '')
                setDurationSeconds(postcard.durationSeconds !== null ? String(postcard.durationSeconds) : '')
                setRevealLineAlignment(postcard.revealLineAlignment ?? '')
                setError(null)
              }}
              disabled={busy}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button type="button" onClick={saveVersion} disabled={busy} className={primaryButtonClass}>
              {busy ? 'Saving…' : 'Save as new version'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={toggleActive} disabled={busy} className={secondaryButtonClass}>
            {busy ? 'Working…' : postcard.isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>
            Edit Postcard
          </button>
        </div>
      )}
    </div>
  )
}
