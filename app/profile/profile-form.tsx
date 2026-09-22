'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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
import {
  INTEREST_TAXONOMY,
  MIN_RECOMMENDED_INTERESTS,
  MAX_INTERESTS,
  isReadingInterestsCountValidForNewProfile,
} from '@/lib/interests'
import { setProfileInterests } from '@/lib/profile-interests'

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

// Onboarding & First-Use checkpoint (Section K) — one specific, human
// message per required section, in the exact top-to-bottom DOM order
// the fields themselves render in, so "the first incomplete
// requirement" (both for the returned object's key order — plain
// string keys iterate in insertion order — and for scrollToField below)
// is unambiguous. Pseudonym is deliberately NOT included here: it
// already has its own real-time, specific validation path above,
// checked separately and first in handleSubmit.
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

  function registerFieldRef(key: RequiredFieldKey) {
    return (el: HTMLDivElement | null) => {
      fieldRefs.current[key] = el
    }
  }

  // Scrolls to, and best-effort focuses, the first incomplete
  // requirement — "move/focus/scroll to the first incomplete
  // requirement where technically appropriate" (Section K). A plain
  // container scroll (never a full input-level ref) since several
  // required fields render through custom controls (SearchableSelect/
  // ChoiceGroup) that don't necessarily forward a ref of their own; the
  // first focusable element inside that container is still a real,
  // useful focus target for keyboard/screen-reader users.
  function scrollToField(key: RequiredFieldKey) {
    const el = fieldRefs.current[key]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.querySelector<HTMLElement>('input, button, [tabindex]')?.focus()
  }

  const regionOptions = useMemo(() => getRegionOptions(country), [country])
  const hasStructuredRegions = regionOptions.length > 0
  // Always derived fresh from `country`, never stored as its own piece
  // of state — the only way this can ever go stale relative to
  // `country` is if this derivation itself is wrong, not from an
  // update happening to one but not the other.
  const countryCode = useMemo(() => findCountryIsoCode(country), [country])

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

  /** Never blocks a selection outright at the cap — a silent no-op
   * past MAX_INTERESTS reads more calmly than a disabled/greyed chip
   * the reader has to figure out why it won't respond; the helper text
   * beneath the group already explains the limit. */
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

    const { valid, value, message } = validatePseudonym(pseudonym)
    if (!valid) {
      setPseudonymStatus('invalid')
      setFormError(message)
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
    const firstInvalidKey = (Object.keys(errors) as RequiredFieldKey[])[0]
    if (firstInvalidKey) {
      setFieldErrors(errors)
      scrollToField(firstInvalidKey)
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
      onboarding_stage: 'mark',
      pseudonym: value,
      country,
      country_code: countryCode,
      region: region.trim() || null,
      // age_range is no longer supplied by the client — Adult
      // Eligibility + Legal Acceptance Gate: the profiles_enforce_
      // adult_eligibility trigger (docs/sql/2026-09-21-adult-
      // eligibility-and-legal-acceptance.sql) forcibly derives it
      // server-side from the account's own confirmed date of birth,
      // ignoring whatever (if anything) is sent here.
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

    // Best-effort, never blocks account creation: a failure here (e.g.
    // a transient network error) still leaves the member with a fully
    // usable account and the Phase 2A Board experience — they can
    // always add reading interests later from /you/interests.
    if (readingInterests.length > 0) {
      await setProfileInterests(supabase, readingInterests)
    }

    // A new profile explicitly enters the durable Mark stage. The
    // database trigger enforces the same invariant; this value keeps the
    // application contract visible here at the cohort-creation boundary.
    router.push('/profile/mark')
    router.refresh()
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8 py-10">
        <div className="space-y-2">
          <p className="font-serif text-xs italic tracking-[0.2em] text-muted">
            Tempa
          </p>
          <h1 className="font-serif text-2xl font-medium">Choose your name on Tempa</h1>
          <p className="text-sm text-muted">
            This is the name other members will know you by.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-10">
          <section className="space-y-6">
            <p className={sectionLabelClass}>About you</p>

            <div className="space-y-1.5">
              <label htmlFor="pseudonym" className={fieldLabelClass}>
                Name on Tempa
              </label>
              <input
                id="pseudonym"
                ref={pseudonymFieldRef}
                value={pseudonym}
                onChange={(e) => setPseudonym(e.target.value)}
                placeholder="e.g. Quiet Harbor"
                autoComplete="off"
                aria-invalid={pseudonymStatus === 'invalid' || pseudonymStatus === 'taken'}
                className={inputClass}
              />
              <p className={helperTextClass}>
                How you&rsquo;d like to be known here. Your first name, a nickname, initials or a
                pen name all work — 3–24 characters, letters, numbers, spaces, or hyphens.
              </p>

              {pseudonymStatus === 'invalid' && formError === null && (
                <p className="text-xs text-red-600">
                  {validatePseudonym(pseudonym).message}
                </p>
              )}
              {pseudonymStatus === 'checking' && (
                <p className={helperTextClass}>Checking availability…</p>
              )}
              {pseudonymStatus === 'available' && (
                <p className="text-xs text-accent">Available</p>
              )}
              {pseudonymStatus === 'taken' && (
                <div className="space-y-2">
                  <p className="text-sm text-red-600">
                    That name is taken.
                  </p>
                  {suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => applySuggestion(s)}
                          className="rounded-full border border-foreground/15 px-3 py-1.5 text-sm transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5" ref={registerFieldRef('country')}>
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
              {fieldErrors.country && (
                <p className="text-xs text-red-600" role="alert">
                  {fieldErrors.country}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="region" className={fieldLabelClass}>
                Region{' '}
                <span className="text-muted">
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

            <div className="space-y-1.5" ref={registerFieldRef('languages')}>
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
              {fieldErrors.languages && (
                <p className="text-xs text-red-600" role="alert">
                  {fieldErrors.languages}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <p className={fieldLabelClass}>
                Gender{' '}
                <span className="text-muted">
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

            <div className="space-y-1.5" ref={registerFieldRef('intent')}>
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
              {fieldErrors.intent && (
                <p className="text-xs text-red-600" role="alert">
                  {fieldErrors.intent}
                </p>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <p className={sectionLabelClass}>What do you love reading about?</p>

            <div className="space-y-1.5" ref={registerFieldRef('interests')}>
              <p className={helperTextClass}>
                Choose at least {MIN_RECOMMENDED_INTERESTS}. You can change these anytime.
              </p>
              <ChoiceGroup
                ariaLabel="What do you love reading about?"
                options={INTEREST_TAXONOMY.map((i) => ({ value: i.key, label: i.label }))}
                selected={readingInterests}
                onToggle={toggleInterest}
                layout="pill"
              />
              {fieldErrors.interests && (
                <p className="text-xs text-red-600" role="alert">
                  {fieldErrors.interests}
                </p>
              )}
            </div>
          </section>

          <section className="space-y-6">
            <p className={sectionLabelClass}>Your correspondence</p>

            <div className="space-y-1.5" ref={registerFieldRef('writingStyle')}>
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
              {fieldErrors.writingStyle && (
                <p className="text-xs text-red-600" role="alert">
                  {fieldErrors.writingStyle}
                </p>
              )}
            </div>

            <div className="space-y-1.5" ref={registerFieldRef('receiving')}>
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
              {fieldErrors.receiving && (
                <p className="text-xs text-red-600" role="alert">
                  {fieldErrors.receiving}
                </p>
              )}
            </div>
          </section>

          {formError && (
            <p className="text-sm text-red-600">{formError}</p>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              pseudonymStatus === 'checking' ||
              pseudonymStatus === 'taken'
            }
            className="w-full rounded-md bg-accent text-accent-foreground px-4 py-3 text-base font-medium transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </main>
  )
}
