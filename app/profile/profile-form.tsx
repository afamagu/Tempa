'use client'

import { useMemo, useState, type FormEvent } from 'react'
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
  const writingT = useTranslations('ProfileSetup.writingOptions')
  const writingDescription = useTranslations('ProfileSetup.writingDescriptions')
  const router = useRouter()

  const [pseudonym,setPseudonym] = useState('')
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

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(busy)return
    setError(null)
    setSuggestions([])
    const name=pseudonym.trim()
    if(name.length<3||name.length>24||!/^[A-Za-z0-9 -]+$/.test(name)){
      setError('Choose a name of 3–24 letters, numbers, spaces or hyphens.')
      return
    }
    if(isReservedPseudonym(name)){setError(RESERVED_PSEUDONYM_MESSAGE);return}
    if(!country){setError('Choose your country.');return}
    if(!languages.length){setError('Choose at least one language.');return}
    if(!WRITING_STYLE_OPTIONS.some(x=>x.value===aiPreference)){
      setError('Tell us which writing approach you normally use.')
      return
    }
    setBusy(true)
    try {
      const supabase=createClient()
      const {data:available,error:checkError}=await supabase.rpc('is_pseudonym_available',{candidate:name})
      if(checkError)throw new Error('We could not check that name. Please try again.')
      if(!available){
        const {data:alternatives}=await supabase.rpc('suggest_available_pseudonyms',{base:name,needed:3})
        setSuggestions(alternatives??[])
        throw new Error('That name is already taken. Choose another.')
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
        if(insertError.code==='23505')throw new Error('That name has just been taken. Choose another.')
        throw new Error('We could not save these details. Please try again.')
      }
      router.replace('/welcome')
      router.refresh()
    }catch(e){
      setBusy(false)
      setError(e instanceof Error?e.message:'We could not save these details. Please try again.')
    }
  }

  return <main className="mx-auto flex min-h-[100svh] max-w-2xl flex-col justify-center px-6 py-14 sm:px-10">
    <header className="space-y-4">
      <p className="font-serif text-lg italic text-foreground/70">Tempa</p>
      <p className="pt-5 text-[11px] font-medium uppercase tracking-[.21em] text-[#94745f]">Your place here</p>
      <h1 className="font-serif text-[37px] font-normal leading-tight sm:text-[47px]">Just a few details.</h1>
      <p className="max-w-lg font-serif text-[19px] leading-relaxed text-foreground/75">
        A name, a place and the languages you know help people find each other. You can make the rest of your profile your own later.
      </p>
    </header>
    <form onSubmit={submit} className="mt-10 space-y-8">
      <div className="space-y-2">
        <label htmlFor="pseudonym" className={fieldLabelClass}>{t('nameLabel')}</label>
        <input id="pseudonym" value={pseudonym} onChange={e=>setPseudonym(e.target.value)}
          autoComplete="off" maxLength={24} placeholder={t('namePlaceholder')}
          className="min-h-12 w-full rounded-md border border-foreground/20 bg-background px-4 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
        <p className={helperTextClass}>{t('nameHelp')}</p>
        {suggestions.length>0&&<div className="flex flex-wrap gap-2">{suggestions.map(n=>
          <button type="button" key={n} onClick={()=>setPseudonym(n)}
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
        <legend className="font-serif text-[20px]">How do you usually write?</legend>
        <p className={helperTextClass}>Tempa values writing in your own voice. Choose the description that fits how you write.</p>
        <ChoiceGroup ariaLabel="How you usually write" options={writingOptions}
          selected={aiPreference?[aiPreference]:[]} onToggle={setAiPreference} layout="card" />
      </fieldset>
      <p className="text-[13px] leading-relaxed text-foreground/65">
        You can browse the open letters without writing anything or adding a photograph.
      </p>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="min-h-12 w-full rounded-md bg-accent px-5 py-3 text-[15px] font-medium text-accent-foreground disabled:opacity-60">
        {busy?'Saving…':'Continue'}
      </button>
    </form>
  </main>
}
