import type { SupabaseClient } from '@supabase/supabase-js'

/** Direct Storage upload avoids Vercel request limits; no service key or original footage. */
export async function uploadVideoClip(supabase: SupabaseClient, path: string, clip: Blob,
  signal: AbortSignal, onProgress: (percent: number) => void): Promise<void> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error('Your session has expired. Sign in again to attach this video.')
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const finish = () => signal.removeEventListener('abort', abort)
    xhr.open('POST', `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/letter-photos/${path.split('/').map(encodeURIComponent).join('/')}`)
    xhr.setRequestHeader('Authorization', `Bearer ${data.session!.access_token}`)
    xhr.setRequestHeader('apikey', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    xhr.setRequestHeader('Content-Type', 'video/mp4')
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.timeout = 120_000
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)) }
    xhr.onload = () => {
      finish()
      if (xhr.status >= 200 && xhr.status < 300) { resolve(); return }
      // Retrying the same UUID after an uncertain network result never creates a second object.
      if (xhr.status === 409) { resolve(); return }
      let detail = ''
      try { detail = String(JSON.parse(xhr.responseText).message ?? '') } catch { /* non-JSON gateway response */ }
      if (/mime|type.*not.*supported/i.test(detail)) reject(new Error('Video uploads are not enabled yet. Your selection is kept; please try again after Tempa’s video update.'))
      else if (xhr.status === 401 || xhr.status === 403) reject(new Error('Video upload was denied. Check that you are signed in and this correspondence allows Moments.'))
      else reject(new Error(`Video upload failed (${xhr.status}${detail ? `: ${detail.slice(0, 160)}` : ''}). Your selection is kept. Try again.`))
    }
    xhr.onerror = () => { finish(); reject(new Error('The connection was interrupted. Your selection is kept. Check your connection and retry.')) }
    xhr.ontimeout = () => { finish(); reject(new Error('The upload took too long. Your selection is kept. Check your connection and retry.')) }
    xhr.onabort = () => { finish(); reject(new DOMException('Upload cancelled', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    xhr.send(clip)
  })
}
