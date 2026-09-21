# Tempa launch email audit

Audited from the tracked `main` source tree. This describes source code, not a verification of live Supabase, Resend, DNS, or Vercel settings.

## What exists

- Email entry is `supabase.auth.signInWithOtp` in `app/sign-in/page.tsx`. The same call handles initial send and resend; Google OAuth is separate. The sign-in screen has a 60-second client cooldown, error copy, and optional Turnstile token. Current public copy still says “Sign in” and “Send magic link,” despite locked copy in `docs/brand-and-auth.md`.
- `app/auth/confirm/page.tsx` is a prefetch-safe human-click intermediate for the Supabase confirmation URL. `lib/auth-confirm.ts` validates the URL; `app/auth/callback/route.ts` exchanges the auth code and resolves onboarding, honoring a sanitized internal `next` path only after onboarding completes.
- `docs/tempa-build-guide.md` documents Resend SMTP on `jointempa.com`. The actual provider configuration and Supabase auth email template are outside tracked code.
- Letter delivery is governed by database `deliver_at`. The participant view exposes incoming rows only after delivery; `is_unread` derives from `opened_at`. Letter 1 arrives immediately; later letters may travel. `app/letters/[letterId]/page.tsx` is the participant-checked reader. See `docs/sql/2026-09-04-mail-call-atomic-deployment.sql` and `lib/letters.ts`.
- Member reports and admin moderation exist. Admin announcements publish in-app. Their presence does not imply outbound email.

## Missing from tracked code

- No Tempa application mail sender, templates, plain-text counterparts, or country-to-image manifest.
- No arrival-email trigger, delivery queue, retry worker, deduplication record, bounce/complaint webhook, or admin email failure view.
- No member email notification preferences or operational unsubscribe flow.
- No tracked Supabase auth-email template or live Resend/DNS configuration.

These code findings do not prove anything about untracked dashboard settings or external automation.

## Launch catalogue

| Event | Owner | Timing | Decision |
| --- | --- | --- | --- |
| Secure sign-in link for new or existing email | Supabase Auth | Member request | Required; preserve prefetch-safe human-click flow and safe return path. |
| Google sign-in | Google/Supabase Auth | Member request | Existing; no separate Tempa email for clicking Google. |
| Letter arrived, first contact | Tempa | Only after `deliver_at <= now()` | Required; no private content in email. |
| Letter arrived, established correspondence | Tempa | Only after `deliver_at <= now()` | Required; permitted sender pseudonym and exact-letter link. |
| Letter with Postcard or Moment | Tempa | Same arrival event | Use letter template; no attachment or media preview. |
| Account email change, deletion, or safety decision | Auth/admin workflow | Actual state change, if feature is deployed | Add necessary notice alongside real workflow. |
| Report submitted | In-app acknowledgement | Immediately | Exists; add email receipt/outcome only alongside a case/status and support path. |
| In-app announcement | Tempa admin | Publication | No automatic email broadcast. |
| Weekly activity digest | Tempa | Scheduled | Defer until specific events and preferences are agreed. |

Tracked auth uses magic links rather than passwords; password-reset and password-changed templates are not currently needed. Future commerce, gifts, Credits, birthdays, printing, and other unimplemented products do not generate launch email requirements.

## Arrival contract

1. Trigger on actual recipient delivery, never sender submission. Detect due letters with server time and a durable scan/claim.
2. Atomically claim one job per letter and recipient with a unique event key. Retry transient failures without duplicate sends; handle uncertain provider timeouts explicitly.
3. Before sending, verify current recipient, letter visibility, hidden correspondence, blocking, account state, and preference. Do not fetch private body or media for the mail job.
4. Resolve optional art from allowed coarse country code, with a neutral fallback. Do not state precise origin in copy.
5. Use one responsive Tempa shell with live HTML copy, a plain-text alternative, one action, and an image-free usable path. First contact uses generic language; established correspondence may use a permitted pseudonym.
6. Link to `/letters/{letter_id}` via existing safe auth callback `next` handling; the email itself grants no access.
7. Record state, attempts, provider ID, and bounded failure reason without storing letter content. Give admins a restricted failure view.

## Build sequence

1. Verify live Supabase auth template and Resend sender/DNS settings; copy current auth template into versioned source before editing.
2. Build and review responsive HTML/plain-text shell with images blocked, narrow mobile screens, and long names.
3. Add manifest for the 35 named email JPEGs plus neutral fallback; host email-sized images. A local ZIP is not a deployable image URL.
4. Implement delivery-driven, deduplicated arrival jobs and preference, then restricted admin failure view.
5. Test immediate first contact, delayed mail, opened state, hidden/blocked correspondence, missing art, logged-out return, retries, and provider failure; validate actual mailbox clients.
6. Audit real account, moderation, and support operations and add necessary messages where those operations exist.

## Live checks still needed

Confirm Supabase template target for `/auth/confirm`, URL validation origin, From-domain SPF/DKIM/DMARC, Resend webhook, provider logs, bounce policy, and actual delivery. GitHub source cannot prove these.
