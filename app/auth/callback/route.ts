import { createClient } from '@/lib/supabase/server'
import { sanitizeInternalPath } from '@/lib/safe-redirect'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')
  // Return-to-requested-page after sign-in (pre-beta UX polish batch 1)
  // — re-validated HERE, server-side, regardless of where this `next`
  // came from: this is the actual security boundary, since anyone can
  // craft their own callback URL with an arbitrary `next` value,
  // whether or not this app's own sign-in page happened to generate it.
  const next = sanitizeInternalPath(searchParams.get('next'))

  if (oauthError) {
    console.error('[auth/callback] provider returned an error', {
      error: oauthError,
      description: searchParams.get('error_description'),
    })
    return NextResponse.redirect(`${origin}/sign-in?error=auth_failed`)
  }

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', data.user.id)
        .maybeSingle()

      // A new member still without a profile must always continue
      // through onboarding — `next` is only ever honored for a
      // returning, already-onboarded member, never used to bypass this.
      const destination = profile ? (next ?? '/home') : '/profile'
      return NextResponse.redirect(`${origin}${destination}`)
    }

    if (error) {
      console.error('[auth/callback] code exchange failed', {
        message: error.message,
        code: error.code,
      })
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth_failed`)
}
