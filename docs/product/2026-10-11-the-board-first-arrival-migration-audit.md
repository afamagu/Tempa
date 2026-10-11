# Tempa — The Board / First Arrival: migration audit
Date: 2026-10-11
Status: implementation contract, not a production release
Branch: feat/the-board-first-arrival-2026-10-11
Main remains unchanged.

## Final product architecture (owner instruction)
- **Home**: private, personal activity and relationship updates.
- **Letterbox**: only correspondence and replies; not a directory for finding strangers.
- **The Board**: the place where members pin and read **Open Letters**, discover **People**, and optionally leave a letter. **Open Letters** is selected by default, **People** is a distinct prominent top-level tab within The Board. Questions are archival/secondary, not the defining feature.
- **You**: identity, preferences, personalisation and re-playable guide.
- Product voice: warm, restrained, adult, precise, never salesy/cutesy. Orient members at each unfamiliar action. Not "pilot", "beta", "founding", or "invitation-only" in admitted members' experience. Until admission changes, accurately inform uninvited people that signup is restricted without showing false promises. No unsupported claims that an unsent letter is travelling or that a failed save is safe.
- Ad: the physical board of pinned letters is the centre of attention; the website's **The Board** must match it. A physical room in ad direction may still be called a room descriptively; do not change ordinary English uses indiscriminately.

## Live-code audit findings (main)
1. **Navigation and first arrival**
   - `app/app-shell.tsx`: sidebar and mobile label currently `Nav.room`; canonical old `/room`; legacy `board` active value maps to `room`.
   - `messages/en.json, fr.json, es.json, pt.json`: interface dictionaries contain Room and retired Board vocabulary plus prominent First Question and pilot signup copy. Translate coherently to "The Board" in each locale, not blindly string-replace.
   - `lib/onboarding.ts`, `lib/account-entry.ts`, `lib/account-entry-state.ts`, `app/profile/**`, `app/profile/question/**`, `app/profile/mark/**`, `app/profile/writing-style/**`, `app/home/introduction-reminder.tsx`: the old mandatory First Question, Mark, and Writing Style intercept new arrivals. Age, language, legal, invite permission must remain independently enforced.
   - First arrival must be a calm one-time welcome with a clear **Enter The Board** action, and small progressive tips on Board/Letterbox/Home only when needed. Returning member starts Home; newly admitted member starts Board. Re-play from You. Never re-show the full welcome after completion.
2. **Current Board vs Room URL collision — CRITICAL**
   - `app/board/page.tsx` exists and still supports the historical `/board?q=...` dispatch search while redirecting no-search visits to `/room`. `app/board/[dispatchId]/page.tsx` is still the real reader; `app/board/write/page.tsx` is the real composer.
   - `app/room/page.tsx` is the current open-letter reading surface. `app/room/letters/[id]/page.tsx` and `app/room/write/page.tsx` are wrappers of Board-era implementations. Rebrand requires **one canonical route** and compatibility; naive find/replace creates routing loops or loses legacy URLs.
   - Canonical planned `/board` (Open Letters), `/board/people`, `/board/letters/[id]`, `/board/letters/[id]/edit`, `/board/write`, `/board/people/[userId]`, and optionally `/board/questions` as a secondary archive. Preserve old bookmarked `/room`, `/room/letters/*`, `/room/write`, `/room/[userId]`, and existing `/board/[dispatchId]` and `/board?q=...` with bounded validated redirects/compatibility. Preserve query filters, reading-trail returnTo, and account access checks. Old `/board?q=` searches must remain functional or redirect to an equivalent search, never silently discarded.
   - `lib/room-paths.ts` is the current canonical URL generator. Replace consumer helpers through a deliberate compatibility layer rather than deleting imports or changing unsafe external/legacy parameters. `app/home/board-shelf-card.tsx`, `app/board/[dispatchId]/*`, `app/you/page.tsx`, and readers/links all depend on correct canonical URLs.
3. **Discover People**
   - `app/letters/discover/page.tsx` currently shows a `LettersTabs` header and `AppShell active="letters"`. `app/letters/letters-tabs.tsx` wrongly advertises Discover under Letterbox. `lib/directory-state.ts` hardcodes `/letters/discover`; `app/letters/discover/directory-browser.tsx` builds return links and profile targets from this.
   - Move the actual directory to **The Board → People**, not just a detached link. Preserve all filters, finite pagination, restore-on-return behaviour, contact capacity messaging, profile navigation and no popularity ranking. Retire Letterbox discovery tab and redirect `/letters/discover` to `/board/people`, maintaining search params; no second directory implementation.
