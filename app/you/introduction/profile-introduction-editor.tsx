'use client'
import { useEffect, useState, useRef } from 'react'
import { useLocale } from 'next-intl'
import { PROFILE_INTRODUCTION_COPY, writingLocale } from '@/lib/guided-writing-copy'
import Link from 'next/link'
import { useEditorVisualViewport } from '@/app/letters/use-editor-visual-viewport'
import { createClient } from '@/lib/supabase/client'
import { assemblePersonalIntroduction } from '@/lib/guided-open-letter'
import { primaryButtonClass, quietLinkClass } from '@/app/profile/ui'
const MAX_LENGTH = 600
const MIN_LENGTH = 30
type Status = 'none'|'pending'|'visible'|'hidden'
const DRAFT_KEY_PREFIX = 'tempa:profile-introduction-draft:'

export default function ProfileIntroductionEditor({ userId, initialBody, status: initialStatus }: {
  userId:string, initialBody:string, status:Status
}) {
  const rootRef = useRef<HTMLElement | null>(null)
  useEditorVisualViewport(rootRef)
  const copy = PROFILE_INTRODUCTION_COPY[writingLocale(useLocale())]
  const [first,setFirst] = useState(initialBody.split(/\n\n/)[0] ?? '')
  const [second,setSecond] = useState(initialBody.split(/\n\n/).slice(1).join('\n\n'))
  const [status,setStatus] = useState(initialStatus)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [ready,setReady] = useState(false)
  const [saved,setSaved] = useState(false)
  const body=assemblePersonalIntroduction([first,second])

  useEffect(()=>{
    let active=true
    queueMicrotask(()=>{
    if(!active)return
    try {
      const raw=localStorage.getItem(DRAFT_KEY_PREFIX + userId)
      if(raw) {
        const draft: unknown = JSON.parse(raw)
        if(draft && typeof draft==='object') {
          const v=draft as Record<string, unknown>
          if(typeof v.first==='string' && typeof v.second==='string' && v.first.length+v.second.length<=MAX_LENGTH){
            setFirst(v.first);setSecond(v.second)
          }
        }
      }
    } catch { /* Keep stored server version. */ }
    setReady(true)
    })
    return ()=>{active=false}
  },[userId])
  useEffect(()=>{
    if(!ready) return
    try { localStorage.setItem(DRAFT_KEY_PREFIX+userId,JSON.stringify({first,second})) } catch {}
  },[ready,userId,first,second])

  async function submit() {
    if(busy || body.length<MIN_LENGTH || body.length>MAX_LENGTH) return
    setBusy(true);setError('');setSaved(false)
    try {
      const {error: rpcError} = await createClient().rpc('submit_my_profile_introduction',{p_body:body})
      if(rpcError) throw new Error(copy.submitError)
      try {localStorage.removeItem(DRAFT_KEY_PREFIX+userId)}catch{}
      setStatus('pending');setSaved(true)
    }catch(e){setError(e instanceof Error?e.message:copy.retry)}
    finally{setBusy(false)}
  }
  async function hide() {
    if(busy) return
    setBusy(true);setError('')
    try {
      const {error:rpcError}=await createClient().rpc('hide_my_profile_introduction')
      if(rpcError) throw new Error(copy.hideError)
      setStatus('hidden')
    } catch(e){setError(e instanceof Error?e.message:copy.retry)}
    finally{setBusy(false)}
  }

  return <main ref={rootRef} className="mx-auto min-h-[100svh] max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
    <Link href="/you" className={quietLinkClass}>← {copy.back}</Link>
    <div className="mt-10 border-b border-foreground/10 pb-7">
      <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-[#94745f]">{copy.eyebrow}</p>
      <h1 className="mt-4 font-serif text-[clamp(2.4rem,6vw,4rem)] leading-tight">{copy.heading}</h1>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-foreground/75">{copy.lead}</p>
    </div>
    <div className="mt-8 space-y-7">
      {copy.prompts.map((prompt,i)=><label className="block" htmlFor={`personal-intro-${i}`} key={prompt}>
        <span className="font-serif text-[25px]">{prompt}</span>
        <textarea id={`personal-intro-${i}`} rows={4} maxLength={MAX_LENGTH} value={i===0?first:second}
          onChange={e=>{if(i===0)setFirst(e.target.value);else setSecond(e.target.value);setSaved(false)}}
          className="mt-3 min-h-28 w-full resize-y rounded-lg border border-foreground/20 bg-surface-shell p-4 font-serif text-lg leading-relaxed focus-visible:outline-2 focus-visible:outline-accent"
          placeholder={i===0?copy.placeholders[0]:copy.placeholders[1]} />
      </label>)}
      <div className="flex flex-wrap justify-between gap-3 text-sm text-foreground/65">
        <span>{body.length < MIN_LENGTH ? copy.fewWords : copy.editable}</span>
        <span>{body.length} / {MAX_LENGTH}</span>
      </div>
      {body.length > MAX_LENGTH && <p role="alert" className="text-sm text-red-700">{copy.overLimit}</p>}
      <div className="rounded-xl border border-foreground/15 bg-surface-shell p-5">
        <p className="text-xs uppercase tracking-[.15em] text-foreground/55">{copy.preview}</p>
        <p className="mt-3 whitespace-pre-wrap font-serif text-[18px] leading-relaxed">{body || copy.placeholder}</p>
      </div>
      <p className="max-w-xl text-[13px] leading-relaxed text-foreground/65">
        {copy.consent}
      </p>
      {status==='pending'&&<p role="status" className="rounded-md bg-accent/10 p-4 text-sm">{copy.pending}</p>}
      {status==='visible'&&<p role="status" className="rounded-md bg-accent/10 p-4 text-sm">{copy.visible}</p>}
      {status==='hidden'&&<p className="text-sm text-foreground/65">{copy.hidden}</p>}
      {saved&&<p role="status" className="text-sm text-foreground/70">{copy.submitted}</p>}
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <button disabled={busy || !ready || body.length<MIN_LENGTH || body.length>MAX_LENGTH}
          onClick={()=>void submit()} className={primaryButtonClass}>{busy?copy.saving:copy.share} ↗</button>
        {(status==='visible'||status==='pending')&&<button type="button" disabled={busy} onClick={()=>void hide()} className={quietLinkClass}>{copy.hide}</button>}
        <Link href="/board" className={quietLinkClass}>{copy.later}</Link>
      </div>
    </div>
  </main>
}
