# Public Dispatch web pages

Two independent dimensions:

| State | Meaning |
|---|---|
| **Published** | Appears on the Tempa Board (signed-in members). |
| **Public on the web** | Also has its own open-web article page, is in the sitemap and may be indexed. |

A Dispatch is *Published + Members only* or *Published + Public on the web*.

- **Member Dispatches** are members-only unless their author explicitly
  chooses *Public on the web* (composer checkbox, or the standing control
  under the title in the reader). Existing member Dispatches were not
  changed. Only the author can change it; a restricted/suspended account
  cannot make anything public; turning it off always works.
- **Official Tempa / Sponsored Dispatches** are public on the web by default
  (existing ones were backfilled); admins can turn it off.
- A public Dispatch never makes the author's profile public. The page shows
  only the public identity a share link already shows (pseudonym, country
  flag, generated Mindform) — no profile link.

## URL

`https://jointempa.com/dispatches/{slug}` — e.g.
`/dispatches/my-mother-never-apologised-she-cooked-a8f3c2`.

- **slug** = title words (lower-case ASCII, accents folded, ≤ 60 chars, cut
  at a word boundary; `dispatch` if empty) + `-` + 6 random hex characters.
  Globally unique (unique index), not derived from the author or the
  internal id.
- Generated once, the first time a Dispatch becomes public on the web
  (database trigger). **Permanent**: title edits, members-only ↔ public
  changes and moderation never change it (the trigger refuses to rewrite it).

## What is indexable

Exactly the Dispatches for which `tempa_private.dispatch_is_web_public` is
true **right now**:

`web_public AND web_slug IS NOT NULL AND status = 'published' AND
moderation_status = 'visible' AND (official/sponsored OR the author is
publicly visible — not suspended, banned, on a break or closed)`.

The same predicate gates the page (`get_public_dispatch`), the sitemap
(`list_public_dispatches`) and anonymous photo access
(`dispatch_photo_is_externally_shared`). Base tables keep their grants
(members SELECT only, anon nothing); robots.txt is not relied on for privacy.

## Page, metadata, structured data

- `app/dispatches/[slug]/page.tsx` — server-rendered, same Tempa reader as
  share links (`SharedDispatchView`), readable without an account. Title,
  identity, date, full body, photos and Postcard are in the server HTML;
  humans and crawlers get the same page.
- Metadata (`lib/public-dispatches.ts`): title
  `"{Dispatch title} — by {pseudonym} · Tempa"` (official/sponsored
  variants), description = first ~155 characters of the plain body (rich
  marks stripped, whole words), one absolute canonical, `index, follow`,
  Open Graph `article` with published/modified times, Twitter
  `summary_large_image`.
- Share image: `/dispatches/{slug}/opengraph-image` (and `twitter-image`) —
  Tempa's branded card with the title and public identity, re-checked on
  every request. Member photos are never used for metadata (they are only
  reachable through short-lived signed URLs).
- JSON-LD `BlogPosting`: headline, description, datePublished,
  dateModified, mainEntityOfPage, url, image (the card), author (Person =
  pseudonym; Organization for Tempa/sponsor), publisher Tempa, keywords =
  the Dispatch's own topics. Serialized with `<` escaped.

## Lifecycle

- **Edit**: same URL; `content_updated_at` is set only when the title or
  body actually changes → `dateModified` and sitemap `lastmod`.
  `datePublished` never changes.
- **Members only / hidden / author suspended / banned / on a break /
  unpublished (e.g. account closure) / deleted**: the next request returns
  **404** with `noindex` and none of the former title, text or images; the
  URL leaves the sitemap; its photos stop being anonymously readable; the
  share image falls back to the neutral Tempa card. All states return the
  same 404 so nothing reveals which one applies. (Next.js still lists the
  route's generated image URL on the 404 page; that image re-checks
  visibility and returns the neutral card.) Turning it public again
  (where allowed) restores the same URL.

## Sitemap and robots

- `app/sitemap.ts` — public pages + every public Dispatch
  (`lastModified` = last real content change, else first publication),
  built per request. `list_public_dispatches` caps at 45,000 URLs; beyond
  that split into a sitemap index (`generateSitemaps`).
- `app/robots.ts` — allow `/dispatches/` and `/_next/` (render assets) in
  addition to the public pages; everything else, including share links
  `/d/…`, stays disallowed. Share links remain `noindex` and link-only.

## Caching

Rendered per request with a stateless anonymous client (no session work,
no data cache). Privacy first: a change to members-only, moderation or
deletion takes effect on the very next request. If traffic later needs
caching, use short revalidation plus explicit invalidation from every
visibility change, never a long-lived cache of article content.

## Environment

- `SITE_URL` (`lib/site.ts`) = `https://jointempa.com` — canonical,
  Open Graph, JSON-LD and sitemap URLs are always absolute on it.
- No new environment variables. Database: apply
  `docs/sql/2026-10-27-public-dispatch-web-pages.sql`, then its verifier.

## Testing locally

- `npx vitest run tests/security/public-dispatches.test.ts lib/__tests__/publicDispatchWebPagesMigration.test.ts`
- Logged out: `curl -i http://localhost:3000/dispatches/<slug>` → 200 with
  the article in the HTML, `<link rel="canonical">`, `og:type=article`,
  one `application/ld+json` script; an unknown slug → 404 + `noindex`;
  `/sitemap.xml` lists it; `/robots.txt` allows `/dispatches/`.
- Validate with Google's Rich Results Test and, after deploy, URL
  Inspection in Search Console.