4. **Open letters / writing / profiles**
   - `app/room/room-browser.tsx`, `app/room/room-letter-card.tsx`, `app/room/room-browse-actions.ts`, `lib/room-browse.ts`, `lib/room-letter-selection.ts`: finite six-at-a-time reading and preserved position, including the session key `tempa.room.browse:`; preserve selection and restoration while changing URL/visible ARIA copy.
   - `app/room/[userId]/page.tsx` wraps `app/minds/[userId]/page.tsx`; verify identity, author attribution, member-only visibility and return links before routing under `/board/people/[userId]`.
   - Preserve publication/moderation/withdrawal/restore, source Question provenance, first-letter source binding and existing private correspondence. The Board is public *within signed-in Tempa*, not open-web by default.
5. **Old Questions and content**
   - `app/room/questions/page.tsx`, `app/room/question-*`, `app/admin/content/questions/room-question-control.tsx` and `messages/*` still say Room Question. Questions stay accessible as historical/secondary content, never mandatory signup or main Board introduction. Rename the admin-facing surface to Questions or Questions archive rather than making a "Board Question" a core promise.
   - Existing Question answer records, citations, share tokens and archived correspondence are never silently renamed or deleted.
6. **Email, notices and guides**
   - `lib/email/room-invitation-worker.ts` contains "Answer in The Room" in text/HTML emails, but its database/email queue IDs are operational names. Update user-facing templates carefully; do not rename already-queued jobs, SQL functions, database tables or idempotency keys without migration.
   - `app/home/room-invitations.tsx`, `app/member-questions/room-question-credit.tsx`, `app/you/notifications/room-invitation-preference.tsx`, `app/you/guide/**`, `app/board/page.tsx`, and product user-facing pages contain stale copy. Existing Guide key `board` is historical; re-use/replace semantics carefully so a prior guide-completion record does not suppress new guidance.
7. **Admin + admission**
   - `app/admin/admin-nav.tsx` currently has eight mobile links in a single `grid-cols-8`, which can produce cramped/unreadable labels; propose mobile Home, People, Safety, Content, More; More exposes Commerce and System, with persistent active indicators on nested routes.
   - Pilot screens `app/admin/pilot/**` and `app/pilot-access/page.tsx` still use Founding Correspondents. Keep working invitation-control security and actual admission restriction until a deliberate public-opening decision; rename member-facing language and move admin tools under People → Invitations without losing operational records.
   - All admins should see a coherent nav, breadcrumbs/current section, 44px+ touch targets, clear empty state and visible selected filters.
8. **Technical naming / do-not-change**
   - `public.discover_room_writers`, `public.send_first_letter_from_room_letter`, `public.withdraw_my_room_letter`, `public.restore_my_room_letter`, `tempa_private` functions, `room_*` DB tables, type names, internal logs, historical migration filenames and auth/session claims can remain temporarily. Renaming without coordinated schema migrations is risky and buys no member-facing value.
   - Do not replace natural-language "room" in descriptive ad scripts or quoted user-authored letters. No edit to `main` before review/tests.

## Test + launch acceptance
- A fresh *invited* member and an account after eventual open admission receive exactly the same welcome, Board, guidance and features, after eligibility/terms; access-policy mode alone differs.
- Interrupted signup, email-magic-link and Google auth, locale changes, old stage `mark/question`, account bans/closures, and expired permissions never strand the member.
- Open Letters and People appear together at the top of The Board; mobile and desktop selected states are obvious; old URL redirects are stable and non-looping; "back" retains filters and reading position.
- Existing correspondence remains in Letterbox without Discover; first letter/reply, compose/drafts/mobile keyboard, source context, moderation and withdrawn restoration behave as before.
- Four locale dictionaries and emails, admin screens, onboarding, Home/You help text, errors, loading/empty states, ARIA labels and metadata are checked for former user-facing "The Room" references and wrong legacy "The Board" semantics.
- Existing Pilot data, invitations, Questions, published letters, and private correspondence are preserved; full tests and build pass with zero new regressions; handoff for iPhone and Android owner acceptance.
- No production merge until the full navigation and first-arrival release is coherent. 
