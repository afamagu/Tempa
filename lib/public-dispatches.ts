import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapSharedDispatchRow, type SharedDispatch, type SharedDispatchRpcRow } from '@/lib/dispatches'
import { dispatchShareTitle } from '@/lib/dispatch-identity'
import { editorialAuthorName } from '@/lib/editorial-byline'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import { SITE_NAME, SITE_URL } from '@/lib/site'

/**
 * Public Dispatch web pages (docs/public-dispatch-web-pages.md).
 *
 * "Published" puts a Dispatch on the Board (members only). "Public on the
 * web" is a separate choice. New member Dispatches default to public on
 * the web, with a clear control to turn that off before publishing; an
 * author's saved choice remains reversible afterward. Existing Dispatches
 * are never backfilled merely because the default changes. Official /
 * Sponsored Dispatches are public by default. A web-public Dispatch gets
 * one permanent article page at /dispatches/{slug}. Every anonymous read
 * goes through get_public_dispatch / list_public_dispatches, which return
 * nothing unless the Dispatch is public on the web RIGHT NOW (published,
 * moderation-visible, author publicly visible). Nothing here widens that.
 */

export const PUBLIC_DISPATCH_PATH = '/dispatches'
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function publicDispatchPath(slug: string): string {
  return `${PUBLIC_DISPATCH_PATH}/${slug}`
}

export function publicDispatchUrl(slug: string): string {
  return `${SITE_URL}${publicDispatchPath(slug)}`
}

export type PublicDispatch = SharedDispatch & {
  slug: string
  /** ISO: first publication (never rewritten by edits). */
  datePublished: string
  /** ISO: last real title/body change, else datePublished. */
  dateModified: string
}

type PublicDispatchRpcRow = Omit<SharedDispatchRpcRow, 'dispatch_id' | 'moments'> & {
  web_slug: string
  content_updated_at: string | null
  /** position + storage path only — get_public_dispatch never returns the
   * internal dispatch_moments.id. */
  moments: { position: number; image_path: string }[]
}

/** Presentation-only Moment identifiers for the public page (React keys,
 * viewer state): derived from the slug and order, never a database id. */
export function publicMomentIds(slug: string, moments: { position: number; image_path: string }[]) {
  return moments.map((m, i) => ({ id: `${slug}-moment-${i + 1}`, position: m.position, image_path: m.image_path }))
}

export async function getPublicDispatch(supabase: SupabaseClient, slug: string): Promise<PublicDispatch | null> {
  if (!slug || slug.length > 80 || !SLUG_PATTERN.test(slug)) return null
  const { data, error } = await supabase.rpc('get_public_dispatch', { p_slug: slug })
  const row = error ? undefined : ((data ?? []) as PublicDispatchRpcRow[])[0]
  if (!row) return null

  // The public reader is keyed by the slug; the internal Dispatch id and
  // the author's profile/auth id are never returned by the article RPC.
  const shared = await mapSharedDispatchRow(supabase, {
    ...row,
    dispatch_id: row.web_slug,
    moments: publicMomentIds(row.web_slug, row.moments ?? []),
  })

  // Public-on-the-web member Dispatches may carry the member's actual
  // Tempa Mark. The companion RPC returns ONLY the already-public,
  // independently-random Mark id after applying the same web-public gate;
  // never owner_id, profile data, or the source photograph. If the forward
  // migration is not live yet, this quietly falls back to the existing
  // neutral Mindform rather than breaking the article page.
  let identity = shared.identity
  if (identity.kind === 'member') {
    const { data: markId, error: markError } = await supabase.rpc('get_public_dispatch_mark', { p_slug: slug })
    if (!markError && typeof markId === 'string' && markId.length > 0) {
      identity = { ...identity, markUrl: publicProfileMarkUrl(supabase, `${markId}.png`) }
    }
  }

  const datePublished = row.published_at
  const dateModified = row.content_updated_at && row.content_updated_at > row.published_at ? row.content_updated_at : row.published_at
  return { ...shared, identity, slug: row.web_slug, datePublished, dateModified }
}

export type PublicDispatchListing = { slug: string; lastModified: string }

