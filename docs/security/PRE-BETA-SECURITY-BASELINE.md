# Tempa — Pre-beta security baseline

Recorded 2026-09-27 at the start of the pre-beta security workstream (Phase 0).
No production data, configuration, DNS, OAuth or environment was changed.

## Repository and deployment

| Item | Value |
|---|---|
| Repository | `afamagu/Tempa` |
| Branch | `security/pre-beta-2026-09-27` (from `main`) |
| HEAD | `0aeb8e697fd865d7afa700693662f596017173ee` (merge of PR #29) |
| Production deployment | `0aeb8e697fd865d7afa700693662f596017173ee` (GitHub deployments API, environment `Production`, 2026-09-26 22:27 UTC) |
| Production vs `main` | **Identical** — no divergence |
| Platform | Vercel (headers `Server: Vercel`, `X-Vercel-Cache`) |
| Production domain | `https://jointempa.com` (Let's Encrypt cert, SAN `jointempa.com`, valid to 2026-12-08) |
| Supabase project hostname | `gmggfxynconujrzlbtio.supabase.co` (verified in the production JS bundle) |
| Browser key | publishable key (`sb_publishable_…`) — correct for client use |

## Toolchain (from the lockfile / `node_modules`)

| Package | Version |
|---|---|
| Node (local) | 24.19.0 |
| next | 16.3.3 |
| react | 19.2.8 |
| @supabase/supabase-js | 2.112.4 |
| @supabase/ssr | 0.12.5 |

## Auth providers (from code)

- Google OAuth — `signInWithOAuth` in `app/sign-in/page.tsx`, `redirectTo` = `${origin}/auth/callback?next=…`.
- Email magic link — `signInWithOtp` with Cloudflare Turnstile `captchaToken`; verified by the
  `app/auth/confirm` server action (`verifyOtp` with `token_hash`).
- PKCE flow (forced by `@supabase/ssr`).

## Migration status

All tracked migrations through `2026-10-23-commerce-admin-operations.sql` are recorded as applied in
production (each paired verifier returned `overall_pass = true`). No unexecuted migration is
outstanding.

Caveat: several core tables (`profiles`, `questions`, …) were created outside `docs/sql`, and
production already differs from the migration files in at least one place (anon cannot execute
`is_pseudonym_available`, which no migration revokes). Migration text is therefore **not** treated
as proof of production authorization — see `docs/security/sql/production-authorization-audit.sql`.

## Live security headers (production, safe GETs)

| Header | Value / state |
|---|---|
| Strict-Transport-Security | `max-age=63072000; includeSubDomains` (no `preload`) |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `SAMEORIGIN` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` |
| Content-Security-Policy | **absent** (neither enforced nor Report-Only) |
| Access-Control-Allow-Origin | `*` on static / prerendered / edge-cached responses only; never on dynamic, redirect or API responses; `Access-Control-Allow-Credentials` never sent |
| TLS | 1.2 and 1.3 negotiate (ECDHE / AES-GCM). 1.0/1.1 could not be probed (local OpenSSL refuses to offer them) — external report says rejected |

## Baseline gates (before any change)

| Gate | Result |
|---|---|
| vitest | 5222 pass, **4 fail** — pre-existing on `main` (home/page ×2, dispatch-reader, photo-consent) |
| tsc | clean (exit 0) |
| eslint (repo) | 13 errors / 27 warnings — pre-existing on `main` (none in security-relevant code) |
| next build | compiles successfully |
