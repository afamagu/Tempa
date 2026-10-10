# Tempa — The Room: architecture, migration, release gates

Status: **approved implementation direction; NOT released**. Prepared October 10, 2026 from a read-only audit of production schema/RPCs and GitHub `main` at `e83218e291a3873789cc4b30300e71d5ddcf7a37`. This branch is not a production migration. Never apply schema changes, enable a feature, or merge into main solely because this document exists.

## Product invariant

**A person leaves a public letter in The Room. Another person reads it. If moved, they write privately to that author. A reply—not a sent first letter—establishes the correspondence.** This is the path advertised on the new landing page. No Question answer is required. History is retained. No social engagement scores, artificial abundance, or advertising overlay while reading.

Public writing here means discoverable by authenticated members of Tempa, **not** automatically on the open web. Open-web searchability is a separate OFF-by-default, reversible choice.

Locked navigation: **Home · Letterbox · The Room · You**. No separate member-facing Board or Dispatch concept. The Board and Dispatch implementation remain internal as needed to avoid destructive migration. Keep official/sponsored editorial material in an honest secondary location instead of silently displaying sponsored authors as ordinary member letters.

## Confirmed technical blockers (not conjecture)

- `app/room/page.tsx` currently leads with an active Question, six answer cards, Question suggestions, archive and Discover People.
- `app/board/page.tsx` currently owns an existing finite composition and explicit Search; `lib/dispatches.ts` owns stable cursor-based `board_feed_page`, author mapping, visibility and read progress. Reuse the latter; **do not simply rename a Board component and assume discovery now meets six unique authors**.
- `app/board/[dispatchId]/page.tsx` only shows the private Write CTA if the author has a qualifying Question answer. The URL passes `?a=<answer>&d=<dispatch>&source=dispatch`.
- `app/write/[recipientId]/page.tsx` rejects a new first contact without `a`; `first-letter-composer.tsx` always evaluates `surface='first_letter'` with a Question answer. `send_first_letter_from_dispatch` validates the Dispatch but delegates to `send_first_letter` with a real Question answer.
- Production `safety_evaluations` CHECK constraint requires a non-null Question answer **if and only if** `surface='first_letter'`, and permits `secondary_context_id` only for `dispatch_reply`. Both would reject a naive Dispatch-origin safety evaluation.
- `public.can_evaluate_safety_context` validates the Question answer and counts first-letter attempts only where `letters.question_answer_id IS NOT NULL`. `send_first_letter` does the same. Both must recognize dispatch-origin first letters, one 7-day follow-up, recipient passes, and active/paused correspondences in a unified rule.
- `letters.question_answer_id` is already nullable. `dispatch_letter_contexts` already stores the source letter id, public writing id, and title snapshot, and preserves the title if the source is deleted. `tempa_private.enforce_first_contact_capacity` is the essential server-side capacity trigger.
- `app/board/dispatch-composer.tsx` defaults `initialWebPublic` to `true`, and `publish_dispatch_with_web_visibility` defaults `p_web_public=true` even though `dispatches.web_public` defaults false. Both must change for new member publications. Existing choices and public links must remain intact.
- `delete_dispatch` refuses deletion if any public reply exists. A separate reversible **withdraw-from-discovery** action is necessary; it must not delete already-delivered private letters or public Reply history.
- Home leads with correspondences correctly but adds an active weekly Question and “From the Board”; both member-facing copy and component wiring must be reconciled.
- `/dispatches` and `/dispatches/[slug]` are already indexable external routes. `/d/[shareToken]` is a distinct token-based sharing route; avoid merging them or accidentally widening private visibility.
- Pilot content is thin (last read: eight member Dispatches, two official), so “six new authors” is **best effort** until actual participation grows. Do not duplicate cards or invent authors just to fill a grid.

## One canonical URL topology

**New member URLs (proposed and locked for implementation):**

| Meaning | Canonical path |
| --- | --- |
| The Room / first six letters | `/room` |
| Member Room reading / resume / private CTA | `/room/letters/[id]` |
| Leave a letter | `/room/write` |
| Edit own letter | `/room/letters/[id]/edit` |
| Existing private first-contact / established correspondence | `/write/[recipientId]`, `/letters/with/[recipientId]`, `/letters/[letterId]` (keep) |
| Public open-web reading | `/read/[slug]` (new canonical; historic links remain valid or redirect only after authorization-equivalent verification) |
| Private shared link | `/d/[shareToken]` (preserve; do not confuse with public searchability) |
| Historic Question archive | `/room/questions`, `/question/[questionId]` (direct links remain valid as secondary history, not promoted on The Room landing) |
| Discover People | `/letters/discover` (preserve) |

