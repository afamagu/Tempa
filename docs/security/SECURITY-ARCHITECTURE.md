# Tempa — Security architecture map

Current system as verified in code and, where possible, against production (2026-09-27).

## 1. Browser

| Element | Detail |
|---|---|
| Supabase client | `lib/supabase/client.ts` — `createBrowserClient` (`@supabase/ssr` 0.12.5), publishable key, PKCE |
| Session persistence | **Cookie** `sb-<ref>-auth-token` (base64, chunked when large) holding access token, refresh token and user. Verified empirically (jsdom run of the real library with a mocked auth server): `localStorage` and `sessionStorage` stay **empty** of auth material. `userStorage → localStorage` is used by `@supabase/ssr` only with the opt-in `tokens-only` cookie encoding, which Tempa does not use. |
| Cookie attributes | `@supabase/ssr` defaults, not overridden: `Path=/`, `SameSite=Lax`, **`HttpOnly=false`** (the browser client must read it), **no explicit `Secure`**, `Max-Age` 400 days. PKCE code-verifier is a cookie too. |
| Other browser storage | `localStorage`: letter drafts, first-letter drafts, question-answer drafts, dispatch drafts (private content, not cleared at sign-out). `sessionStorage`: UI hints (moment hint, member-introduction pacing). No IndexedDB use. |
| Direct table writes | `profiles` INSERT (onboarding), `correspondence_feature_acknowledgements`, `dispatch_views`, `reading_places` (own-row, low impact). Everything substantive goes through RPCs. |
| Uploads | letter photos → `letter-photos`, Dispatch photos → `dispatch-photos`, Mark PNG → `profile-marks`, admin: `announcement-images`, `postcard-artwork` |
| Public links | `/d/<shareToken>` (shared Dispatch) |
| CAPTCHA | Cloudflare Turnstile on magic-link send/resend (single-use token) |

## 2. Next.js server

| Element | Identity source | Authorization |
|---|---|---|
| `proxy.ts` (matcher: `/`, `/admin`, `/board`, `/home`, `/letters`, `/minds`, `/profile`, `/question`, `/write`, `/you`, `/announcement`) | cookie session (`getUser`) | unauthenticated → `/sign-in?next=`; account-entry state (paused/closed/banned/onboarding) routing |
| Server Components | cookie session via `lib/supabase/server.ts` | RLS + RPC checks in Postgres |
| `app/auth/callback/route.ts` | OAuth/PKCE code exchange | `next` sanitized; redirect prefixed with origin |
| `app/auth/confirm` server action | `verifyOtp(token_hash)` | `next` sanitized (see finding F-01) |
| `app/begin/page.tsx` | session | account-entry sequence; redirects to `next` (F-01) |
| `app/api/safety/evaluate` (POST) | session (`getUser`) | server-side rate limit (service role) → `can_evaluate_safety_context` as the member → local classifier → `record_safety_evaluation` (service role) |
| `app/api/cron/arrival-emails` | `Authorization: Bearer CRON_SECRET` (constant-time compare) | service role → queue claim/snapshot/complete |
| `app/you/account/actions.ts` | session | closure: `close_my_account` as member, storage cleanup + auth-user disable via service role, global sign-out |
| `app/begin/sign-out-action.ts` | session | `signOut()` |
| Admin (`app/admin/**`) | session | layout: `is_staff()`; every admin RPC re-checks `is_staff('moderator'|'admin')` in Postgres; commerce is admin-only |

Service-role key: only `lib/supabase/service.ts` (`import 'server-only'`), used by the three server
entry points above. Absent from all production JS bundles (verified).

## 3. Supabase / Postgres

- **PostgREST (anon)**: verified in production that anon is denied SELECT on 22 core tables
  (profiles, letters, correspondences, questions, question_answers, moments, letter_postcards,
  dispatches, dispatch_replies, blocked_users, reports, safety_evaluations,
  account_enforcement_state, staff_roles, admin_audit_log, commerce_*, postcard_*, profile_marks)
  and EXECUTE on member/admin RPCs. Only the shared-Dispatch token functions are anon-callable.
