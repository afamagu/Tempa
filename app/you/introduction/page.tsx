import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import IntroductionEditor from './introduction-editor'
export default async function ProfileIntroductionPage() {
  const supabase=await createClient()
  const {data:{user}}=await supabase.auth.getUser()
  if(!user)redirect('/sign-in')
  const [{data:profile},{data:question}]=await Promise.all([
    supabase.from('profiles').select('mark_id').eq('id',user.id).maybeSingle(),
    supabase.from('questions').select('id').eq('slug','tempa-profile-introduction').eq('is_active',true).maybeSingle(),
  ])
  if(!profile)redirect('/profile')
  if(!profile.mark_id)redirect('/you/mark')
  if(!question)return <main className="mx-auto max-w-xl space-y-5 px-5 py-20"><h1 className="font-serif text-3xl">Your introduction</h1><p>This space is temporarily unavailable.</p><Link href="/board/write/guided" className="underline">Start an open letter</Link></main>
  const {data:answer}=await supabase.from('question_answers').select('body,profile_intro_visible,moderation_status').eq('user_id',user.id).eq('question_id',question.id).maybeSingle()
  return <IntroductionEditor userId={user.id} questionId={question.id} initialBody={answer?.body??''} initialVisible={answer?.profile_intro_visible??false} moderated={answer?.moderation_status==='hidden'}/>
}
