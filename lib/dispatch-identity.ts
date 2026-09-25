// Dispatch publication identity — the ONE place every surface resolves
// "who is this Dispatch from" (docs/sql/2026-10-15-official-sponsored-
// dispatches.sql). dispatches.published_as is canonical:
//
//   member     — the author's own profile identity (Mark, pseudonym,
//                country, profile link), exactly as before this existed.
//   tempa      — "Tempa" with the Tempa emblem. No member identity.
//   sponsored  — "Sponsored" + the sponsor's name. No member identity,
//                and never presented as Tempa authoring the sponsorship.
//
// author_id is still the real creating human (authorization, audit,
// storage ownership). For tempa/sponsored rows it is NEVER a display,
// link, Keep, or Write target — callers must use this module rather
// than reading authorPseudonym/authorId on their own.

export type PublishedAs = 'member' | 'tempa' | 'sponsored'

export type DispatchSponsor = {
  name: string
  ctaLabel: string | null
  /** Already validated by safeSponsorUrl — https only. */
  ctaUrl: string | null
}

export type DispatchIdentity =
  | { kind: 'member'; authorId: string; name: string; country: string | null; markUrl: string | null }
  | { kind: 'tempa'; name: 'Tempa' }
  | { kind: 'sponsored'; name: string; sponsor: DispatchSponsor }

export const TEMPA_IDENTITY_NAME = 'Tempa'
export const SPONSORED_LABEL = 'Sponsored'
export const DEFAULT_SPONSOR_CTA_LABEL = 'Learn more'

export function toPublishedAs(value: unknown): PublishedAs {
  return value === 'tempa' || value === 'sponsored' ? value : 'member'
}

/** https:// only, with a real host — anything else (javascript:, data:,
 * http:, custom schemes, malformed) renders no link at all. The
 * database already refuses to store such a URL; this is defence in
 * depth at the rendering boundary. */
export function safeSponsorUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.')) return null
    if (parsed.username || parsed.password) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function resolveDispatchIdentity(input: {
  publishedAs: PublishedAs
  authorId: string
  authorPseudonym: string | null | undefined
  authorCountry: string | null | undefined
  authorMarkUrl?: string | null
  sponsorName?: string | null
  sponsorCtaLabel?: string | null
  sponsorCtaUrl?: string | null
}): DispatchIdentity {
  if (input.publishedAs === 'tempa') return { kind: 'tempa', name: TEMPA_IDENTITY_NAME }
  if (input.publishedAs === 'sponsored') {
    const name = input.sponsorName?.trim() || SPONSORED_LABEL
    const ctaUrl = safeSponsorUrl(input.sponsorCtaUrl)
    return {
      kind: 'sponsored',
      name,
      sponsor: { name, ctaUrl, ctaLabel: ctaUrl ? input.sponsorCtaLabel?.trim() || DEFAULT_SPONSOR_CTA_LABEL : null },
    }
  }
  return {
    kind: 'member',
    authorId: input.authorId,
    name: input.authorPseudonym || 'A member',
    country: input.authorCountry ?? null,
    markUrl: input.authorMarkUrl ?? null,
  }
}

/** Member-identity actions (Keep in Mind, Write to this mind, profile
 * link, Pin to profile) only ever apply to a member Dispatch. */
export function hasMemberIdentity(identity: DispatchIdentity): identity is Extract<DispatchIdentity, { kind: 'member' }> {
  return identity.kind === 'member'
}

/** Share-sheet / page-metadata attribution — never "by Tempa · Tempa". */
export function dispatchShareTitle(title: string, identity: DispatchIdentity): string {
  if (identity.kind === 'tempa') return `${title} — Tempa`
  if (identity.kind === 'sponsored') return `${title} — Sponsored by ${identity.name} · Tempa`
  return `${title} — by ${identity.name} · Tempa`
}

/** Link-preview description — deliberately never the Dispatch body. */
export function dispatchShareDescription(identity: DispatchIdentity): string {
  if (identity.kind === 'tempa') return 'A Dispatch from Tempa.'
  if (identity.kind === 'sponsored') return `Sponsored Dispatch from ${identity.name} on Tempa.`
  return 'A Dispatch shared on Tempa.'
}

/** The small context line on the generated share image. */
export function dispatchShareContextLine(identity: DispatchIdentity): string {
  if (identity.kind === 'tempa') return 'A Dispatch from Tempa'
  if (identity.kind === 'sponsored') return `Sponsored · ${identity.name}`
  return 'A Dispatch shared on Tempa'
}

export function dispatchShareText(title: string, identity: DispatchIdentity): string {
  if (identity.kind === 'tempa') return `${title} — from Tempa`
  if (identity.kind === 'sponsored') return `${title} — Sponsored by ${identity.name}, on Tempa`
  return `${title} — by ${identity.name} on Tempa`
}
