import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchDescription, publicDispatchPath } from '@/lib/public-dispatches'
import { SITE_URL } from '@/lib/site'

export const PUBLIC_DISPATCH_INDEX_PATH = '/dispatches'
export const PUBLIC_DISPATCH_TOPIC_BASE_PATH = '/dispatches/topics'
export const PUBLIC_TOPIC_MIN_INDEXABLE_COUNT = 3

export type PublicDispatchPreviewIdentity =
  | { kind: 'member'; name: string; country: string | null }
  | { kind: 'tempa'; name: 'Tempa' }
  | { kind: 'sponsored'; name: string }

export type PublicDispatchPreview = {
  slug: string
  title: string
  bodyPreview: string
  publishedAt: string
  lastModified: string
  topics: string[]
  identity: PublicDispatchPreviewIdentity
}

type PublicDispatchPreviewRpcRow = {
  web_slug: string
  title: string
  body_preview: string
  published_at: string
  last_modified: string
  author_pseudonym: string | null
  author_country: string | null
  topics: string[] | null
  published_as: string | null
  sponsor_name: string | null
}

export type PublicDispatchTopic = {
  key: string
  label: string
  count: number
  lastModified: string
}

type PublicDispatchTopicRpcRow = {
  topic_key: string
  topic_label: string
  dispatch_count: number | string
  last_modified: string
}

function toPreview(row: PublicDispatchPreviewRpcRow): PublicDispatchPreview {
  const publishedAs = row.published_as === 'tempa' || row.published_as === 'sponsored' ? row.published_as : 'member'
  const identity: PublicDispatchPreviewIdentity =
    publishedAs === 'tempa'
      ? { kind: 'tempa', name: 'Tempa' }
      : publishedAs === 'sponsored'
        ? { kind: 'sponsored', name: row.sponsor_name?.trim() || row.author_pseudonym?.trim() || 'Sponsored' }
        : { kind: 'member', name: row.author_pseudonym?.trim() || 'A TEMPA member', country: row.author_country ?? null }

  return {
    slug: row.web_slug,
    title: row.title,
    bodyPreview: row.body_preview ?? '',
    publishedAt: row.published_at,
    lastModified: row.last_modified,
    topics: row.topics ?? [],
    identity,
  }
}

export async function listPublicDispatchPreviews(
  supabase: SupabaseClient,
  options: { limit?: number; topic?: string | null } = {}
): Promise<PublicDispatchPreview[]> {
  const { data, error } = await supabase.rpc('list_public_dispatch_previews', {
    p_limit: options.limit ?? 24,
    p_topic: options.topic ?? null,
  })
  if (error || !data) return []
  return (data as PublicDispatchPreviewRpcRow[]).map(toPreview)
}

export async function listRelatedPublicDispatches(
  supabase: SupabaseClient,
  slug: string,
  topics: string[],
  limit = 4
): Promise<PublicDispatchPreview[]> {
  if (topics.length === 0) return []
  const { data, error } = await supabase.rpc('list_related_public_dispatches', {
    p_slug: slug,
    p_topics: topics,
    p_limit: limit,
  })
  if (error || !data) return []
  return (data as (PublicDispatchPreviewRpcRow & { shared_topic_count?: number | string })[]).map(toPreview)
}

export async function listPublicDispatchTopics(supabase: SupabaseClient): Promise<PublicDispatchTopic[]> {
  const { data, error } = await supabase.rpc('list_public_dispatch_topics')
  if (error || !data) return []
  return (data as PublicDispatchTopicRpcRow[])
    .filter((row) => row.topic_key && row.topic_label)
    .map((row) => ({
      key: row.topic_key,
      label: row.topic_label,
      count: Number(row.dispatch_count) || 0,
      lastModified: row.last_modified,
    }))
}

function normalizedTopicForHash(topic: string): string {
  return topic.trim().normalize('NFKC').toLocaleLowerCase('en-US')
}

function topicHash(topic: string): string {
  let hash = 0x811c9dc5
  for (const char of normalizedTopicForHash(topic)) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function publicTopicSlug(topic: string): string {
  const words = normalizedTopicForHash(topic)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return `${words || 'topic'}-${topicHash(topic)}`
}

export function publicTopicPath(topic: string): string {
  return `${PUBLIC_DISPATCH_TOPIC_BASE_PATH}/${publicTopicSlug(topic)}`
}

export function publicTopicUrl(topic: string): string {
  return `${SITE_URL}${publicTopicPath(topic)}`
}

export function findPublicTopicBySlug(topics: PublicDispatchTopic[], slug: string): PublicDispatchTopic | null {
  return topics.find((topic) => publicTopicSlug(topic.label) === slug) ?? null
}

export function publicTopicIsIndexable(topic: PublicDispatchTopic): boolean {
  return topic.count >= PUBLIC_TOPIC_MIN_INDEXABLE_COUNT
}

export function publicDispatchPreviewDescription(preview: PublicDispatchPreview, max = 220): string {
  return dispatchDescription(preview.bodyPreview, max)
}

export function publicDispatchPreviewByline(preview: PublicDispatchPreview): string {
  if (preview.identity.kind === 'tempa') return 'Tempa'
  if (preview.identity.kind === 'sponsored') return `Sponsored by ${preview.identity.name}`
  return preview.identity.country ? `${preview.identity.name} · ${preview.identity.country}` : preview.identity.name
}

export function publicDispatchPreviewPath(preview: Pick<PublicDispatchPreview, 'slug'>): string {
  return publicDispatchPath(preview.slug)
}
