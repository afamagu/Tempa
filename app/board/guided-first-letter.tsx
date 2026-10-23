'use client'
import { useEffect,useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { WRITING_STARTERS,type StarterId,assembleGuidedLetter,canContinueGuidedWriting } from '@/lib/guided-open-letter'
import { sendGuidedDraftToBoard } from '@/lib/guided-letter-handoff'
import { primaryButtonClass,quietLinkClass,helperTextClass } from '@/app/profile/ui'

type Saved = { starterId:StarterId|null; answers:[string,string,string]; step:number }
export default function GuidedFirstLetter({userId}:{userId:string}) {
  const t=useTranslations('GuidedWriting')
  const router=useRouter()
  const key=`tempa-guided-first-letter:${userId}`
  const [starterId,setStarterId]=useState<StarterId|null>(null)
  const [answers,setAnswers]=useState<[string,string,string]>(['','',''])
  const [step,setStep]=useState(0)
  const [loaded,setLoaded]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [hasExistingDraft,setHasExistingDraft]=useState(false)
  const [saveFailed,setSaveFailed]=useState(false)
  useEffect(()=>{
    try {
      const json=window.localStorage.getItem(key)
      if(json){
        const stored=JSON.parse(json) as Saved
        if(WRITING_STARTERS.some(s=>s.id===stored.starterId)
           && Array.isArray(stored.answers)&&stored.answers.length===3
           && stored.answers.every(a=>typeof a==='string'&&a.length<=2800)){
          setStarterId(stored.starterId)
          setAnswers(stored.answers)
          setStep(Math.min(3,Math.max(0,Number(stored.step)||0)))
        }
      }
    } catch {/* Private mode may disable storage: writing still works. */}
    setLoaded(true)
  },[key])
  useEffect(()=>{
    if(!loaded)return
    try{window.localStorage.setItem(key,JSON.stringify({starterId,answers,step}))}
    catch{setSaveFailed(true)}
  },[loaded,key,starterId,answers,step])
  const starter=WRITING_STARTERS.find(s=>s.id===starterId)
  const ready=canContinueGuidedWriting(answers)
  const draft=starterId?assembleGuidedLetter(starterId,answers,t(`starters.${starterId}.suggestedTitle`)):null
  function commit(){
    if(!starterId||!draft||!ready)return
    setError(null)
    const status=sendGuidedDraftToBoard(userId,draft)
    if(status==='existing-draft'){setHasExistingDraft(true);return}
    if(status!=='saved'){setError(t('saveError'));return}
    try{window.localStorage.removeItem(key)}catch{}
    router.push('/board/write')
  }
  if(!loaded)return <main className="mx-auto max-w-2xl p-8" role="status">{t('loading')}</main>
  return <main className="mx-auto w-full max-w-2xl px-5 pb-24 pt-8 sm:px-8 sm:pt-14">
    <p className="text-[11px] font-semibold uppercase tracking-[.2em] text-[#94745f]">{t('eyebrow')}</p>
    <h1 className="mt-3 max-w-xl font-serif text-[clamp(2.4rem,6vw,3.8rem)] leading-tight tracking-[-.025em]">{t('heading')}</h1>
    <p className="mt-5 max-w-xl font-serif text-xl leading-relaxed text-foreground/75">{t('lead')}</p>

    {!starter&&<section className="mt-10" aria-labelledby="theme-heading">
      <h2 id="theme-heading" className="mb-5 font-serif text-2xl">{t('chooseTheme')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {WRITING_STARTERS.map(item=><button type="button" key={item.id}
          className="min-h-32 rounded-xl border border-foreground/15 bg-surface-shell p-5 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={()=>{setStarterId(item.id);setStep(0);setHasExistingDraft(false)}}>
          <strong className="block font-serif text-xl font-normal">{t(`starters.${item.id}.title`)}</strong>
          <span className="mt-3 block text-sm leading-relaxed text-foreground/65">{t(`starters.${item.id}.opening`)}</span>
        </button>)}
      </div>
      <button type="button" className={`mt-6 ${quietLinkClass}`} onClick={()=>router.push('/board/write')}>{t('writeFreely')} →</button>
    </section>}

    {starter&&step<3&&<section className="mt-10" aria-labelledby="prompt-heading">
      <p className="text-xs tracking-widest text-foreground/55">{t('progress',{current:step+1,total:3})}</p>
      <h2 id="prompt-heading" className="mt-4 font-serif text-3xl leading-snug">{t(`starters.${starter.id}.q${step+1}`)}</h2>
      <label className="mt-6 block">
        <span className="sr-only">{t('yourAnswer')}</span>
        <textarea rows={5} maxLength={2800} value={answers[step]} onChange={e=>setAnswers(current=>current.map((x,i)=>i===step?e.target.value:x) as [string,string,string])}
          className="block w-full resize-y rounded-xl border border-foreground/20 bg-surface-shell p-4 font-serif text-lg leading-relaxed focus-visible:outline-2 focus-visible:outline-accent"
          placeholder={t('placeholder')}/>
      </label>
      <div className="mt-7 flex flex-wrap items-center gap-5">
        <button type="button" className={primaryButtonClass} onClick={()=>setStep(x=>x+1)}>{step===2?t('viewDraft'):t('continue')} →</button>
        <button type="button" className={quietLinkClass} onClick={()=>step?setStep(step-1):setStarterId(null)}>{t('back')}</button>
        <button type="button" className={quietLinkClass} onClick={()=>setStep(x=>x+1)}>{t('skipQuestion')}</button>
      </div>
    </section>}

    {starter&&step===3&&<section className="mt-10 rounded-xl border border-foreground/15 bg-surface-shell p-6 sm:p-8" aria-label={t('review')}>
      <p className="text-xs uppercase tracking-widest text-foreground/55">{t('review')}</p>
      <h2 className="mt-4 font-serif text-3xl">{draft?.title}</h2>
      <div className="mt-6 space-y-4 font-serif text-lg leading-relaxed">
        {draft?.paragraphs.map((p,i)=><p key={i} className="whitespace-pre-wrap">{p}</p>)}
      </div>
      {!ready&&<p className="mt-5 text-sm text-foreground/70">{t('minAnswer')}</p>}
      {hasExistingDraft&&<div className="mt-6 space-y-4 rounded-xl border border-accent/40 p-5" role="alert">
        <p className="text-sm leading-relaxed">{t('existing')}</p>
        <button type="button" className={primaryButtonClass} onClick={()=>router.push('/board/write')}>{t('continueExisting')}</button>
        <button type="button" className={quietLinkClass} onClick={()=>setHasExistingDraft(false)}>{t('keepAnswers')}</button>
      </div>}
      {error&&<p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
      <div className="mt-8 flex flex-wrap items-center gap-5">
        <button type="button" disabled={!ready} className={primaryButtonClass} onClick={commit}>{t('editComposer')} →</button>
        <button type="button" className={quietLinkClass} onClick={()=>setStep(2)}>{t('changeAnswers')}</button>
      </div>
      <p className={`mt-5 ${helperTextClass}`}>{t('privacy')}</p>
    </section>}
    {saveFailed&&<p role="status" className="mt-7 text-sm text-amber-800">{t('storageWarning')}</p>}
  </main>
}