Historic paths: `/board` (including old `?q,s,seed`) → `/room` or a Room search/entry point; `/board/write` → `/room/write`; `/board/[id]` (+ relevant reading-trail query) → canonical letter reader; `/board/[id]/edit` → canonical edit. Continue to serve or safely redirect old web-public `/dispatches/[slug]`, topic pages, indexed OG links and the token shares. Preserve legal links, onboarding deep links, profile return destinations, admin editorial routes, and all pre-existing correspondence URLs. Do not blindly redirect anonymous open-web URLs to member-only pages.

**Important:** no redirect lands on a dead page or silently discards the specific author/letter context that brought the visitor in; use safe, local, allowlisted `returnTo` values and avoid untrusted open redirects.

## Implementation phases / dependency gates

### 0 — Dependency inventory and regression harness (start here)

- Freeze current branch baseline and inspect all occurrences of member-visible “Dispatch”/“Board”/“weekly Question” and all calls to the source RPCs.
- Inventory every entry into The Room, Board, publication, first-contact, public share, profile, Home, question archives, admin, email and notification links. Classify each as NEW / COMPATIBILITY / HISTORIC-ONLY.
- Establish pure URL helpers and tests; pure, author-diverse six-letter selection rules and tests. Add end-to-end tests for fresh account, established counterpart, pending first letter, blocked pair, restricted account and author-deleted/withdrawn source.
- Leave navigation and production code untouched until native first contact is ready. Protect partial work behind feature branch / flags.

### 1 — Safe, native public-letter → first-contact plumbing (MUST precede changing Room navigation)

- Add a **distinct server-trusted safety surface**, e.g. `first_letter_from_room_letter`, with `recipientId` as main context and **specific public-letter ID** as secondary context. Bind both to evaluation fingerprint and subsequent consuming RPC. The server validates the public letter's actual author, published/visible/member status, moderation, author account visibility and bilateral block before classification.
- Revise the safety-evaluation CHECK constraints, parsed request whitelist, per-surface rate-limit mapping (share the established `first_letter` quota), privacy warning/recipient notice handling, and security tests. Do **not** fake Question answer identifiers or route through existing `first_letter` without secure source binding.
- Add one native RPC for source-letter first contact or a shared private first-contact core that supports *both* real Question answers and Room letters. Reuse the capacity locks/trigger, correspondence uniqueness, one unanswered episode, recipient's pass decision, seven-day follow-up, 2,000-character first-letter limit, safety evaluation single-use, moderation and explicit source metadata.
- Review every first-contact count/read query and state machine currently assuming `question_answer_id IS NOT NULL`. An existing question-origin letter remains valid with its original answer. A source-origin letter stores `question_answer_id=NULL` and snapshots its source in `dispatch_letter_contexts`. Follow-ups retain original source, not the latest URL.
- Preserve writer draft on 403, 429, safety refusal, network failure, login handoff and capacity-limit failures. A sent letter already waiting for a reply must never generate a second unrelated episode; an already-established counterpart uses Write Anytime.
- **Production SQL is owner-applied only after a full migration, read-only verifier, local regression and explicit owner approval.** Do not execute DDL, DML, or turn flags on in live Supabase.
- Validate adversarial SQL path: forged author/source pair; a hidden/unpublished/sponsored source; own source; bilateral blocks; stale safety token; altered text or source after evaluation; same token twice; concurrent sends; one allowed follow-up; two rejected; refusal; paused/ended/established; account restrictions. Fail closed.

### 2 — The Room reading and discovery

- Build the Room above the existing published member writing store and visibility rules. No Question panel. Header “The Room”; quiet descriptor “Letters left here”; **Leave a letter**.
- Display **up to six** letter previews per batch, preserving one-author-per-browsing-session wherever genuinely possible, one modestly featured card without popularity inference, readable stationery treatment and obvious card/link hit areas. “Keep looking” fetches the next bounded stable cursor batch; deduplicate IDs, avoid same-author repeats until the available pool is exhausted. Fewer than six is honest.
- Use existing read history, profile identity, author writings, Safety flags and exposure fairness; do not issue unbounded client queries or silently swallow RPC errors as an empty room. Empty, all-read, loading, retry, restricted and no-new-author states need differentiated calm copy.
- Reader keeps author attribution, text, rich formatting, Moments, postcards, report/block, share, Keep in Mind, save/Worth Reading if applicable, reading position, public replies, author's edit/withdraw, and optional external visibility. Priority at the end is **Write to [pseudonym]**. Public Reply stays below, not a competing CTA. Own/official/sponsored writing never prompts private first contact to a fictional correspondent.
- Return/back retains discovery session, reading position and page state. The user must be able to read, start writing, back out and recover the Room with their place intact.

### 3 — Leave a letter and visibility lifecycle

