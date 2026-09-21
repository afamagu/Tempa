'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { addPostcard } from '@/lib/admin-postcards'
import { uploadPostcardArtworkImage, uploadPostcardArtworkVideo } from '@/lib/postcard-images'
import {
  secondaryButtonClass,
  primaryButtonClass,
  inputClass,
  fieldLabelClass,
  helperTextClass,
} from '@/app/profile/ui'

/**
 * Admin Phase 2A-2 — "Add Postcard": a brand new catalog key and its
 * Version 1, in one action. Collapsed by default so the main screen
 * still reads as an operational list first, matching this codebase's
 * own convention (e.g. app/admin/content/announcements/create-
 * announcement-form.tsx). No commerce fields of any kind.
 */
export default function AddPostcardForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [key, setKey] = useState('')
  const [title, setTitle] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [location, setLocation] = useState('')
  const [collection, setCollection] = useState('')
  const [postmarkText, setPostmarkText] = useState('')
  const [footerText, setFooterText] = useState('')
  const [storyText, setStoryText] = useState('')
  const [frontImagePath, setFrontImagePath] = useState('')
  const [motionSrc, setMotionSrc] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingVideo, setUploadingVideo] = useState(false)

  function reset() {
    setKey('')
    setTitle('')
    setCountryCode('')
    setLocation('')
    setCollection('')
    setPostmarkText('')
    setFooterText('')
    setStoryText('')
    setFrontImagePath('')
    setMotionSrc('')
    setError(null)
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        Add Postcard
      </button>
    )
  }

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !key.trim()) {
      if (!key.trim()) setError('Choose a key before uploading artwork.')
      return
    }
    setUploadingImage(true)
    setError(null)
    const { path, error: uploadError } = await uploadPostcardArtworkImage(createClient(), key.trim(), file)
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
    if (!file || !key.trim()) {
      if (!key.trim()) setError('Choose a key before uploading a motion asset.')
      return
    }
    setUploadingVideo(true)
    setError(null)
    const { path, error: uploadError } = await uploadPostcardArtworkVideo(createClient(), key.trim(), file)
    setUploadingVideo(false)
    if (uploadError || !path) {
      setError(uploadError ?? 'Could not upload that video. Please try again.')
      return
    }
    setMotionSrc(path)
  }

  async function handleCreate() {
    if (
      key.trim().length === 0 ||
      title.trim().length === 0 ||
      countryCode.trim().length === 0 ||
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
    const { error: actionError } = await addPostcard(createClient(), key, countryCode, {
      title,
      location,
      collection,
      postmarkText,
      footerText,
      storyText,
      frontImagePath,
      motionSrc: motionSrc || null,
    })
    setBusy(false)
    if (actionError) {
      setError(actionError.message || 'Could not create this Postcard. Please try again.')
      return
    }
    setOpen(false)
    reset()
    router.refresh()
  }

  return (
    <div className="space-y-3 rounded-md border border-foreground/10 p-4">
      <div>
        <label className={fieldLabelClass}>Key (stable identity, e.g. &quot;kyoto&quot;)</label>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="lowercase, letters/numbers/underscore only"
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <div>
        <label className={fieldLabelClass}>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={`mt-1 ${inputClass}`} />
      </div>
      <div>
        <label className={fieldLabelClass}>Country code</label>
        <input
          value={countryCode}
          onChange={(e) => setCountryCode(e.target.value)}
          placeholder="e.g. JP"
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <div>
        <label className={fieldLabelClass}>Location</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} className={`mt-1 ${inputClass}`} />
      </div>
      <div>
        <label className={fieldLabelClass}>Collection</label>
        <input value={collection} onChange={(e) => setCollection(e.target.value)} className={`mt-1 ${inputClass}`} />
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
        <input value={footerText} onChange={(e) => setFooterText(e.target.value)} className={`mt-1 ${inputClass}`} />
      </div>
      <div>
        <label className={fieldLabelClass}>Story on the right side of the back (optional)</label>
        <textarea value={storyText} onChange={(e) => setStoryText(e.target.value)} maxLength={600} rows={5} className={`mt-1 ${inputClass}`} />
      </div>

      <div>
        <label className={fieldLabelClass}>Front artwork</label>
        <div className="mt-1 flex items-center gap-3">
          {frontImagePath && (
            <div className="aspect-[3/2] w-20 shrink-0 overflow-hidden rounded-md border border-foreground/10 bg-background">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={frontImagePath} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          <label className={`inline-flex cursor-pointer items-center ${secondaryButtonClass}`}>
            {uploadingImage ? 'Uploading…' : frontImagePath ? 'Replace image' : 'Upload image'}
            <input type="file" accept="image/*" className="hidden" onChange={handleImageFile} disabled={uploadingImage} />
          </label>
        </div>
      </div>

      <div>
        <label className={fieldLabelClass}>Living Reveal motion asset (optional)</label>
        <div className="mt-1 flex items-center gap-3">
          <p className={helperTextClass}>{motionSrc ? 'A motion asset is attached.' : 'No motion asset.'}</p>
          <label className={`inline-flex cursor-pointer items-center ${secondaryButtonClass}`}>
            {uploadingVideo ? 'Uploading…' : 'Upload video'}
            <input type="file" accept="video/mp4" className="hidden" onChange={handleVideoFile} disabled={uploadingVideo} />
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            reset()
          }}
          disabled={busy}
          className={secondaryButtonClass}
        >
          Cancel
        </button>
        <button type="button" onClick={handleCreate} disabled={busy} className={primaryButtonClass}>
          {busy ? 'Creating…' : 'Add Postcard'}
        </button>
      </div>
    </div>
  )
}
