# Tempa — Attack-surface map

Callers: **anon**, **auth** (any signed-in member), **owner**, **participant** (correspondence
member), **restricted / suspended / banned**, **mod** (staff moderator), **admin**, **service**.
"Enforced at" is the trusted boundary actually doing the check (never the UI).

## Authentication & account

| Operation | Caller | Enforced at | Notes |
|---|---|---|---|
| Google OAuth | anon | Supabase Auth; `/auth/callback` (PKCE code exchange) | callback prefixes origin to `next` — safe |
| Magic link send / resend | anon | Supabase Auth rate limits + Turnstile (`captchaToken`) | no account-existence difference in UI copy (to verify live) |
| Magic link verify | anon (token holder) | `verifyOtp(token_hash)` server action | **F-01** open redirect via dot-segment `next` |
| Account entry (`/begin`) | auth | proxy + `resolveAccountEntryDestination` | **F-01** |
| Onboarding profile create | auth | triggers: `id = auth.uid()`, adult eligibility required, stage forced to `mark`, `mark_id` null | direct INSERT; UPDATE privilege **to verify (F-04)** |
| Mark finalize/discard | owner | `finalize_profile_mark` / `discard_profile_mark` (owner check) | |
| Deactivate / reactivate | auth | RPCs (`auth.uid()`) | |
| Close account | auth | `close_my_account` + service-role cleanup + global sign-out | proven across 10-16/18/19 |
| Sign-out | auth | `supabase.auth.signOut()` (local scope) / global on closure | drafts remain in localStorage (F-15) |

## Profile, Questions, discovery

| Operation | Caller | Enforced at |
|---|---|---|
| Publish answer | auth, not restricted | `publish_question_answer` + consumed safety evaluation |
| Set current answer | owner | `set_current_answer` (owner check) |
| People discovery / introductions | auth | `discover_people`, `get_member_introductions` (blocks, hidden, enforcement) |
| Keep in Mind | auth | `keep_mind` / `unkeep_mind` (`auth.uid()`) — no rate limit |
| Interests / preferences | owner | RPCs / own-row tables |
| Pseudonym availability | auth (anon denied — verified) | `is_pseudonym_available`, `suggest_available_pseudonyms` |

## Correspondence (critical asset)

| Operation | Caller | Enforced at |
|---|---|---|
| First letter | auth, not suspended/banned | `send_first_letter` — recipient's current answer, blocks, enforcement, consumed evaluation, rate limit |
| Reply | recipient of the letter | `reply_to_letter` — `recipient_id = auth.uid()`, status `sent`, blocks, enforcement, evaluation |
| Write anytime | participant | `write_letter` — participant check, blocked pair, enforcement, established correspondence, evaluation |
| Read letters | participant | `letters_for_participant` view + RLS; anon denied (verified) |
| Moments (photos) | participant | `letter-photos` policies (`is_correspondence_participant`, `can_view_letter_photo`), photo consent state |
| Postcards on letters | participant, owner of premium artwork | RPC gate + commerce ownership trigger (checkpoint 2) |
| Keepsakes | recipient | `get_my_postcards` (`auth.uid()`), `remove_my_postcard` |
| Close letter / feedback | recipient | `close_letter` |
| Mark opened | recipient | `mark_letter_opened` |
| Photo sharing consent | participant | `request_photo_sharing` / `respond_photo_sharing` |

## Board / Dispatch

| Operation | Caller | Enforced at |
|---|---|---|
| Publish / update | auth, not restricted/suspended/banned | `publish_dispatch` / `update_dispatch` (author check) + evaluation + rate limit |
| Delete / pin / unpin | author | `delete_dispatch`, `pin_dispatch`, `unpin_dispatch` |
| Replies | auth | `create_reply` (visibility, blocks, evaluation, rate limit), `delete_reply` (author) |
| Worth Reading | auth | `set_dispatch_worth_reading` |
| Share link | author | `share_dispatch` (published only), `revoke_dispatch_share` |
| Public view `/d/<token>` | anon | `get_shared_dispatch` (token; revocation respected); photos via `dispatch_photo_is_externally_shared` |
| Official / sponsored Dispatch | admin | `publish_official_dispatch` / `update_official_dispatch` (`is_staff('admin')`, https-only CTA CHECK) |

## Safety & moderation

| Operation | Caller | Enforced at |
|---|---|---|
| Safety evaluate | auth | `/api/safety/evaluate` — session, server rate limit, context authorization, local classifier, service-role record |
| Consume evaluation | internal (inside write RPCs) | `consume_safety_evaluation`: row lock, owner, surface, context, answer, target, single use, expiry, content fingerprint, enforcement status, deny/warn |
| Report | auth | `report_content` (+ rate limit) |
| Block / unblock | auth | `block_user` / `unblock_user` (+ rate limit) |
| Restrict / suspend / ban / restore | mod | `admin_set_account_status` (`is_staff('moderator')`, reason required, staff accounts protected, audited, member notice) |
| Hide / restore content | mod | `admin_hide_*` / `admin_restore_*` |

## Admin

77 `admin_*` RPCs in migrations; every one checks `is_staff(...)` (directly or via
`commerce_require_admin` / `commerce_admin_credit_op`) — verified statically; anon denied EXECUTE
(verified live for `admin_commerce_overview`). `/admin` layout redirects non-staff; commerce UI is
admin-only and its RPCs re-check the role.

## Storage

See SECURITY-ARCHITECTURE.md §5.

## Infrastructure

| Endpoint | Caller | Enforced at |
|---|---|---|
| `GET/POST /api/cron/arrival-emails` | Vercel Cron | Bearer `CRON_SECRET`, constant-time |
| `POST /api/safety/evaluate` | auth | above; OPTIONS returns no CORS grant |
| `GET /auth/callback` | anyone | code exchange; failures → `/sign-in?error=auth_failed` |
| `/api/broadcast` | — | **does not exist** (404); the string is supabase-js Realtime internals |

## ID-substitution review ("what if Alice passes Bob's ID?")

Every member-callable function that accepts a user/resource id derives the actor from `auth.uid()`
and checks ownership, participation or visibility (block_user, close_letter, delete_dispatch,
delete_reply, finalize/discard_profile_mark, keep_mind, mark_letter_opened, pin/unpin_dispatch,
remove_my_postcard, reply_to_letter, report_content, request/respond_photo_sharing,
revoke/share_dispatch, send_first_letter, set_current_answer, set_dispatch_worth_reading,
update_dispatch, write_letter, commerce_* via `commerce_require_spender`). Functions that accept
another member's id without an `auth.uid()` ownership check are all service-only
(`check_rate_limit`, `record_safety_evaluation`, arrival-email functions) — privilege for
`authenticated` pending confirmation (F-05). `compute_deliver_at(sender, recipient)` is called
inside write RPCs; its direct EXECUTE grant is to be confirmed by audit query D.
