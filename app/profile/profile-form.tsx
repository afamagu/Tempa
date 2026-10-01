'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import ISO6391 from 'iso-639-1'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  COUNTRY_OPTIONS,
  GENDER_OPTIONS,
  INTENT_OPTIONS,
  LANGUAGE_OPTIONS,
  RECEIVING_OPTIONS,
  WRITING_STYLE_OPTIONS,
  findCountryIsoCode,
  getRegionOptions,
  type ChoiceOption,
  type Option,
} from './data'
import ChoiceGroup from './choice-group'
import SearchableSelect from './searchable-select'
import SearchableMultiSelect from './searchable-multi-select'
import { inputClass, sectionLabelClass, helperTextClass, fieldLabelClass } from './ui'
import {
  INTEREST_TAXONOMY,
  MIN_RECOMMENDED_INTERESTS,
  MAX_INTERESTS,
  isReadingInterestsCountValidForNewProfile,
} from '@/lib/interests'
import { isReservedPseudonym, RESERVED_PSEUDONYM_MESSAGE } from '@/lib/reserved-pseudonyms'
import { setProfileInterests } from '@/lib/profile-interests'

type PseudonymStatus = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'reserved'

function validatePseudonym(raw: string) {
  const value = raw.trim()
  if (value.length < 3 || value.length > 24) {
    return { valid: false, value, message: 'Must be 3–24 characters.' }
  }
  if (!/^[A-Za-z0-9 -]+$/.test(value)) {
    return { valid: false, value, message: 'Use only letters, numbers, spaces, or hyphens.' }
  }
  if (isReservedPseudonym(value)) {
    return { valid: false, value, message: RESERVED_PSEUDONYM_MESSAGE }
  }
  return { valid: true, value, message: '' }
}

export type RequiredFieldKey =
  | 'country'
  | 'languages'
  | 'intent'
  | 'interests'
  | 'writingStyle'
  | 'receiving'

export function validateRequiredFields(state: {
  country: string
  languages: string[]
  intentSelections: string[]
  readingInterestsCount: number
  aiPreference: string
  receivingPreference: string
}): Partial<Record<RequiredFieldKey, string>> {
  const errors: Partial<Record<RequiredFieldKey, string>> = {}
  if (!state.country) errors.country = 'Choose your country.'
  if (state.languages.length === 0) errors.languages = 'Add at least one language.'
  if (state.intentSelections.length === 0) errors.intent = 'Choose what brings you to Tempa.'
  if (!isReadingInterestsCountValidForNewProfile(state.readingInterestsCount)) {
    errors.interests = `Choose at least ${MIN_RECOMMENDED_INTERESTS} things you enjoy reading about (up to ${MAX_INTERESTS}).`
  }
  if (!state.aiPreference) errors.writingStyle = 'Choose how you usually write your letters.'
  if (!state.receivingPreference) errors.receiving = "Choose what you're comfortable receiving."
  return errors
}

