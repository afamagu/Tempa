'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import batch from '@/docs/product/premium-postcards-batch-1.json'
import { helperTextClass, primaryButtonClass } from '@/app/profile/ui'

const assets = batch.postcards.flatMap((p) => [
  { name: `${p.slug}.jpg`, path: p.imagePath, sha: p.imageSha256, type: 'image/jpeg' },
  { name: `${p.slug}.mp4`, path: p.motionPath, sha: p.motionSha256, type: 'video/mp4' },
])
async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')
}

/** Uses only the existing admin Storage policies; no keys or new upload API. */
export default function PremiumBatchUpload() {
  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState('')
  const selectedCount = files.length
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  async function upload() {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      const supabase = createClient()
      const { data: admin, error } = await supabase.rpc('is_staff', { p_min_role: 'admin' })
      if (error || admin !== true) throw new Error('Sign in as a Tempa admin to upload this batch.')
      const byName = new Map(files.map((file) => [file.name, file]))
      if (byName.size !== files.length) throw new Error('Duplicate filenames were selected. Combine the five archives into one clean folder.')
      if (files.length !== assets.length) throw new Error(`Choose exactly ${assets.length} prepared files; selected ${files.length}. Do not include old versions or the held cards.`)
      // Validate the entire batch before the first write.
      for (const asset of assets) {
        setStatus(`Checking ${asset.name}`)
        const file = byName.get(asset.name)
        if (!file || file.size > 20 * 1024 * 1024 || await sha256(file) !== asset.sha)
          throw new Error(`Select the reviewed prepared file: ${asset.name}`)
      }
      let completed = 0
      for (const asset of assets) {
        setStatus(`Uploading ${completed + 1} of ${assets.length}: ${asset.name}`)
        const file = byName.get(asset.name)!
        const { error: uploadError } = await supabase.storage.from('postcard-artwork').upload(asset.path, file, {
          contentType: asset.type, upsert: false, cacheControl: '31536000',
        })
        if (uploadError) {
          // A retry can reuse only a byte-identical object, never replace artwork.
          const { data: existing, error: readError } = await supabase.storage.from('postcard-artwork').download(asset.path)
          if (readError || !existing || await sha256(existing) !== asset.sha) throw new Error(uploadError.message)
        }
        completed++
      }
      setStatus(`Upload complete: ${completed} verified assets. Catalogue publication can now proceed.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload stopped. Select the same files to resume.')
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return <section aria-labelledby="premium-upload-title" className="space-y-3 rounded-lg border border-foreground/10 p-4">
    <h2 id="premium-upload-title" className="text-lg font-semibold">Premium postcards — Batch 1</h2>
    <p className={helperTextClass}>46 reviewed designs: six complimentary, 40 premium. Each has a still and a motion. Lady Larkspur is removed; Guest Room 13 is withheld. Extract all five prepared archives into one folder and choose that folder (92 JPG/MP4 files).</p>
    <label className="block text-sm font-medium">Prepared postcard folder
      <input type="file" multiple accept="image/jpeg,video/mp4" aria-label="Prepared premium postcard folder" disabled={busy} onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setStatus('') }} {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} />
    </label>
    <p className={helperTextClass}>{selectedCount} of {assets.length} reviewed files selected. Uploads never overwrite existing artwork; safe retries verify identical bytes.</p>
    <button type="button" disabled={busy || files.length !== assets.length} className={primaryButtonClass} onClick={upload}>{busy ? 'Uploading…' : 'Upload reviewed premium batch'}</button>
    <p role="status" aria-live="polite" className={helperTextClass}>{status}</p>
  </section>
}
