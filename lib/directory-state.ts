import type { DirectoryFilters } from './room-directory'

const FILTER_KEYS = ['country','language','search','age','gender','intent','interest'] as const

export function parseDirectoryFilters(raw: Record<string, string | string[] | undefined>): DirectoryFilters {
  const filters: DirectoryFilters = {}
  for(const key of FILTER_KEYS) {
    const value = raw[key]
    if(typeof value === 'string' && value.trim()) filters[key] = value.trim().slice(0, key === 'search' ? 80 : 100)
  }
  if(raw.letters === 'all') filters.letters = 'all'
  return filters
}

export function directoryUrl(filters: DirectoryFilters, restore=false): string {
  const params = new URLSearchParams()
  for(const key of FILTER_KEYS) {
    const value = filters[key]
    if(value) params.set(key,value)
  }
  if(filters.letters === 'all') params.set('letters','all')
  if(restore) params.set('restore','1')
  return `/letters/discover${params.size ? `?${params}` : ''}`
}
