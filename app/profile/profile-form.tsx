'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  AGE_RANGE_OPTIONS,
  COUNTRY_OPTIONS,
  GENDER_OPTIONS,
  INTENT_OPTIONS,
  LANGUAGE_OPTIONS,
  RECEIVING_OPTIONS,
  WRITING_STYLE_OPTIONS,
  getRegionOptions,
} from './data'
import ChoiceGroup from './choice-group'
import SearchableSelect from './searchable-select'
import SearchableMultiSelect from './searchable-multi-select'
import {
  inputClass,
  sectionLabelClass,
  helperTextClass,
  fieldLabelClass,
} from './ui'

type PseudonymStatus = 'idle' | 'invalid' | 'checking' | 'available' | 'taken'

function validatePseudonym(raw: string) {
  const value = raw.trim()

  if (value.length < 3 || value.length > 24) {
    return { valid: false, value, message: 'Must be 3–24 characters.' }
  }
  if (!/^[A-Za-z0-9 -]+$/.test(value)) {
    return {
      valid: false,
      value,
      message: 'Use only letters, numbers, spaces, or hyphens.',
    }
  }
  return { valid: true, value, message: '' }
}

export default function ProfileForm({ userId }: { userId: string }) {
  const router = useRouter()

  const [pseudonym, setPseudonym] = useState('')
  const [pseudonymStatus, setPseudonymStatus] = useState<PseudonymStatus>('idle')
  const [suggestions, setSuggestions] = useState<string[]>([])

  const [country, setCountry] = useState('')
  const [region, setRegion] = useState('')
  const [ageRange, setAgeRange] = useState('')
  const [languages, setLanguages] = useState<string[]>([])
  const [gender, setGender] = useState('')
  const [genderCustom, setGenderCustom] = useState('')
  const [intentSelections, setIntentSelections] = useState<string[]>([])
  const [intentOther, setIntentOther] = useState('')
  const [aiPreference, setAiPreference] = useState('')
  const [receivingPreference, setReceivingPreference] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const checkIdRef = useRef(0)

  const regionOptions = useMemo(() => getRegionOptions(country), [country])
  const hasStructuredRegions = regionOptions.length > 0

  function handleCountryChange(value: string) {
    setCountry(value)
    setRegion('')
  }

  useEffect(() => {
    const { valid, value } = validatePseudonym(pseudonym)

    if (!valid) {
      setPseudonymStatus(pseudonym.trim() ? 'invalid' : 'idle')
      setSuggestions([])
      return
    }

    setPseudonymStatus('checking')
    const requestId = ++checkIdRef.current

    const timeout = setTimeout(async () => {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('is_pseudonym_available', {
        candidate: value,
      })

      if (checkIdRef.current !== requestId) return

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
        if (checkIdRef.current === requestId) {
          setSuggestions(suggestionData ?? [])
        }
      }
    }, 500)

    return () => clearTimeout(timeout)
  }, [pseudonym])

  function applySuggestion(name: string) {
    setPseudonym(name)
  }

  function toggleIntent(option: string) {
    setIntentSelections((prev) =>
      prev.includes(option)
        ? prev.filter((o) => o !== option)
        : [...prev, option]
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)

    const { valid, value, message } = validatePseudonym(pseudonym)
    if (!valid) {
      setPseudonymStatus('invalid')
      setFormError(message)
      return
    }

    if (
      !country ||
      !ageRange ||
      languages.length === 0 ||
      intentSelections.length === 0 ||
      !aiPreference ||
      !receivingPreference
    ) {
      setFormError('Please fill in the required fields.')
      return
    }

    setSubmitting(true)
    const supabase = createClient()

    const { data: available, error: checkError } = await supabase.rpc(
      'is_pseudonym_available',
      { candidate: value }
    )

    if (checkError) {
      setSubmitting(false)
      console.error('[profile] pseudonym availability check failed', {
        message: checkError.message,
        details: checkError.details,
        hint: checkError.hint,
        code: checkError.code,
      })
      setFormError(
        'Could not check that name right now. Please try again.' +
          (process.env.NODE_ENV === 'development'
            ? ` (${checkError.code ?? 'no code'}: ${checkError.message})`
            : '')
      )
      return
    }

    if (!available) {
      setSubmitting(false)
      setPseudonymStatus('taken')
      setFormError(null)
      const { data: suggestionData } = await supabase.rpc(
        'suggest_available_pseudonyms',
        { base: value, needed: 3 }
      )
      setSuggestions(suggestionData ?? [])
      return
    }

    const { error: insertError } = await supabase.from('profiles').insert({
      id: userId,
      pseudonym: value,
      country,
      region: region.trim() || null,
      age_range: ageRange,
      languages,
      gender: gender || null,
      gender_custom:
        gender === 'Self-describe' ? genderCustom.trim() || null : null,
      intent: intentSelections,
      intent_other: intentSelections.includes('Something else')
        ? intentOther.trim() || null
        : null,
      ai_preference: aiPreference,
      receiving_preference: receivingPreference,
    })

    if (insertError) {
      setSubmitting(false)
      console.error('[profile] profile insert failed', {
        message: insertError.message,
        details: insertError.details,
        hint: insertError.hint,
        code: insertError.code,
      })
      if (insertError.code === '23505') {
        setPseudonymStatus('taken')
        const { data: suggestionData } = await supabase.rpc(
          'suggest_available_pseudonyms',
          { base: value, needed: 3 }
        )
        setSuggestions(suggestionData ?? [])
      } else {
        setFormError(
          'Could not save your profile. Please try again.' +
            (process.env.NODE_ENV === 'development'
              ? ` (${insertError.code ?? 'no code'}: ${insertError.message})`
              : '')
        )
      }
      return
    }

    router.push('/home')
    router.refresh()
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8 py-10">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-black/40 dark:text-white/40">
            Tempa
          </p>
          <h1 className="text-2xl font-semibold">Choose your name</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            This is the name other minds will know you by.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-10">
          <section className="space-y-6">
            <p className={sectionLabelClass}>About you</p>

            <div className="space-y-1.5">
              <label htmlFor="pseudonym" className={fieldLabelClass}>
                Your name
              </label>
              <input
                id="pseudonym"
                value={pseudonym}
                onChange={(e) => setPseudonym(e.target.value)}
                placeholder="e.g. Quiet Harbor"
                autoComplete="off"
                className={inputClass}
              />
              <p className={helperTextClass}>
                3–24 characters. Letters, numbers, spaces, or hyphens.
              </p>

              {pseudonymStatus === 'invalid' && formError === null && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {validatePseudonym(pseudonym).message}
                </p>
              )}
              {pseudonymStatus === 'checking' && (
                <p className={helperTextClass}>Checking availability…</p>
              )}
              {pseudonymStatus === 'available' && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  Available
                </p>
              )}
              {pseudonymStatus === 'taken' && (
                <div className="space-y-2">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    That name is taken.
                  </p>
                  {suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => applySuggestion(s)}
                          className="rounded-full border border-black/10 dark:border-white/20 px-3 py-1.5 text-sm hover:bg-black/[.04] dark:hover:bg-white/[.08]"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="country" className={fieldLabelClass}>
                Country
              </label>
              <SearchableSelect
                id="country"
                value={country}
                onChange={handleCountryChange}
                options={COUNTRY_OPTIONS}
                placeholder="Search countries"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="region" className={fieldLabelClass}>
                Region{' '}
                <span className="text-black/40 dark:text-white/40">
                  (optional)
                </span>
              </label>
              {!country ? (
                <input
                  disabled
                  placeholder="Select a country first"
                  className={inputClass}
                />
              ) : hasStructuredRegions ? (
                <SearchableSelect
                  id="region"
                  value={region}
                  onChange={setRegion}
                  options={regionOptions}
                  placeholder="Search regions"
                />
              ) : (
                <input
                  id="region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className={inputClass}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <p className={fieldLabelClass}>Age range</p>
              <ChoiceGroup
                ariaLabel="Age range"
                options={AGE_RANGE_OPTIONS}
                selected={ageRange ? [ageRange] : []}
                onToggle={setAgeRange}
                layout="pill"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="languages" className={fieldLabelClass}>
                Languages
              </label>
              <SearchableMultiSelect
                id="languages"
                values={languages}
                onChange={setLanguages}
                options={LANGUAGE_OPTIONS}
                placeholder="Search languages"
                allowCustom
              />
            </div>

            <div className="space-y-1.5">
              <p className={fieldLabelClass}>
                Gender{' '}
                <span className="text-black/40 dark:text-white/40">
                  (optional)
                </span>
              </p>
              <ChoiceGroup
                ariaLabel="Gender"
                options={GENDER_OPTIONS}
                selected={gender ? [gender] : []}
                onToggle={setGender}
                layout="pill"
              />
              {gender === 'Self-describe' && (
                <input
                  id="gender_custom"
                  value={genderCustom}
                  onChange={(e) => setGenderCustom(e.target.value)}
                  placeholder="Describe in your own words"
                  className={inputClass}
                />
              )}
            </div>
          </section>

          <section className="space-y-3">
            <p className={sectionLabelClass}>What brings you here?</p>

            <div className="space-y-1.5">
              <p className={helperTextClass}>Choose as many as feel true.</p>
              <ChoiceGroup
                ariaLabel="What brings you here?"
                options={INTENT_OPTIONS}
                selected={intentSelections}
                onToggle={toggleIntent}
                layout="pill"
              />
              {intentSelections.includes('Something else') && (
                <input
                  id="intent_other"
                  value={intentOther}
                  onChange={(e) => setIntentOther(e.target.value)}
                  placeholder="Tell us more"
                  className={inputClass}
                />
              )}
            </div>
          </section>

          <section className="space-y-6">
            <p className={sectionLabelClass}>Your correspondence</p>

            <div className="space-y-1.5">
              <p className={fieldLabelClass}>
                How do you usually write your letters?
              </p>
              <ChoiceGroup
                ariaLabel="How do you usually write your letters?"
                options={WRITING_STYLE_OPTIONS}
                selected={aiPreference ? [aiPreference] : []}
                onToggle={setAiPreference}
                layout="card"
              />
            </div>

            <div className="space-y-1.5">
              <p className={fieldLabelClass}>
                What are you comfortable receiving?
              </p>
              <ChoiceGroup
                ariaLabel="What are you comfortable receiving?"
                options={RECEIVING_OPTIONS}
                selected={receivingPreference ? [receivingPreference] : []}
                onToggle={setReceivingPreference}
                layout="pill"
              />
            </div>
          </section>

          {formError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              pseudonymStatus === 'checking' ||
              pseudonymStatus === 'taken'
            }
            className="w-full rounded-md bg-foreground text-background px-4 py-3 text-base font-medium disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </main>
  )
}
