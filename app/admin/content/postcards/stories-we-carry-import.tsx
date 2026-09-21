'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { addPostcard, setPostcardActive, type AdminPostcard } from '@/lib/admin-postcards'
import { uploadPostcardArtworkStill, uploadPostcardArtworkVideo } from '@/lib/postcard-images'
import stories from '@/lib/stories-we-carry-first-edition.json'
import { primaryButtonClass, secondaryButtonClass, helperTextClass } from '@/app/profile/ui'

const MAX_IMAGE = 20 * 1024 * 1024
const MAX_VIDEO = 30 * 1024 * 1024

type ImportRow = (typeof stories)[number] & {
  key: string
  still?: File
  video?: File
  problem?: string
  existing: boolean
}

function compact(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** The source motion names vary (some use titles, some only country/city),
 * but each country occurs exactly once in this 35-card edition. */
function matchVideo(country: string, files: File[]): File[] {
  const token = compact(country)
  return files.filter((file) =>
    file.name.toLowerCase().endsWith('.mp4') &&
    compact(file.name.replace(/^\d{2}-/, '')).startsWith(token)
  )
}

export default function StoriesWeCarryImport({ existingPostcards }: {
  existingPostcards: Pick<AdminPostcard, 'key' | 'isActive'>[]
}) {
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [completed, setCompleted] = useState<string[]>([])
  const [includeReviewed, setIncludeReviewed] = useState(false)
  const [reviewConfirmed, setReviewConfirmed] = useState(false)
  const [activated, setActivated] = useState<string[]>([])

  const rows: ImportRow[] = useMemo(() => {
    const known = new Set([...existingPostcards.map((p) => p.key), ...completed])
    return stories.map((story) => {
      const key = `stories_we_carry_01_${story.sequence}`
      const stills = files.filter((f) => f.name === story.stillFilename)
      const videos = matchVideo(story.country, files)
      const still = stills[0]
      const video = videos[0]
      const problem = files.length === 0 ? undefined
        : stills.length !== 1 ? `Expected one still; found ${stills.length}`
        : videos.length !== 1 ? `Expected one motion file; found ${videos.length}`
        : still.size > MAX_IMAGE ? 'Still exceeds 20 MiB'
        : video.size > MAX_VIDEO ? 'Motion exceeds 30 MiB'
        : still.type !== 'image/png' ? 'Still must be PNG'
        : video.type !== 'video/mp4' ? 'Motion must be MP4'
        : undefined
      return { ...story, key, still, video, problem, existing: known.has(key) }
    })
  }, [files, existingPostcards, completed])

  const pending = rows.filter((r) => (!r.reviewRequired || includeReviewed) && !r.existing)
  const ready = files.length > 0 && pending.every((r) => !r.problem) && pending.length > 0
  const staged = rows.filter((r) => r.existing && !activated.includes(r.key) &&
    (completed.includes(r.key) || existingPostcards.some((p) => p.key === r.key && !p.isActive)))

  async function importCards() {
    if (!ready) return
    setBusy(true)
    setError('')
    const supabase = createClient()
    for (const [index, row] of pending.entries()) {
      setProgress(`${index + 1} of ${pending.length}: ${row.country} · ${row.location}`)
      const image = await uploadPostcardArtworkStill(supabase, row.key, row.still!)
      if (!image.path || image.error) {
        setError(`${row.sequence} ${row.country}: ${image.error || 'still upload failed'}`)
        break
      }
      const motion = await uploadPostcardArtworkVideo(supabase, row.key, row.video!)
      if (!motion.path || motion.error) {
        setError(`${row.sequence} ${row.country}: ${motion.error || 'motion upload failed'}`)
        break
      }
      const result = await addPostcard(supabase, row.key, row.countryCode, {
        title: row.title,
        location: `${row.location}, ${row.country}`,
        collection: 'Stories We Carry · First Edition',
        postmarkText: row.postmark,
        footerText: 'Tempa Postcard · Stories We Carry · First Edition',
        storyText: row.storyText,
        frontImagePath: image.path,
        motionSrc: motion.path,
      }, true)
      if (result.error) {
        setError(`${row.sequence} ${row.country}: ${result.error.message}`)
        break
      }
      setCompleted((current) => [...current, row.key])
    }
    setBusy(false)
    setProgress('')
    router.refresh()
  }

  async function activateReviewed() {
    if (!reviewConfirmed || staged.length === 0) return
    setBusy(true)
    setError('')
    const supabase = createClient()
    for (const [index, row] of staged.entries()) {
      setProgress(`Activating ${index + 1} of ${staged.length}: ${row.country}`)
      const result = await setPostcardActive(supabase, row.key, true)
      if (result.error) {
        setError(`${row.sequence} ${row.country}: ${result.error.message}`)
        break
      }
      setActivated((current) => [...current, row.key])
    }
    setProgress('')
    setBusy(false)
    router.refresh()
  }

  return (
    <details className="rounded-md border border-foreground/10 p-4">
      <summary className="cursor-pointer font-serif text-lg">Import Stories We Carry · First Edition</summary>
      <p className={`mt-3 ${helperTextClass}`}>
        Select the export folder on this computer. The files stay here until you start the import.
        Cards are imported inactive for preview, and interrupted imports can resume. Number 35, Lagos Eyo,
        is held until its cultural review is complete.
      </p>
      <label className={`mt-3 inline-flex cursor-pointer items-center ${secondaryButtonClass}`}>
        Select export folder
        <input type="file" multiple className="hidden" disabled={busy}
          {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          onChange={(event) => {
            setFiles(Array.from(event.target.files ?? []))
            setError('')
          }} />
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={includeReviewed} disabled={busy}
          onChange={(event) => setIncludeReviewed(event.target.checked)} />
        Include number 35 after cultural review is complete
      </label>
      {files.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className={helperTextClass}>{files.length} files selected · {pending.filter((r) => !r.problem).length} ready · {rows.filter((r) => r.existing).length} already imported · {includeReviewed ? 0 : 1} held</p>
          <ol className="max-h-72 space-y-1 overflow-y-auto text-xs">
            {rows.map((row) => (
              <li key={row.key}>
                {row.sequence}. {row.country} · {row.location} — {row.existing ? 'Imported' : row.reviewRequired && !includeReviewed ? 'Held for review' : row.problem ?? 'Ready'}
              </li>
            ))}
          </ol>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {progress && <p role="status" className="text-sm">Uploading {progress}</p>}
          <button type="button" className={primaryButtonClass} onClick={importCards} disabled={!ready || busy}>
            {busy ? 'Working…' : `Import ${pending.length} inactive postcards`}
          </button>
        </div>
      )}
      {staged.length > 0 && (
        <div className="mt-4 space-y-3 border-t border-foreground/10 pt-4">
          <p className={helperTextClass}>
            {staged.length} cards are staged. Use each card’s Preview control below to inspect its
            front, motion and back before making it available to members.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={reviewConfirmed} disabled={busy}
              onChange={(event) => setReviewConfirmed(event.target.checked)} />
            I have reviewed the staged postcards and their story backs
          </label>
          <button type="button" className={primaryButtonClass} onClick={activateReviewed}
            disabled={!reviewConfirmed || busy}>
            Activate {staged.length} reviewed postcards
          </button>
        </div>
      )}
    </details>
  )
}
