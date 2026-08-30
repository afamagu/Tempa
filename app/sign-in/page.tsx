'use client'

import { useState, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'

function initialErrorMessage() {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  return params.get('error') === 'auth_failed'
    ? 'Something went wrong signing you in. Please try again.'
    : ''
}

export default function SignInPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  )
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage)
  const [googleLoading, setGoogleLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setErrorMessage('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setStatus('error')
      setErrorMessage(error.message)
    } else {
      setStatus('sent')
    }
  }

  async function handleGoogleSignIn() {
    setErrorMessage('')
    setGoogleLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setGoogleLoading(false)
      setErrorMessage('Could not start Google sign-in. Please try again.')
    }
    // On success the browser navigates away to Google, so there's no
    // further local state to set here.
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-sm w-full space-y-4 rounded-lg border border-black/10 dark:border-white/20 p-6">
        <h1 className="text-xl font-semibold">Sign in</h1>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          className="w-full rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {googleLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <div className="flex items-center gap-3 text-xs text-black/40 dark:text-white/40">
          <div className="h-px flex-1 bg-black/10 dark:bg-white/20" />
          or
          <div className="h-px flex-1 bg-black/10 dark:bg-white/20" />
        </div>

        {status === 'sent' ? (
          <p className="text-sm">
            Check <span className="font-medium">{email}</span> for a magic
            link to sign in.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md border border-black/10 dark:border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:focus:border-white/40"
            />
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full rounded-md border border-black/10 dark:border-white/20 px-3 py-2 text-sm font-medium hover:bg-black/[.04] dark:hover:bg-white/[.08] disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}

        {errorMessage && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {errorMessage}
          </p>
        )}
      </div>
    </main>
  )
}