- **RLS**: enabled on all 73 tables created in `docs/sql` (50 via `alter table`, 23 commerce via a
  DO loop, confirmed by the 10-20 verifier). Tables created outside `docs/sql` must be confirmed with
  `docs/security/sql/production-authorization-audit.sql`.
- **SECURITY DEFINER**: 176 `public` functions in migrations; every definer checked pins
  `search_path` (to be confirmed by audit query F). Identity is taken from `auth.uid()`, never from a
  client-supplied user id (static review in ATTACK-SURFACE-MAP.md).
- **Service-only functions**: `check_rate_limit` (revoked from authenticated, verified in SQL);
  `record_safety_evaluation`, `resolve_arrival_email_context`, `record_or_fetch_arrival_email_snapshot`,
  `complete_arrival_email_job` revoked only `from public` — anon verified denied in production;
  **authenticated must be confirmed** (finding F-05).
- **Storage**: see §5.
- **Realtime**: not used by the app (the Realtime client is bundled by supabase-js only).

## 4. Privileged infrastructure

| Component | Credential | Scope |
|---|---|---|
| Arrival-email worker (cron) | `CRON_SECRET` + service role + `RESEND_API_KEY` | queue rows, snapshot, send, complete |
| Safety evaluate route | service role | rate-limit counters, evaluation record |
| Account closure action | service role | storage objects of the closing member, auth-user disable |
| Admin UI | member session + `is_staff` | moderation, members, content, commerce (admin) |
| Resend | `RESEND_API_KEY` (server env) | arrival emails |
| Turnstile | secret configured in Supabase Auth (not in the app) | magic-link captcha |

## 5. Storage buckets

| Bucket | Public | Write | Read | Notes |
|---|---|---|---|---|
| `letter-photos` | no | correspondence participants (`is_correspondence_participant(folder)`) | `can_view_letter_photo(name)`; staff only for reported evidence | private correspondence |
| `dispatch-photos` | no | owner folder = `auth.uid()` | `dispatch_photo_is_visible`; anon only for externally shared Dispatches; staff for reported evidence | owner delete |
| `profile-marks` | **yes** (intentional) | `profile_mark_upload_allowed`: `<uuid>.png` of the caller's own **pending** Mark only; PNG only; 1 MB; `upsert:false` | public URL | Mark = public profile art; source photo never uploaded (client-side generation) |
| `announcement-images` | no | admin, own folder | `announcement_image_is_visible` | JPEG/PNG/WebP, 5 MB |
| `postcard-artwork` | **yes** (intentional) | admin | public | JPEG/PNG/WebP/MP4, 20 MB |

No bucket has an UPDATE policy — objects cannot be overwritten.

## 6. Trust boundaries (summary)

| Boundary | Caller | Identity | Credential | Authorization | Reachable data | Mutations |
|---|---|---|---|---|---|---|
| Browser → Next pages | visitor/member | cookie session | Supabase JWT (cookie) | proxy + RLS/RPC | own + permitted rows | via RPCs |
| Browser → PostgREST | member | JWT | publishable key + JWT | RLS + function checks | as above | RPCs, 8 low-impact own-row tables |
| Browser → Storage | member | JWT | same | storage.objects policies | per §5 | uploads per §5 |
| Next → Postgres (service) | server | server env | service-role key | none in DB (bypasses RLS) — code-reviewed call sites only | all | rate limits, evaluations, email queue, closure cleanup |
| Vercel Cron → Next | platform | shared secret | `CRON_SECRET` | constant-time compare | queue | email sends |
| Anonymous → `/d/<token>` | anyone | none | share token | token lookup (`get_shared_dispatch`) | one shared Dispatch | none |
