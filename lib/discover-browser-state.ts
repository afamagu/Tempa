import type { DiscoveryRequest } from './discovery'

export type DiscoverValues = Record<string, string>

const INTENTIONAL_DISCOVER_KEYS = [
  'country',
  'language',
  'age',
  'gender',
  'intent',
  'interest',
  'search',
] as const

/**
 * Blank Discover is a bounded introduction surface. The moment a member
 * explicitly searches or applies a filter, they have expressed retrieval
 * intent and may browse the broader public directory with paging.
 */
export function hasIntentionalDiscoverCriteria(values: DiscoverValues): boolean {
  return INTENTIONAL_DISCOVER_KEYS.some((key) => Boolean(values[key]?.trim()))
}

export function discoveryRequest(values: DiscoverValues, seed: string): DiscoveryRequest {
  return {
    country: values.country,
    language: values.language,
    ageRange: values.age,
    gender: values.gender,
    intent: values.intent,
    interest: values.interest,
    search: values.search,
    profileLed: true,
    peopleMode: 'browse',
    browseSeed: seed,
    limit: 6,
  }
}

export function discoverUrl(values: DiscoverValues) {
  const params = new URLSearchParams(
    Object.entries(values).filter(
      ([key, value]) => INTENTIONAL_DISCOVER_KEYS.includes(key as (typeof INTENTIONAL_DISCOVER_KEYS)[number]) && value
    )
  )
  return `/letters/discover${params.size ? `?${params}` : ''}`
}
