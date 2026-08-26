import { createClient } from '@/lib/supabase/server'

async function checkAuthHealth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      cache: 'no-store',
    })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, status: null, error: (err as Error).message }
  }
}

async function checkRestApiKey() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

  try {
    // A nonexistent table still proves the key was accepted: PostgREST
    // returns 404/PGRST205 (schema cache) for a bad table name, but 401
    // for a bad or missing API key. Only `apikey` is needed here — the
    // publishable key is not a JWT, so it must not be sent as a Bearer
    // token in Authorization.
    const res = await fetch(`${url}/rest/v1/_connection_check?select=*`, {
      headers: { apikey: key },
      cache: 'no-store',
    })
    return { ok: res.status !== 401, status: res.status }
  } catch (err) {
    return { ok: false, status: null, error: (err as Error).message }
  }
}

export default async function SupabaseTestPage() {
  const [auth, rest] = await Promise.all([checkAuthHealth(), checkRestApiKey()])

  const supabase = await createClient()
  const { error: authError } = await supabase.auth.getSession()

  const connected = auth.ok && rest.ok && !authError

  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const keyDefined = rawKey !== undefined && rawKey !== ''
  const keyLength = rawKey?.length ?? 0

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md w-full space-y-4 rounded-lg border border-black/10 dark:border-white/20 p-6">
        <h1 className="text-xl font-semibold">Supabase Connection Test</h1>

        <div
          className={`rounded-md p-3 text-sm ${
            connected
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
          }`}
        >
          {connected ? '✅ Connected to Supabase' : '❌ Connection failed'}
        </div>

        <dl className="text-sm space-y-2">
          <div className="flex justify-between">
            <dt className="text-black/60 dark:text-white/60">Project URL</dt>
            <dd className="font-mono text-xs">
              {process.env.NEXT_PUBLIC_SUPABASE_URL}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-black/60 dark:text-white/60">Auth service</dt>
            <dd>{auth.status ?? auth.error ?? 'unreachable'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-black/60 dark:text-white/60">REST API key</dt>
            <dd>{rest.status ?? rest.error ?? 'unreachable'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-black/60 dark:text-white/60">Auth client</dt>
            <dd>{authError ? authError.message : 'OK'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-black/60 dark:text-white/60">
              Publishable key defined
            </dt>
            <dd>{keyDefined ? 'yes' : 'no'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-black/60 dark:text-white/60">
              Publishable key length
            </dt>
            <dd>{keyLength}</dd>
          </div>
        </dl>
      </div>
    </main>
  )
}
