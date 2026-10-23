import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ProfileIntroductionEditor from './profile-introduction-editor'

export default async function YourIntroductionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fyou%2Fintroduction')
  const { data: intro, error: introError } = await supabase
    .from('profile_introductions')
    .select('answer_id,is_published,approved_at')
    .eq('owner_id',user.id).maybeSingle()
  if (introError) return <main className="mx-auto max-w-xl px-6 py-20">
    <h1 className="font-serif text-3xl">Your introduction</h1>
    <p className="mt-4">This page is temporarily unavailable. Your letters and profile are unchanged.</p>
    <Link href="/you" className="mt-6 inline-block underline">Back to You</Link>
  </main>
  const { data: answer } = intro
    ? await supabase.from('question_answers')
        .select('body,moderation_status').eq('id',intro.answer_id).eq('user_id',user.id).maybeSingle()
    : { data: null }
  const status = !intro ? 'none'
    : !intro.is_published ? 'hidden'
    : intro.approved_at && answer?.moderation_status === 'visible' ? 'visible'
    : 'pending'
  return <ProfileIntroductionEditor
    userId={user.id} initialBody={answer?.body ?? ''} status={status} />
}