export async function listPublicDispatches(supabase: SupabaseClient): Promise<PublicDispatchListing[]> {
  const { data, error } = await supabase.rpc('list_public_dispatches')
  if (error || !data) return []
  return (data as { web_slug: string; last_modified: string }[])
    .filter((r) => SLUG_PATTERN.test(r.web_slug))
    .map((r) => ({ slug: r.web_slug, lastModified: r.last_modified }))
}

/** The Dispatch as plain text: rich-body marker removed and, for a rich
 * body, the **bold** / _italic_ marks decoded (escapes honoured). */
export function dispatchPlainText(body: string): string {
  const { isRich, body: clean } = stripRichBodyMarker(body)
  const text = isRich
    ? clean
        .replace(/\\\\/g, '\u0000B')
        .replace(/\\\*/g, '\u0000S')
        .replace(/\\_/g, '\u0000U')
        .replace(/\*\*/g, '')
        .replace(/_/g, '')
        .replace(/\u0000B/g, '\\')
        .replace(/\u0000S/g, '*')
        .replace(/\u0000U/g, '_')
    : clean
  return text.replace(/\s+/g, ' ').trim()
}

/** A clean meta description: whole words only, ≤ max characters. */
export function dispatchDescription(body: string, max = 155): string {
  const text = dispatchPlainText(body)
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.!?-]+$/, '')}…`
}

export function publicDispatchTitle(d: Pick<PublicDispatch, 'title' | 'identity'>): string {
  return dispatchShareTitle(d.title, d.identity)
}

export function publicDispatchImageUrl(slug: string): string {
  return `${publicDispatchUrl(slug)}/opengraph-image`
}

/** Server metadata for an available public Dispatch. */
/** The author as search engines see it — "Lady Larkspur, Tempa House
 * Columnist" for a house account; a member's own pseudonym otherwise. */
export function publicDispatchAuthorName(d: Pick<PublicDispatch, 'identity'>): string {
  return d.identity.kind === 'member'
    ? editorialAuthorName(d.identity.name, d.identity.editorialTitle)
    : d.identity.name
}

export function publicDispatchMetadata(d: PublicDispatch): Metadata {
  const title = publicDispatchTitle(d)
  // Named explicitly only for a house account, so search engines read the
  // disclosure; every other Dispatch's metadata is unchanged.
  const editorialAuthor = d.identity.kind === 'member' && d.identity.editorialTitle ? publicDispatchAuthorName(d) : null
  const description = dispatchDescription(d.body) || title
  const url = publicDispatchUrl(d.slug)
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    ...(editorialAuthor ? { authors: [{ name: editorialAuthor }] } : {}),
    openGraph: {
      type: 'article',
      siteName: SITE_NAME,
      title,
      description,
      url,
      publishedTime: d.datePublished,
      modifiedTime: d.dateModified,
      ...(editorialAuthor ? { authors: [editorialAuthor] } : {}),
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/** Metadata for any slug that is not public on the web right now. Says
 * nothing about whether it ever existed; never indexed. */
export const UNAVAILABLE_DISPATCH_METADATA: Metadata = {
  title: { absolute: 'Dispatch unavailable — Tempa' },
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
}

/** Schema.org BlogPosting describing exactly what the page shows. */
export function publicDispatchJsonLd(d: PublicDispatch): Record<string, unknown> {
  const url = publicDispatchUrl(d.slug)
  const publisher = {
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: { '@type': 'ImageObject', url: `${SITE_URL}/icons/icon-512.png` },
  }
  const author =
    d.identity.kind === 'member'
      ? {
          '@type': 'Person',
          name: publicDispatchAuthorName(d),
          ...(d.identity.editorialTitle
            ? { jobTitle: d.identity.editorialTitle, worksFor: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL } }
            : {}),
        }
      : d.identity.kind === 'sponsored'
        ? { '@type': 'Organization', name: d.identity.name }
        : { '@type': 'Organization', name: SITE_NAME, url: SITE_URL }
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: d.title,
    description: dispatchDescription(d.body) || d.title,
    datePublished: d.datePublished,
    dateModified: d.dateModified,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    image: [publicDispatchImageUrl(d.slug)],
    author,
    publisher,
    ...(d.topics.length > 0 ? { keywords: d.topics.join(', ') } : {}),
  }
}

/** JSON for a <script type="application/ld+json">: `<` escaped so the
 * content can never close the script element. */
export function jsonLdScriptContent(value: unknown): string {
  const LS = String.fromCharCode(0x2028)
  const PS = String.fromCharCode(0x2029)
  // Six-character escape sequences (backslash, "u", four hex digits).
  const BS = String.fromCharCode(0x5c)
  return JSON.stringify(value)
    .replace(/</g, `${BS}u003c`)
    .split(LS)
    .join(`${BS}u2028`)
    .split(PS)
    .join(`${BS}u2029`)
}

// ---------- the author's choice (members: own Dispatch; admins: official) ----------

export type DispatchWebState = { webPublic: boolean; webSlug: string | null }

/** The web state of a Dispatch the caller can already see. null when it
 * can't be read (e.g. before the 2026-10-27 migration is applied) — the
 * UI then simply doesn't offer the choice. */
export async function getDispatchWebState(supabase: SupabaseClient, dispatchId: string): Promise<DispatchWebState | null> {
  const { data, error } = await supabase.from('dispatches').select('web_public, web_slug').eq('id', dispatchId).maybeSingle()
  if (error || !data) return null
  const row = data as { web_public: boolean | null; web_slug: string | null }
  return { webPublic: row.web_public === true, webSlug: row.web_slug }
}

export type SetWebPublicResult =
  | { ok: true; webPublic: boolean; webSlug: string | null; live: boolean }
  | { ok: false; message: string }

export const WEB_PUBLIC_COPY = {
  label: 'Public on the web',
  on: 'Anyone can read this Dispatch, and search engines may index it. Your real identity and profile stay private; readers see only your Tempa identity — your pseudonym, country and Mark.',
  off: 'Tempa only — readable by Tempa members, not listed on the open web.',
  previewOn: 'Public on the web. Anyone can read this Dispatch, and search engines may index it. Your real identity and profile stay private; only your Tempa identity — pseudonym, country and Mark — is shown.',
  previewOff: 'Tempa only. This Dispatch will be available to Tempa members, not listed on the open web.',
  failed: 'Its web visibility couldn’t be changed. Nothing was changed — please try again.',
  saveRefused: 'Nothing was saved: this Dispatch’s web visibility couldn’t be applied. Please try again.',
  accountRefused: 'Nothing was saved: your account can’t make Dispatches public right now.',
} as const

/** The composer's message when the atomic save was refused because of the
 * requested web visibility (the whole save rolled back). null = not a
 * web-visibility refusal. */
export function webVisibilityRefusal(message: string | null | undefined): string | null {
  const code = message?.match(/DISPATCH_WEB:([a-z_]+)/)?.[1]
  if (!code) return null
  return code === 'account_unavailable' ? WEB_PUBLIC_COPY.accountRefused : WEB_PUBLIC_COPY.saveRefused
}

export async function setDispatchWebPublic(supabase: SupabaseClient, dispatchId: string, webPublic: boolean): Promise<SetWebPublicResult> {
  const { data, error } = await supabase.rpc('set_dispatch_web_public', { p_dispatch_id: dispatchId, p_public: webPublic })
  if (error || !data) {
    const code = error?.message?.match(/DISPATCH_WEB:([a-z_]+)/)?.[1]
    return {
      ok: false,
      message: code === 'account_unavailable' ? 'Your account can’t make Dispatches public right now.' : WEB_PUBLIC_COPY.failed,
    }
  }
  const r = data as { web_public: boolean; web_slug: string | null; live: boolean }
  return { ok: true, webPublic: r.web_public, webSlug: r.web_slug, live: r.live }
}

/** Whether the "Public on the web" choice can be offered (the 2026-10-27
 * columns exist). A failed probe hides the choice; nothing else changes. */
export async function webChoiceAvailable(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from('dispatches').select('web_public').limit(1)
  return !error
}
