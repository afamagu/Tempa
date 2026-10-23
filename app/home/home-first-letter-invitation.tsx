'use client'
import { useEffect,useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { primaryButtonClass,quietLinkClass } from '@/app/profile/ui'
export default function HomeFirstLetterInvitation({userId}:{userId:string}){
  const t=useTranslations('FirstLetterHome')
  const key=`tempa.first-letter.invitation.dismissed:${userId}`
  const [visible,setVisible]=useState(false)
  useEffect(()=>{
    let cancelled=false
    queueMicrotask(()=>{
      if(cancelled)return
      try{setVisible(window.localStorage.getItem(key)!=='1')}catch{setVisible(true)}
    })
    return ()=>{cancelled=true}
  },[key])
  if(!visible)return null
  return <section className="rounded-xl border border-accent/25 bg-surface-shell p-5 sm:p-6" aria-label={t('heading')}>
    <h2 className="font-serif text-[24px] leading-snug">{t('heading')}</h2>
    <p className="mt-2 text-[14px] leading-relaxed text-foreground/75">{t('lead')}</p>
    <div className="mt-5 flex flex-wrap items-center gap-4">
      <Link className={primaryButtonClass} href="/board/guided">{t('cta')} →</Link>
      <button type="button" className={quietLinkClass} onClick={()=>{
        try{window.localStorage.setItem(key,'1')}catch{}
        setVisible(false)
      }}>{t('dismiss')}</button>
    </div>
  </section>
}
