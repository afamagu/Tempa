'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { evaluateSafety, SAFETY_CHECK_FAILED_MESSAGE, SAFETY_CANNOT_SEND_MESSAGE } from '@/lib/safety/send-with-safety'
import SafetyWarningDialog from '@/app/safety-warning-dialog'
import { primaryButtonClass, quietLinkClass, helperTextClass } from '@/app/profile/ui'

const LIMIT=750
function makeBody(a:string,b:string){return [a.trim(),b.trim()].filter(Boolean).join('\n\n')}
export default function IntroductionEditor({userId,questionId,initialBody,initialVisible,moderated}:{
 userId:string;questionId:string;initialBody:string;initialVisible:boolean;moderated:boolean
}){
 const [firstInitial,...rest]=initialBody.split('\n\n')
 const [first,setFirst]=useState(firstInitial??'')
 const [second,setSecond]=useState(rest.join('\n\n'))
 const [visible,setVisible]=useState(initialVisible)
 const [published,setPublished]=useState(Boolean(initialBody))
 const [dirty,setDirty]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState<string|null>(null)
 const [warning,setWarning]=useState<{id:string;copyKey?:string}|null>(null)
 const verified=useRef<string|null>(null)
 const router=useRouter()
 const body=makeBody(first,second)
 const draftKey=`tempa-profile-intro-draft:${userId}`
 useEffect(()=>{
  try {
   const raw=window.localStorage.getItem(draftKey)
   if(!raw)return
   const pending=JSON.parse(raw) as {first?:unknown;second?:unknown}
   // eslint-disable-next-line react-hooks/set-state-in-effect
   if(typeof pending.first==='string')setFirst(pending.first.slice(0,LIMIT))
   // eslint-disable-next-line react-hooks/set-state-in-effect
   if(typeof pending.second==='string')setSecond(pending.second.slice(0,LIMIT))
   // eslint-disable-next-line react-hooks/set-state-in-effect
   setDirty(true)
  } catch { /* Keep the original saved introduction. */ }
 },[draftKey])
 function edit(which:'first'|'second',value:string){
  if(which==='first')setFirst(value.slice(0,LIMIT));else setSecond(value.slice(0,LIMIT))
  setDirty(true);setError(null);verified.current=null
  const pendingFirst=which==='first'?value.slice(0,LIMIT):first
  const pendingSecond=which==='second'?value.slice(0,LIMIT):second
  try{window.localStorage.setItem(draftKey,JSON.stringify({first:pendingFirst,second:pendingSecond}))}
  catch{setError('Your browser cannot save this draft. Keep the page open until you finish.')}
 }
 async function evaluate(){
  if(!body||busy||moderated)return
  setBusy(true);setError(null)
  const out=await evaluateSafety({surface:'question_answer',questionId,body})
  setBusy(false)
  if(out.status==='error'){setError(SAFETY_CHECK_FAILED_MESSAGE);return}
  if(out.status==='cannot_send'){setError(SAFETY_CANNOT_SEND_MESSAGE);return}
  verified.current=body
  if(out.status==='warning_required'){setWarning({id:out.evaluationId,copyKey:out.copyKey});return}
  await publish(out.evaluationId,false)
 }
 async function publish(evaluationId:string,warningAcknowledged:boolean){
  if(!verified.current||verified.current!==makeBody(first,second)){setError('Your words changed. Review and publish again.');setWarning(null);return}
  setBusy(true);setError(null)
  const supabase=createClient()
  const {error:saveError}=await supabase.rpc('publish_question_answer',{p_question_id:questionId,p_body:verified.current,p_safety_evaluation_id:evaluationId,p_warning_acknowledged:warningAcknowledged})
  if(saveError){setBusy(false);setError('Could not save your introduction. Please try again.');return}
  const {error:visibleError}=await supabase.rpc('set_my_profile_intro_visibility',{p_visible:true})
  setBusy(false);setWarning(null)
  if(visibleError){setError('Saved privately, but publishing was not completed. Please retry.');return}
  setPublished(true);setVisible(true);setDirty(false)
  try{window.localStorage.removeItem(draftKey)}catch{}
  router.refresh()
 }
 async function toggle(show:boolean){
  setBusy(true);setError(null)
  const {error:err}=await createClient().rpc('set_my_profile_intro_visibility',{p_visible:show})
  setBusy(false)
  if(err){setError('Could not change visibility. Please try again.');return}
  setVisible(show);router.refresh()
 }
 return <main className="mx-auto min-h-[100svh] max-w-2xl px-5 pb-20 pt-12 sm:px-9 sm:pt-20">
  <Link href="/you" className={quietLinkClass}>← You</Link>
  <p className="mt-12 text-[11px] font-semibold uppercase tracking-[.22em] text-[#94745f]">YOUR INTRODUCTION</p>
  <h1 className="mt-3 font-serif text-[clamp(2.2rem,5vw,3.5rem)] leading-[1.1]">A few words can be enough.</h1>
  <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-foreground/70">Not ready to leave an open letter? A short introduction can still give someone a reason to write.</p>
  {moderated?<p role="alert" className="mt-10 text-[15px]">This introduction has been restricted by Tempa and cannot be edited.</p>:
   <section className="mt-10 space-y-7 rounded-xl border border-foreground/10 bg-surface-shell p-5 sm:p-8">
    <label className="block space-y-3"><span className="block font-serif text-[22px]">What brings you to Tempa?</span><textarea rows={4} maxLength={LIMIT} value={first} onChange={e=>edit('first',e.target.value)} placeholder="I'm here because…" className="w-full resize-y rounded-md border border-foreground/20 bg-background p-4 font-serif text-[18px] leading-relaxed outline-none focus:border-accent"/></label>
    <label className="block space-y-3"><span className="block font-serif text-[22px]">What do you enjoy talking or writing about?</span><textarea rows={4} maxLength={LIMIT} value={second} onChange={e=>edit('second',e.target.value)} placeholder="I could talk about…" className="w-full resize-y rounded-md border border-foreground/20 bg-background p-4 font-serif text-[18px] leading-relaxed outline-none focus:border-accent"/></label>
    <p className={helperTextClass}>This appears on your profile, not The Board. Nothing is shared until you publish it.</p>
    {body&&<div className="space-y-3 border-t border-foreground/10 pt-6"><p className="text-[11px] uppercase tracking-[.17em] text-[#94745f]">YOUR WORDS</p><p className="whitespace-pre-wrap font-serif text-[19px] leading-relaxed">{body}</p></div>}
    {published&&<p role="status" className={helperTextClass}>{dirty&&visible?'Your earlier published version remains visible until you publish these changes.':visible?'Visible to other eligible members.':'Hidden from other members.'}</p>}
    {error&&<p role="alert" className="text-[14px] text-red-700">{error}</p>}
    <div className="flex flex-wrap items-center gap-5">
     <button type="button" disabled={busy||!body} onClick={()=>void evaluate()} className={primaryButtonClass}>{busy?'Saving…':'Publish my introduction'} ↗</button>
     {published&&visible&&<button type="button" disabled={busy} onClick={()=>void toggle(false)} className={quietLinkClass}>Hide from others</button>}
     {published&&!visible&&<button type="button" disabled={busy} onClick={()=>void toggle(true)} className={quietLinkClass}>Show my introduction</button>}
     <Link href={`/room/${userId}`} className={quietLinkClass}>View my profile</Link>
    </div>
   </section>}
  <SafetyWarningDialog open={warning!==null} copyKey={warning?.copyKey} sending={busy} actionLabel="Publish anyway" onCancel={()=>setWarning(null)} onAcknowledgeAndSend={()=>{if(warning)void publish(warning.id,true)}} />
 </main>
}
