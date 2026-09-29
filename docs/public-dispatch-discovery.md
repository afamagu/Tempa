# Public Dispatch discovery

This is the discovery layer around the open-web Dispatch pages introduced by `2026-10-27-public-dispatch-web-pages.sql`.

## Product boundary

Nothing here changes the Tempa member experience.

- The Board remains members-only.
- Profiles remain members-only.
- A member Dispatch is still web-public only after its author explicitly chooses **Public on the web**.
- Official / Sponsored Dispatches keep the existing default from the 10-27 migration.
- Making a Dispatch members-only, hidden, unpublished, deleted, or making its author unavailable removes it from the article page **and** every discovery RPC on the next request.
- Discovery RPCs return no internal Dispatch id and no author id.

## Public routes

- `/dispatches` — the public reading index.
- `/dispatches/{slug}` — one public Dispatch article.
- `/dispatches/topics/{topic-slug}` — a topic collection. Topic collections remain `noindex` until at least three public Dispatches exist for that topic, so Tempa does not manufacture thin SEO pages.

The index and topic collections use ordinary crawlable `<a>` links. Article pages add related public Dispatches selected by shared topics. This gives crawlers and humans a real information architecture instead of a set of sitemap-only islands.

## Structured data

The article page keeps its existing `BlogPosting` JSON-LD and adds a `BreadcrumbList` pointing through the public Dispatch index. Topic pages also carry breadcrumb markup. Structured data never contains member profile URLs or internal ids.

## SQL

Run after the 10-27 migration:

1. `docs/sql/2026-10-28-public-dispatch-discovery.sql`
2. `docs/sql/2026-10-28-public-dispatch-discovery-verify.sql`

The verifier is read-only and should return one row with `overall_pass = true`.

## Search launch

After both migrations and the app deployment are live:

1. Confirm a public Dispatch, `/dispatches`, and `/sitemap.xml` work while logged out.
2. Confirm a members-only Dispatch never appears in the index, related results, topic results, or sitemap.
3. Submit `https://jointempa.com/sitemap.xml` in Google Search Console.
4. Inspect `/dispatches` and one strong Dispatch URL and request indexing.
5. Validate one Dispatch with Google's Rich Results Test.
6. Monitor indexed pages, impressions, queries, click-through rate, and average position in Search Console.

Indexing is not a ranking guarantee. The architecture helps Google discover and understand Tempa's public writing; ranking still depends on the usefulness and originality of the writing, external signals, competition, and Google's systems.
