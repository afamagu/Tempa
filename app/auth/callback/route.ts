import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')

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

      return NextResponse.redirect(`${origin}${profile ? '/home' : '/profile'}`)
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
