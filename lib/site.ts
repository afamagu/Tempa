// Tempa's public presence — the ONE source for the production origin and
// the brand values used by root metadata, the web manifest and the
// generated share images. Colours mirror app/globals.css :root.

export const SITE_URL = 'https://jointempa.com'
export const SITE_NAME = 'Tempa'
export const SITE_DESCRIPTION = 'Meet people through what they think, write and choose to share.'

export const BRAND_BACKGROUND = '#f7f2e7' // --background (warm ivory)
export const BRAND_FOREGROUND = '#24211a' // --foreground (warm ink)
export const BRAND_MUTED = '#726a59' // --muted
export const BRAND_ACCENT = '#5b6b47' // --accent (moss)

/** Pre-beta security F-09 — the only pages crawlers are invited to index
 * (robots.ts allows exactly these; sitemap.ts lists them). Everything else
 * — the member app, shared Dispatch links (/d/…), /api, /auth, /admin —
 * is disallowed. The logged-out home (/) joins this list with the front
 * door. */
export const PUBLIC_INDEXABLE_PATHS = ['/sign-in', '/terms', '/privacy', '/community-guidelines', '/safety'] as const
