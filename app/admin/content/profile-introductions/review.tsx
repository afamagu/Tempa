'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
export default function ProfileIntroductionReview({entries}:{entries:{owner_id:string,pseudonym:string,body:string,submitted_at:string}[]}) {
 const router=useRouter();const [busy,setBusy]=useState<string|null>(null);const [error,setError]=useState('')
 async function review(user:string,approved:boolean){
  if(busy)return
  setBusy(user);setError('')
  try {
    const {error:e}=await createClient().rpc('admin_review_profile_intro',{p_owner:user,p_approve:approved})
    if(e)throw new Error('Could not record the review.')
    router.refresh()
  }catch(e){setError(e instanceof Error?e.message:'Could not review.')}finally{setBusy(null)}
 }
 return <section className="mt-8 space-y-5" aria-label="Pending profile introductions">
  {!entries.length&&<p className="text-sm">No introductions awaiting review.</p>}
  {entries.map(e=><article className="rounded-lg border border-foreground/15 bg-surface-shell p-5" key={e.owner_id}>
   <h2 className="font-serif text-xl">{e.pseudonym}</h2>
   <p className="mt-3 whitespace-pre-wrap font-serif text-lg leading-relaxed">{e.body}</p>
   <div className="mt-5 flex flex-wrap gap-4">
    <button type="button" disabled={busy!==null} className="min-h-11 rounded-md bg-accent px-5 text-accent-foreground" onClick={()=>void review(e.owner_id,true)}>Approve</button>
    <button type="button" disabled={busy!==null} className="min-h-11 rounded-md border border-foreground/20 px-5" onClick={()=>void review(e.owner_id,false)}>Reject</button>
   </div>
  </article>)}
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
 </section>
}
