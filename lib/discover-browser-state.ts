import type { DiscoveryRequest } from './discovery'

export type DiscoverValues = Record<string, string>
export function discoveryRequest(values: DiscoverValues, seed: string): DiscoveryRequest {
  return { country: values.country, language: values.language, ageRange: values.age,
    gender: values.gender, intent: values.intent, interest: values.interest, search: values.search,
    profileLed: true, peopleMode: 'browse', browseSeed: seed }
}
export function discoverUrl(values: DiscoverValues) {
  const params = new URLSearchParams(Object.entries(values).filter(([key, value]) =>
    ['country', 'language', 'age', 'gender', 'intent', 'interest', 'search'].includes(key) && value))
  return `/letters/discover${params.size ? `?${params}` : ''}`
}

