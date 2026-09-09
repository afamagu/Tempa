import { Country, State } from 'country-state-city'
import ISO6391 from 'iso-639-1'

export type Option = { value: string; label: string }
export type ChoiceOption = Option & { description?: string }

const rawCountries = Country.getAllCountries()

export const COUNTRY_OPTIONS: (Option & { isoCode: string })[] = rawCountries
  .map((c) => ({ value: c.name, label: c.name, isoCode: c.isoCode }))
  .sort((a, b) => a.label.localeCompare(b.label))

export function getRegionOptions(countryName: string): Option[] {
  const country = COUNTRY_OPTIONS.find((c) => c.value === countryName)
  if (!country) return []
  return State.getStatesOfCountry(country.isoCode)
    .map((s) => ({ value: s.name, label: s.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The selected country's own ISO alpha-2 code, straight from
 * country-state-city — never a reverse-mapping of the saved display
 * name after the fact. Returns null only for a country name that isn't
 * one of COUNTRY_OPTIONS' own values, which the picker itself can never
 * produce (selection only ever comes from clicking/Enter-selecting one
 * of those options — see SearchableSelect), so this is a genuine
 * "shouldn't happen" fallback, not an expected path.
 */
export function findCountryIsoCode(countryName: string): string | null {
  return COUNTRY_OPTIONS.find((c) => c.value === countryName)?.isoCode ?? null
}

export const LANGUAGE_OPTIONS: Option[] = ISO6391.getAllNames()
  .map((name) => ({ value: name, label: name }))
  .sort((a, b) => a.label.localeCompare(b.label))

export const AGE_RANGE_OPTIONS: Option[] = [
  { value: '18-24', label: '18–24' },
  { value: '25-34', label: '25–34' },
  { value: '35-44', label: '35–44' },
  { value: '45-54', label: '45–54' },
  { value: '55-64', label: '55–64' },
  { value: '65+', label: '65+' },
]

export const GENDER_OPTIONS: Option[] = [
  { value: 'Woman', label: 'Woman' },
  { value: 'Man', label: 'Man' },
  { value: 'Non-binary', label: 'Non-binary' },
  { value: 'Self-describe', label: 'Self-describe' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
]

export const INTENT_OPTIONS: Option[] = [
  { value: 'Meaningful friendship', label: 'Meaningful friendship' },
  { value: 'Long-term correspondence', label: 'Long-term correspondence' },
  { value: 'Thoughtful conversation', label: 'Thoughtful conversation' },
  { value: 'Cultural exchange', label: 'Cultural exchange' },
  { value: 'Sharing everyday life', label: 'Sharing everyday life' },
  { value: 'Practising a language', label: 'Practising a language' },
  {
    value: 'Meeting people different from me',
    label: 'Meeting people different from me',
  },
  {
    value: 'Meeting people who think like me',
    label: 'Meeting people who think like me',
  },
  { value: 'Writing and self-expression', label: 'Writing and self-expression' },
  { value: 'A little serendipity', label: 'A little serendipity' },
  { value: 'Something else', label: 'Something else' },
]

export const WRITING_STYLE_OPTIONS: ChoiceOption[] = [
  {
    value: 'self_written',
    label: 'I write my letters myself',
    description: "I don't use generative AI to write or rewrite them.",
  },
  {
    value: 'ai_review_only',
    label: 'I use AI only for review',
    description:
      "I may use it for spelling, grammar, translation, or proofreading after I've written.",
  },
  {
    value: 'ai_edit',
    label: 'I sometimes use AI to edit my writing',
    description:
      "I may use it to rephrase, organise, or improve something I've already written.",
  },
  {
    value: 'ai_draft',
    label: 'I use AI to help draft letters',
    description: 'AI may generate some or most of the wording I send.',
  },
]

export const RECEIVING_OPTIONS: Option[] = [
  { value: 'any', label: 'Any writing style' },
  { value: 'self_written_or_ai_reviewed', label: 'Self-written or AI-reviewed' },
  { value: 'self_written_only', label: 'Self-written only' },
]
