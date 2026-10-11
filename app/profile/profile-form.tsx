'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import ISO6391 from 'iso-639-1'
import { createClient } from '@/lib/supabase/client'
import {
  COUNTRY_OPTIONS, LANGUAGE_OPTIONS, WRITING_STYLE_OPTIONS,
  findCountryIsoCode, type Option,
} from './data'
import SearchableSelect from './searchable-select'
import SearchableMultiSelect from './searchable-multi-select'
import ChoiceGroup from './choice-group'
import { fieldLabelClass, helperTextClass } from './ui'
import { isReservedPseudonym, RESERVED_PSEUDONYM_MESSAGE } from '@/lib/reserved-pseudonyms'

/** Basic identity only. No forced Mark, introduction essay, or typography choice. */
export default function ProfileForm({ userId }: { userId: string }) {
  const locale = useLocale()
  const t = useTranslations('ProfileSetup')
  const arrival = useTranslations('FirstArrivalProfile')
  const writingT = useTranslations('ProfileSetup.writingOptions')
  const writingDescription = useTranslations('ProfileSetup.writingDescriptions')
  const router = useRouter()

  const [pseudonym,setPseudonym] = useState('')
  const [nameStatus,setNameStatus] = useState<'idle'|'checking'|'reserved'|'taken'|'available'>('idle')
  const nameRequest=useRef(0)
  const [country,setCountry] = useState('')
  const [languages,setLanguages] = useState<string[]>([])
  const [aiPreference,setAiPreference] = useState('')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState<string|null>(null)
  const [suggestions,setSuggestions] = useState<string[]>([])

  const countryLabels = useMemo(() => {
    try { return new Intl.DisplayNames([locale],{type:'region'}) } catch { return null }
  },[locale])
  const languageLabels = useMemo(() => {
    try { return new Intl.DisplayNames([locale],{type:'language'}) } catch { return null }
  },[locale])
  const countries:Option[] = useMemo(() =>
    COUNTRY_OPTIONS.map(c => ({value:c.value,label:countryLabels?.of(c.isoCode)??c.label})),
    [countryLabels]
  )
  const languageOptions:Option[] = useMemo(() =>
    LANGUAGE_OPTIONS.map(x => {
      const code=ISO6391.getCode(x.value)
      return {value:x.value,label:(code&&languageLabels?.of(code))||x.label}
    }),[languageLabels])
  const writingOptions=WRITING_STYLE_OPTIONS.map(x => ({
    ...x,
    label:writingT(x.value as never),
    description:writingDescription(x.value as never),
  }))

  function changeName(next:string) {
    ++nameRequest.current
    setPseudonym(next)
    setSuggestions([])
    if(isReservedPseudonym(next)){
      setNameStatus('reserved')
      setError(t('reserved'))
    }else if(next.trim().length<3||next.trim().length>24||!/^[A-Za-z0-9 -]+$/.test(next.trim())){
      setNameStatus('idle')
      setError(null)
    }else{
      setNameStatus('checking')
      setError(null)
    }
  }

  useEffect(()=>{
    const name=pseudonym.trim()
    if(!name||isReservedPseudonym(name)||name.length<3||
       name.length>24||!/^[A-Za-z0-9 -]+$/.test(name))return
    const current=nameRequest.current
    let cancelled=false
    const timeout=setTimeout(async()=>{
      try {
        const {data, error}=await createClient().rpc('is_pseudonym_available',{candidate:name})
        if(cancelled||nameRequest.current!==current)return
        if(error){setNameStatus('idle');return}
        setNameStatus(data?'available':'taken')
        if(!data)setError(arrival('taken'))
      }catch{
        if(!cancelled&&nameRequest.current===current)setNameStatus('idle')
      }
    },500)
    return ()=>{cancelled=true;clearTimeout(timeout)}
  },[pseudonym,arrival])

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(busy||nameStatus==='checking'||nameStatus==='reserved'||nameStatus==='taken')return
    setError(null)
    setSuggestions([])
    const name=pseudonym.trim()
    if(name.length<3||name.length>24||!/^[A-Za-z0-9 -]+$/.test(name)){
      setError(arrival('nameError'))
      return
    }
    if(isReservedPseudonym(name)){setError(RESERVED_PSEUDONYM_MESSAGE);return}
    if(!country){setError(arrival('countryError'));return}
    if(!languages.length){setError(arrival('languagesError'));return}
    if(!WRITING_STYLE_OPTIONS.some(x=>x.value===aiPreference)){
      setError(arrival('writingError'))
      return
    }
    setBusy(true)
    try {
      const supabase=createClient()
      const {data:available,error:checkError}=await supabase.rpc('is_pseudonym_available',{candidate:name})
      if(checkError)throw new Error(arrival('checkError'))
      if(!available){
        const {data:alternatives}=await supabase.rpc('suggest_available_pseudonyms',{base:name,needed:3})
        setSuggestions(alternatives??[])
        throw new Error(arrival('taken'))
      }
      const {error:insertError}=await supabase.from('profiles').insert({
        id:userId,
        pseudonym:name,
        country,
        country_code:findCountryIsoCode(country),
        languages,
        ai_preference:aiPreference,
        onboarding_stage:'complete',
      })
      if(insertError){
        if(insertError.code==='23514'){
          setNameStatus('reserved')
          throw new Error(t('reserved'))
        }
        if(insertError.code==='23505')throw new Error(arrival('takenNow'))
        throw new Error(arrival('saveError'))
      }
      router.replace('/welcome')
      router.refresh()
    }catch(e){
      setBusy(false)
      setError(e instanceof Error?e.message:arrival('saveError'))
    }
  }

  return <main className="mx-auto flex min-h-[100svh] max-w-2xl flex-col justify-center px-6 py-14 sm:px-10">
    <header className="space-y-4">
      <p className="font-serif text-lg italic text-foreground/70">Tempa</p>
      <p className="pt-5 text-[11px] font-medium uppercase tracking-[.21em] text-[#94745f]">{arrival('eyebrow')}</p>
      <h1 className="font-serif text-[37px] font-normal leading-tight sm:text-[47px]">{arrival('title')}</h1>
      <p className="max-w-lg font-serif text-[19px] leading-relaxed text-foreground/75">
        {arrival('intro')}
      </p>
    </header>
    <form onSubmit={submit} className="mt-10 space-y-8">
      <div className="space-y-2">
        <label htmlFor="pseudonym" className={fieldLabelClass}>{t('nameLabel')}</label>
        <input id="pseudonym" value={pseudonym} onChange={e=>changeName(e.target.value)}
          autoComplete="off" maxLength={24} aria-invalid={nameStatus==='reserved'||nameStatus==='taken'} placeholder={t('namePlaceholder')}
          className="min-h-12 w-full rounded-md border border-foreground/20 bg-background px-4 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
        <p className={helperTextClass}>{t('nameHelp')}</p>
        {nameStatus==='checking'&&<p role="status" className={helperTextClass}>{t('checking')}</p>}
        {nameStatus==='available'&&<p role="status" className="text-sm text-accent">{t('available')}</p>}
        {suggestions.length>0&&<div className="flex flex-wrap gap-2">{suggestions.map(n=>
          <button type="button" key={n} onClick={()=>changeName(n)}
            className="min-h-11 rounded-md border border-foreground/20 px-3 text-sm">{n}</button>)}</div>}
      </div>
      <div className="space-y-2">
        <label htmlFor="country" className={fieldLabelClass}>{t('country')}</label>
        <SearchableSelect id="country" value={country} onChange={setCountry}
          options={countries} placeholder={t('searchCountries')} />
      </div>
      <div className="space-y-2">
        <label htmlFor="languages" className={fieldLabelClass}>{t('languages')}</label>
        <SearchableMultiSelect id="languages" values={languages} onChange={setLanguages}
          options={languageOptions} placeholder={t('searchLanguages')} allowCustom />
      </div>
      <fieldset className="space-y-3 border-t border-foreground/10 pt-6">
        <legend className="font-serif text-[20px]">{arrival('writing')}</legend>
        <p className={helperTextClass}>{arrival('writingHelp')}</p>
        <ChoiceGroup ariaLabel="How you usually write" options={writingOptions}
          selected={aiPreference?[aiPreference]:[]} onToggle={setAiPreference} layout="card" />
      </fieldset>
      <p className="text-[13px] leading-relaxed text-foreground/65">
        {arrival('browse')}
      </p>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy||nameStatus==='checking'||nameStatus==='taken'||nameStatus==='reserved'} className="min-h-12 w-full rounded-md bg-accent px-5 py-3 text-[15px] font-medium text-accent-foreground disabled:opacity-60">
        {busy?arrival('saving'):arrival('continue')}
      </button>
    </form>
  </main>
}
