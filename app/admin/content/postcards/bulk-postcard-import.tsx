'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { addPostcard } from '@/lib/admin-postcards'
import {
  MAX_POSTCARD_SOURCE_IMAGE_BYTES,
  MAX_POSTCARD_VIDEO_BYTES,
  uploadPostcardArtworkImage,
  uploadPostcardArtworkVideo,
} from '@/lib/postcard-images'
import {
  inspectPostcardImportSelection,
  POSTCARD_IMPORT_COLLECTION,
  type PostcardImportEntry,
} from '@/lib/postcard-import-manifest'
import { helperTextClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'

type ImportState = {
  key: string
  status: 'waiting' | 'uploading' | 'complete' | 'failed'
  message?: string
}

export default function BulkPostcardImport({ existingKeys }: { existingKeys: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [states, setStates] = useState<ImportState[]>([])
  const [busy, setBusy] = useState(false)
  const byName = useMemo(() => new Map(files.map((file) => [file.name, file])), [files])
  const selection = useMemo(
    () =>
      inspectPostcardImportSelection(
        files.map((file) => file.name),
        new Set(existingKeys),
      ),
    [existingKeys, files],
  )
  const oversize = files.filter((file) =>
    file.name.toLowerCase().endsWith('.mp4')
      ? file.size > MAX_POSTCARD_VIDEO_BYTES
      : file.size > MAX_POSTCARD_SOURCE_IMAGE_BYTES,
  )
  const canImport =
    files.length > 0 && selection.ready.length > 0 && selection.missing.length === 0 && oversize.length === 0

  function update(key: string, status: ImportState['status'], message?: string) {
    setStates((current) => [...current.filter((item) => item.key !== key), { key, status, message }])
  }

  async function importEntry(entry: PostcardImportEntry) {
    const image = byName.get(entry.imageFilename)
    const motion = entry.motionFilename ? byName.get(entry.motionFilename) : undefined
    if (!image || (entry.motionFilename && !motion)) throw new Error('A required file disappeared from the selection.')
    const supabase = createClient()
    const imageUpload = await uploadPostcardArtworkImage(supabase, entry.key, image)
    if (!imageUpload.path) throw new Error(imageUpload.error ?? 'The still artwork could not be uploaded.')
    let motionPath: string | null = null
    if (motion) {
      const motionUpload = await uploadPostcardArtworkVideo(supabase, entry.key, motion)
      if (!motionUpload.path) throw new Error(motionUpload.error ?? 'The Living Reveal could not be uploaded.')
      motionPath = motionUpload.path
    }
    const result = await addPostcard(supabase, entry.key, entry.countryCode, {
      title: entry.title,
      location: entry.location,
      collection: POSTCARD_IMPORT_COLLECTION,
      postmarkText: `${entry.title.toUpperCase()}\n${entry.location.toUpperCase()}`,
      footerText: `Tempa Postcard · ${POSTCARD_IMPORT_COLLECTION}`,
      frontImagePath: imageUpload.path,
      motionSrc: motionPath,
      durationSeconds: motionPath ? 10 : null,
    })
    if (result.error) throw new Error(result.error.message)
  }

  async function startImport() {
    if (!canImport) return
    setBusy(true)
    setStates(selection.ready.map((entry) => ({ key: entry.key, status: 'waiting' })))
    for (const entry of selection.ready) {
      update(entry.key, 'uploading')
      try {
        await importEntry(entry)
        update(entry.key, 'complete')
      } catch (error) {
        update(entry.key, 'failed', error instanceof Error ? error.message : 'Import failed.')
        setBusy(false)
        router.refresh()
        return
      }
    }
    setBusy(false)
    router.refresh()
  }

  if (!open)
    return (
      <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Tempa Places — First Edition</h2>
            <p className={helperTextClass}>Safely validate and install the 36-design artwork folder.</p>
          </div>
          <button type="button" className={secondaryButtonClass} onClick={() => setOpen(true)}>
            Import collection
          </button>
        </div>
      </div>
    )

  return (
    <section className="space-y-4 rounded-lg border border-foreground/10 p-4" aria-labelledby="bulk-import-title">
      <div>
        <h2 id="bulk-import-title" className="text-lg font-semibold">
          Import Tempa Places — First Edition
        </h2>
        <p className={helperTextClass}>
          Select the postcards folder. Tempa checks every pairing before it uploads a single file.
        </p>
      </div>
      <label className={`inline-flex cursor-pointer items-center ${secondaryButtonClass}`}>
        {files.length > 0 ? 'Choose folder again' : 'Choose postcards folder'}
        <input
          type="file"
          multiple
          accept="image/png,video/mp4"
          className="hidden"
          onChange={(event) => {
            setFiles(event.target.files ? Array.from(event.target.files) : [])
            setStates([])
          }}
          {...({
            webkitdirectory: '',
            directory: '',
          } as React.InputHTMLAttributes<HTMLInputElement>)}
        />
      </label>
      {files.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Summary label="Ready" value={selection.ready.length} />
          <Summary label="Already installed" value={selection.skipped.length} />
          <Summary label="Missing files" value={selection.missing.length} alert={selection.missing.length > 0} />
          <Summary label="Extra files" value={selection.unrecognized.length} />
        </div>
      )}
      {selection.missing.length > 0 && <IssueList title="Required files missing" items={selection.missing} />}
      {oversize.length > 0 && (
        <IssueList title="Files over the 20 MB upload limit" items={oversize.map((file) => file.name)} />
      )}
      {selection.unrecognized.length > 0 && (
        <IssueList title="Extra files (safely ignored)" items={selection.unrecognized} />
      )}
      {selection.ignored.length > 0 && (
        <p className={helperTextClass}>Known duplicate safely ignored: {selection.ignored.join(', ')}</p>
      )}
      {states.length > 0 && (
        <div className="max-h-64 space-y-1 overflow-auto rounded-md border border-foreground/10 p-3" aria-live="polite">
          {states.map((state) => (
            <p key={state.key} className={`text-sm ${state.status === 'failed' ? 'text-red-600' : ''}`}>
              {state.status === 'complete'
                ? '✓'
                : state.status === 'uploading'
                  ? 'Uploading'
                  : state.status === 'failed'
                    ? 'Failed'
                    : 'Waiting'}{' '}
              · {state.key}
              {state.message ? ` — ${state.message}` : ''}
            </p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={busy}
          onClick={() => {
            setOpen(false)
            setFiles([])
            setStates([])
          }}
        >
          Close
        </button>
        <button type="button" className={primaryButtonClass} disabled={!canImport || busy} onClick={startImport}>
          {busy ? 'Importing…' : `Import ${selection.ready.length} postcard${selection.ready.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </section>
  )
}

function Summary({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div
      className={`rounded-md border p-3 ${alert ? 'border-red-300 bg-red-50 text-red-800' : 'border-foreground/10'}`}
    >
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
    </div>
  )
}

function IssueList({ title, items }: { title: string; items: string[] }) {
  return (
    <details className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      <summary className="cursor-pointer font-medium">
        {title} ({items.length})
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  )
}