- Reuse existing rich editor, safety gate, drafts, photos, writing styles, postcards, public mentions, preview and anti-double-submit. Change member labels only: “Leave a letter”, “Letter title”, “Preview letter”, “Leave letter”. Keep admin's distinct official/sponsored publishing semantics internally.
- Title remains technically mandatory until safely loosened with DB and parser updates, but UI must not feel like an essay assignment. Topics optional; lightweight optional first-sentence starters. Never mandatory prompts or arbitrary minimum word count.
- New **member** letters default to Tempa-only at both UI and RPC boundaries; “Let this letter be found beyond Tempa” is explicit and OFF until toggled. Clarify public search indexing is not immediate and de-indexing is not instantaneous.
- Add reversible **withdraw from discovery** with state and public-web revocation while preserving private correspondence snapshots, already-received letters and historical public replies as governed by moderation/privacy policy. Require tests with pending first contacts and active conversations.
- Retain original edit lock semantics initially (30 minutes / reply lock); if later revised, implement and test separately rather than quietly promising unlimited editing.

### 4 — All affected member/public surfaces

- Switch desktop/mobile nav from five to four, preserve the Room door icon, icon badges, translated labels, mobile focus order and active states.
- Home's arrival/Letterbox priority stays. Replace weekly public Question and “From the Board” with **From the Room**, 0–3 author-diverse previews and canonical links. Keep member-introduction reminder semantics independently until a separate explicit decision replaces the optional onboarding Question.
- Update profile writing shelves, reader-next shelves, saved writing, share action text, moderation labels, report destinations, Guide, You/Archive/Kept writing, notification templates and email deep links. Admin can keep schema names but members cannot see stale Dispatch jargon.
- Make historic `/room?question=...` links reach the intended question or archive (not silently ignore the requested question). Preserve old Board and web-public routes, existing backlinks/search snippets, OG and metadata, robots/sitemap, and publisher privacy gates. Do not redirect public articles to a sign-in wall just to rename “Dispatch”.
- Onboarding: no **forced** first public letter. A small optional “You can leave something here, too” appears only after ordinary reading; no modal over the content. Keep safety and eligibility gates.

### 5 — QA, evidence and controlled release (NO completion before this)

- **Automated:** typecheck, lint, build, all focused existing tests plus new integration/security/route tests. Run link spider and classify 200/301/302/401/403/404 by actual permissions; no broken links, incorrect open redirects, or legacy lost-context routes.
- **Real phone:** iPhone Safari (keyboard up/down, back/forward, editing, draft restoration, viewport scrolling, modal close) and Android Chrome (IME resizing, keyboard, letter input, photos, preview, send, return, text selection). Also 320/375/390/430 widths and narrow tablet landscape.
- **Desktop:** Chrome, Safari where available, keyboard-only, focus-visible, large text/zoom, screen reader landmarks/headings, correct overlay stacking, no horizontal clipping or stranded actions.
- **Roles/states:** anonymous external web reader, newly invited, onboarded no letters, author, existing correspondent, sender waiting for reply, recipient, blocked or deactivated, restricted/moderated and admin/official author.
- **Full flow:** invite → onboarding → Room → browse six → Keep looking → read → Write to author → authenticated return (if necessary) → safety → draft persistence → first letter → delivery → recipient reply → established Letterbox → continued correspondence. Include cancel, error and refresh at *every* transition, and open-web opt-in/off and withdraw.
- **Regression:** old letters/questions intact; moments/photos and video removal state correct; postcards and Credits untouched; Guide and notifications still navigate correctly; profile and Discover People links work; public share tokens and search-indexable pages maintain their privacy bounds. All unrelated app surfaces and legal links pass route smoke tests.
- **Content:** genuine pilot letter authorship; varied styles/sizes; at least 20–30 real contributions before advertising; user sees variety rather than repeated three authors. Never manufacture fake international depth.
- **Release:** separate reviewable PRs, completed migrations with owner-run verifier, preview passed, explicit owner-authorized merge, production deploy READY, post-deploy smoke tests on real devices. No “DONE” status without link coverage, visual evidence and verified send/receive lifecycle.

## QA results log (must be filled with evidence, not assumptions)

| Gate | Current |
| --- | --- |
| Architecture/code and live SQL dependency audit | Completed read-only |
| Feature branch + pure selection/link contracts | In progress |
| SQL forward migration + rollback/compatibility verifier | Not started |
| Native public-letter first contact tested | Not started |
| Room browse/read/compose + old-link compatibility | Not started |
| Home, profile, onboarding and content-text audit | Not started |
| Legacy public URL / SEO / share regression | Not started |
| Mobile/desktop visual and input audit | Not started |
| Tests + production deployment + genuine pilot | Not started |

No part of this plan authorizes changing production data, activating payments, merging unrelated PRs or sending email to real members.
