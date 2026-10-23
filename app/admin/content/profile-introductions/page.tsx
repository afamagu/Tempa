import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ProfileIntroductionReview from './review'
import ContentTabs from '../content-tabs'

export default async function AdminProfileIntroductionPage() {
  const supabase = await createClient()
  const {data:{user}}=await supabase.auth.getUser()
  if(!user) redirect('/sign-in')
  const {data:allowed}=await supabase.rpc('is_staff',{p_min_role:'admin'})
  if(allowed!==true) redirect('/home')
  const {data,error}=await supabase.rpc('admin_pending_profile_intros',{p_limit:30})
  return <main className="mx-auto max-w-4xl px-5 py-12">
    <ContentTabs />
    <h1 className="mt-8 font-serif text-4xl">Profile introductions · Review</h1>
    <p className="mt-3 text-sm text-foreground/65">Review member-approved public words before they become discoverable.</p>
    {error?<p role="alert" className="mt-6">Unable to load introductions for review.</p>
      :<ProfileIntroductionReview entries={(data ?? []) as {owner_id:string,pseudonym:string,body:string,submitted_at:string}[]} />}
  </main>
}