export default function ProfileForm({ userId }: { userId: string }) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('ProfileSetup')
  const common = useTranslations('Common')
  const genderT = useTranslations('ProfileSetup.genderOptions')
  const intentT = useTranslations('ProfileSetup.intentOptions')
  const writingT = useTranslations('ProfileSetup.writingOptions')
  const writingDescriptionT = useTranslations('ProfileSetup.writingDescriptions')
  const receivingT = useTranslations('ProfileSetup.receivingOptions')
  const interestT = useTranslations('ProfileSetup.interestOptions')

  const [pseudonym, setPseudonym] = useState('')
  const [pseudonymStatus, setPseudonymStatus] = useState<PseudonymStatus>('idle')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [country, setCountry] = useState('')
  const [region, setRegion] = useState('')
  const [languages, setLanguages] = useState<string[]>([])
  const [gender, setGender] = useState('')
  const [genderCustom, setGenderCustom] = useState('')
  const [intentSelections, setIntentSelections] = useState<string[]>([])
  const [intentOther, setIntentOther] = useState('')
  const [readingInterests, setReadingInterests] = useState<string[]>([])
  const [aiPreference, setAiPreference] = useState('')
  const [receivingPreference, setReceivingPreference] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RequiredFieldKey, string>>>({})

  const checkIdRef = useRef(0)
  const pseudonymFieldRef = useRef<HTMLInputElement | null>(null)
  const fieldRefs = useRef<Partial<Record<RequiredFieldKey, HTMLDivElement | null>>>({})

  const countryDisplayNames = useMemo(() => {
    try { return new Intl.DisplayNames([locale], { type: 'region' }) } catch { return null }
  }, [locale])
  const languageDisplayNames = useMemo(() => {
    try { return new Intl.DisplayNames([locale], { type: 'language' }) } catch { return null }
  }, [locale])

  const countryOptions: Option[] = useMemo(
    () => COUNTRY_OPTIONS.map((option) => ({
      value: option.value,
      label: countryDisplayNames?.of(option.isoCode) ?? option.label,
    })),
    [countryDisplayNames]
  )
  const languageOptions: Option[] = useMemo(
    () => LANGUAGE_OPTIONS.map((option) => {
      const code = ISO6391.getCode(option.value)
      return { value: option.value, label: (code && languageDisplayNames?.of(code)) || option.label }
    }),
    [languageDisplayNames]
  )

  const genderOptions: ChoiceOption[] = GENDER_OPTIONS.map((option) => ({ ...option, label: genderT(option.value as never) }))
  const intentOptions: ChoiceOption[] = INTENT_OPTIONS.map((option) => ({ ...option, label: intentT(option.value as never) }))
  const writingStyleOptions: ChoiceOption[] = WRITING_STYLE_OPTIONS.map((option) => ({
    ...option,
    label: writingT(option.value as never),
    description: writingDescriptionT(option.value as never),
  }))
  const receivingOptions: ChoiceOption[] = RECEIVING_OPTIONS.map((option) => ({ ...option, label: receivingT(option.value as never) }))
  const interestOptions: ChoiceOption[] = INTEREST_TAXONOMY.map((interest) => ({
    value: interest.key,
    label: interestT(interest.key as never),
  }))

  function registerFieldRef(key: RequiredFieldKey) {
    return (el: HTMLDivElement | null) => { fieldRefs.current[key] = el }
  }

  function scrollToField(key: RequiredFieldKey) {
    const el = fieldRefs.current[key]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.querySelector<HTMLElement>('input, button, [tabindex]')?.focus()
  }

  const regionOptions = useMemo(() => getRegionOptions(country), [country])
  const hasStructuredRegions = regionOptions.length > 0
  const countryCode = useMemo(() => findCountryIsoCode(country), [country])

  function handleCountryChange(value: string) {
    setCountry(value)
    setRegion('')
  }

  function pseudonymValidationMessage(raw: string) {
    if (isReservedPseudonym(raw)) return t('reserved')
    const value = raw.trim()
    if (value.length < 3 || value.length > 24) return t('pseudonymLength')
    if (!/^[A-Za-z0-9 -]+$/.test(value)) return t('pseudonymChars')
    return ''
  }

  function translatedFieldErrors(keys: RequiredFieldKey[]) {
    const result: Partial<Record<RequiredFieldKey, string>> = {}
    for (const key of keys) {
      if (key === 'interests') {
        result[key] = t('fieldErrors.interests', { min: MIN_RECOMMENDED_INTERESTS, max: MAX_INTERESTS })
      } else {
        result[key] = t(`fieldErrors.${key}` as 'fieldErrors.country' | 'fieldErrors.languages' | 'fieldErrors.intent' | 'fieldErrors.writingStyle' | 'fieldErrors.receiving')
      }
    }
    return result
  }

  useEffect(() => {
    const requestId = ++checkIdRef.current
    const { valid, value } = validatePseudonym(pseudonym)
    if (!valid) {
      setPseudonymStatus(isReservedPseudonym(pseudonym) ? 'reserved' : pseudonym.trim() ? 'invalid' : 'idle')
      setSuggestions([])
      return
    }

    setPseudonymStatus('checking')
    let cancelled = false
    const timeout = setTimeout(async () => {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('is_pseudonym_available', {
        candidate: value,
      })

      if (cancelled || checkIdRef.current !== requestId) return

      if (error) {
        setPseudonymStatus('idle')
        return
      }
      if (data) {
        setPseudonymStatus('available')
        setSuggestions([])
      } else {
        setPseudonymStatus('taken')
        const { data: suggestionData } = await supabase.rpc(
          'suggest_available_pseudonyms',
          { base: value, needed: 3 }
        )
        if (!cancelled && checkIdRef.current === requestId) {
          setSuggestions(suggestionData ?? [])
        }
      }
    }, 500)

    return () => { clearTimeout(timeout); cancelled = true }
  }, [pseudonym])

  function toggleIntent(option: string) {
    setIntentSelections((prev) => prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option])
  }

  function toggleInterest(key: string) {
    setReadingInterests((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key)
      if (prev.length >= MAX_INTERESTS) return prev
      return [...prev, key]
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})

    const { valid, value } = validatePseudonym(pseudonym)
    if (!valid) {
      setPseudonymStatus(isReservedPseudonym(pseudonym) ? 'reserved' : 'invalid')
      setFormError(pseudonymValidationMessage(pseudonym))
      pseudonymFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      pseudonymFieldRef.current?.focus()
      return
    }

    const errors = validateRequiredFields({
      country,
      languages,
      intentSelections,
      readingInterestsCount: readingInterests.length,
      aiPreference,
      receivingPreference,
    })
    const invalidKeys = Object.keys(errors) as RequiredFieldKey[]
    const firstInvalidKey = invalidKeys[0]
    if (firstInvalidKey) {
      setFieldErrors(translatedFieldErrors(invalidKeys))
      scrollToField(firstInvalidKey)
      return
    }

    setSubmitting(true)
    const supabase = createClient()
    const { data: available, error: checkError } = await supabase.rpc('is_pseudonym_available', { candidate: value })

    if (checkError) {
      setSubmitting(false)
      console.error('[profile] pseudonym availability check failed', { code: checkError.code })
      setFormError(t('checkNameError'))
      return
    }

    if (!available) {
      setSubmitting(false)
      setPseudonymStatus('taken')
      const { data: suggestionData } = await supabase.rpc('suggest_available_pseudonyms', { base: value, needed: 3 })
      setSuggestions(suggestionData ?? [])
      return
    }

    const { error: insertError } = await supabase.from('profiles').insert({
      id: userId,
      onboarding_stage: 'mark',
      pseudonym: value,
      country,
      country_code: countryCode,
      region: region.trim() || null,
      languages,
      gender: gender || null,
      gender_custom: gender === 'Self-describe' ? genderCustom.trim() || null : null,
      intent: intentSelections,
      intent_other: intentSelections.includes('Something else') ? intentOther.trim() || null : null,
      ai_preference: aiPreference,
      receiving_preference: receivingPreference,
    })

    if (insertError) {
      setSubmitting(false)
      console.error('[profile] profile insert failed', { code: insertError.code })
      if (insertError.code === '23514' && insertError.message.includes(RESERVED_PSEUDONYM_MESSAGE)) {
        setPseudonymStatus('reserved')
        setSuggestions([])
        setFormError(t('reserved'))
      } else if (insertError.code === '23505') {
        setPseudonymStatus('taken')
        const { data: suggestionData } = await supabase.rpc('suggest_available_pseudonyms', { base: value, needed: 3 })
        setSuggestions(suggestionData ?? [])
      } else {
        setFormError(t('saveError'))
      }
      return
    }

    if (readingInterests.length > 0) await setProfileInterests(supabase, readingInterests)
    router.push('/profile/mark')
    router.refresh()
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8 py-10">
        <div className="space-y-2">
          <p className="font-serif text-xs italic tracking-[0.2em] text-muted">Tempa</p>
          <h1 className="font-serif text-2xl font-medium">{t('heading')}</h1>
          <p className="text-sm text-muted">{t('intro')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-10">
          <section className="space-y-6">
            <p className={sectionLabelClass}>{t('aboutYou')}</p>

            <div className="space-y-1.5">
              <label htmlFor="pseudonym" className={fieldLabelClass}>{t('nameLabel')}</label>
              <input
                id="pseudonym"
                ref={pseudonymFieldRef}
                value={pseudonym}
                onChange={(e) => setPseudonym(e.target.value)}
                placeholder={t('namePlaceholder')}
                autoComplete="off"
                aria-invalid={pseudonymStatus === 'invalid' || pseudonymStatus === 'taken' || pseudonymStatus === 'reserved'}
                className={inputClass}
              />
              <p className={helperTextClass}>{t('nameHelp')}</p>
              {pseudonymStatus === 'invalid' && formError === null && <p className="text-xs text-red-600">{pseudonymValidationMessage(pseudonym)}</p>}
              {pseudonymStatus === 'reserved' && formError === null && <p className="text-xs text-red-600" role="alert">{t('reserved')}</p>}
              {pseudonymStatus === 'checking' && <p className={helperTextClass}>{t('checking')}</p>}
              {pseudonymStatus === 'available' && <p className="text-xs text-accent">{t('available')}</p>}
              {pseudonymStatus === 'taken' && (
                <div className="space-y-2">
                  <p className="text-sm text-red-600">{t('taken')}</p>
                  {suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((suggestion) => (
                        <button key={suggestion} type="button" onClick={() => setPseudonym(suggestion)} className="rounded-full border border-foreground/15 px-3 py-1.5 text-sm transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]">
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5" ref={registerFieldRef('country')}>
              <label htmlFor="country" className={fieldLabelClass}>{t('country')}</label>
              <SearchableSelect id="country" value={country} onChange={handleCountryChange} options={countryOptions} placeholder={t('searchCountries')} />
              {fieldErrors.country && <p className="text-xs text-red-600" role="alert">{fieldErrors.country}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="region" className={fieldLabelClass}>{t('region')} <span className="text-muted">({common('optional')})</span></label>
              {!country ? (
                <input disabled placeholder={t('selectCountryFirst')} className={inputClass} />
              ) : hasStructuredRegions ? (
                <SearchableSelect id="region" value={region} onChange={setRegion} options={regionOptions} placeholder={t('searchRegions')} />
              ) : (
                <input id="region" value={region} onChange={(e) => setRegion(e.target.value)} className={inputClass} />
              )}
            </div>

            <div className="space-y-1.5" ref={registerFieldRef('languages')}>
              <label htmlFor="languages" className={fieldLabelClass}>{t('languages')}</label>
              <SearchableMultiSelect id="languages" values={languages} onChange={setLanguages} options={languageOptions} placeholder={t('searchLanguages')} allowCustom />
              {fieldErrors.languages && <p className="text-xs text-red-600" role="alert">{fieldErrors.languages}</p>}
            </div>

            <div className="space-y-1.5">
              <p className={fieldLabelClass}>{t('gender')} <span className="text-muted">({common('optional')})</span></p>
              <ChoiceGroup ariaLabel={t('gender')} options={genderOptions} selected={gender ? [gender] : []} onToggle={setGender} layout="pill" />
              {gender === 'Self-describe' && <input id="gender_custom" value={genderCustom} onChange={(e) => setGenderCustom(e.target.value)} placeholder={t('selfDescribe')} className={inputClass} />}
            </div>
          </section>

          <section className="space-y-3">
            <p className={sectionLabelClass}>{t('whatBrings')}</p>
            <div className="space-y-1.5" ref={registerFieldRef('intent')}>
              <p className={helperTextClass}>{t('chooseMany')}</p>
              <ChoiceGroup ariaLabel={t('whatBrings')} options={intentOptions} selected={intentSelections} onToggle={toggleIntent} layout="pill" />
              {intentSelections.includes('Something else') && <input id="intent_other" value={intentOther} onChange={(e) => setIntentOther(e.target.value)} placeholder={t('tellMore')} className={inputClass} />}
              {fieldErrors.intent && <p className="text-xs text-red-600" role="alert">{fieldErrors.intent}</p>}
            </div>
          </section>

          <section className="space-y-3">
            <p className={sectionLabelClass}>{t('readingInterests')}</p>
            <div className="space-y-1.5" ref={registerFieldRef('interests')}>
              <p className={helperTextClass}>{t('interestsHelp', { min: MIN_RECOMMENDED_INTERESTS })}</p>
              <ChoiceGroup ariaLabel={t('readingInterests')} options={interestOptions} selected={readingInterests} onToggle={toggleInterest} layout="pill" />
              {fieldErrors.interests && <p className="text-xs text-red-600" role="alert">{fieldErrors.interests}</p>}
            </div>
          </section>

          <section className="space-y-6">
            <p className={sectionLabelClass}>{t('correspondence')}</p>
            <div className="space-y-1.5" ref={registerFieldRef('writingStyle')}>
              <p className={fieldLabelClass}>{t('writingQuestion')}</p>
              <ChoiceGroup ariaLabel={t('writingQuestion')} options={writingStyleOptions} selected={aiPreference ? [aiPreference] : []} onToggle={setAiPreference} layout="card" />
              {fieldErrors.writingStyle && <p className="text-xs text-red-600" role="alert">{fieldErrors.writingStyle}</p>}
            </div>
            <div className="space-y-1.5" ref={registerFieldRef('receiving')}>
              <p className={fieldLabelClass}>{t('receivingQuestion')}</p>
              <ChoiceGroup ariaLabel={t('receivingQuestion')} options={receivingOptions} selected={receivingPreference ? [receivingPreference] : []} onToggle={setReceivingPreference} layout="pill" />
              {fieldErrors.receiving && <p className="text-xs text-red-600" role="alert">{fieldErrors.receiving}</p>}
            </div>
          </section>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={
              submitting ||
              pseudonymStatus === 'checking' ||
              pseudonymStatus === 'taken' ||
              pseudonymStatus === 'reserved'
            }
            className="w-full rounded-md bg-accent text-accent-foreground px-4 py-3 text-base font-medium transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {submitting ? common('saving') : common('continue')}
          </button>
        </form>
      </div>
    </main>
  )
}
