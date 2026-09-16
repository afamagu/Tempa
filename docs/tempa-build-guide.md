# TEMPA --- BUILD GUIDE

## Current System, Remaining Build, and Future Roadmap

**Rebuilt:** 2 September 2026\
**Updated:** 5 September 2026 — reconciled the live Mail Call rollout, viewer-scoped
correspondence state, public-profile/navigation changes, Letterbox consolidation,
System Voice, current visual target, conversation-territory direction, Open Letters,
future silent-video Moments and safety/admin planning. The unresolved personal-identity
choice between Mindforms and abstract Marks remains explicitly open — see §31.\
**Updated again same day:** Home consolidation checkpoint completed — see §7, §9, §15, §24, §25.\
**Working project:** `C:\Projects\Tempa`\
**Method:** one tested checkpoint at a time; real authenticated testing
outranks fixture confidence.

------------------------------------------------------------------------

# 1. THE PRODUCT NOW

Tempa is a slow-correspondence product built around one conviction:

> **People are more interesting than profiles.**

It is not chat, dating, a follower network, or a content feed. People
encounter one another through thought first, then write privately and
deliberately.

### Brand hierarchy

1.  **Product invitation:** *Find someone worth writing to.*
2.  **Brand thesis:** *People are more interesting than profiles.*
3.  **Acquisition line:** *Somewhere in the world, someone thinks the
    way you do. You just haven't met them yet.*
4.  Secondary: *Meet the mind before the person.*

### Current core loop

**Sign up → pseudonymous onboarding → discover a mind through writing/profile →
optional Question participation → first letter → accepted correspondence → Mail Call /
delayed ongoing letters → Moments → preservation.**

Questions remain central to discoverability, but they are no longer a navigation toll gate:
a member may browse, open profiles and initiate an otherwise-valid first contact without
being forced to answer first.

The original guide described an early prototype: authentication was only
just working, pseudonyms were unfinished, discovery was a fixed "twelve
answers" model, and the planned correspondence schema had states that no
longer match the live database. The current build is materially further
along.

------------------------------------------------------------------------

# 2. NON-NEGOTIABLE RULES

## Identity

-   Email/OAuth identity is private infrastructure, never public
    identity.
-   Members use unique pseudonyms.
-   3--24 characters; letters, numbers, spaces, hyphens.
-   Display formatting is preserved.
-   Canonical uniqueness: lowercase + trim + remove spaces/hyphens.
-   Google name/photo/email must never silently become public Tempa
    identity.
-   Public profiles expose only allowlisted fields.

## Product

-   No followers or public likes.
-   No swipe discovery.
-   No streaks.
-   No reels.
-   No voice notes/calls in the core product.
-   No read receipts.
-   No GPS precision.
-   No ads inside letters.
-   No popularity ranking.
-   No selling access to humans.
-   Human writing visually differs from system/context UI.

## System voice — working visual grammar

TEMPA must make it obvious when the platform itself is speaking. Current working hierarchy:

-   **Human writing:** primary serif/writing voice where established.
-   **Identity/headings:** stronger editorial/display hierarchy.
-   **Metadata:** smaller, quieter sans-serif.
-   **TEMPA/system notice:** restrained sans-serif, clearly separated from human writing.
-   **Safety/warning:** same system family with stronger prominence.
-   **Error/destructive:** strongest treatment, reserved for genuine failures/danger.

**Approved system-notice visual target:** muted terracotta/red icon + title, pale warm
terracotta/peach background, soft rounded container, smaller muted supporting copy.
`Mail on the way` is the canonical reference treatment. The current live `SystemMessage`
primitive establishes the semantic hierarchy (variants `quiet`/`notice`/`warning`, plus an
`action` slot added during the Home consolidation checkpoint for CTA+dismiss rows), but the
full app has **not yet** been visually brought up to the approved mockup standard — it still
renders in a restrained neutral-sans palette, not yet the terracotta/peach finish. Do the
terracotta visual pass during the dedicated visual-system pass (§34), not piecemeal.

## Engineering

-   Important rules belong in the database as well as the UI.
-   RLS for private data.
-   Server time controls delayed delivery.
-   Only public/publishable Supabase credentials in the client.
-   Mobile must not depend on hover.
-   Review SQL before running it.
-   Real authenticated testing is authoritative.
-   Never compensate for bad data by globally reversing UI labels.
-   A tutorial/optional feature may fail; it must never trap the member.

------------------------------------------------------------------------

# 3. STACK --- LIVE

-   Next.js + TypeScript
-   Tailwind CSS
-   Supabase: Auth, PostgreSQL, RLS, Storage
-   Vercel
-   Resend SMTP
-   Git/GitHub
-   Claude Code
-   Node.js v24.19.0
-   npm 11.17.0
-   Vitest regression tests

Authentication now includes email auth, Resend on `jointempa.com`,
Google OAuth, protected routes, auth callback, and onboarding
enforcement.

------------------------------------------------------------------------

# 4. ONBOARDING --- IMPLEMENTED

### Locked authentication screen copy

Header: **Welcome to Tempa** / *Find someone worth writing to.*
Primary actions: **Continue with Google** or **Continue with email** ---
never "Sign up," "Sign in," or "Send magic link" as primary action
wording. "Magic link" may stay as an internal/technical term only;
user-facing confirmation copy should read like **"Check your email. We
sent you a secure sign-in link."** Email stays a genuine alternative to
Google, never a hidden fallback. Google/email are authentication
mechanisms only --- they must never determine public Tempa identity
(already covered under Identity rules above). Sign in with Apple is
recorded as a future native-iOS consideration only.

### Choose your name

> **This is the name other minds will know you by.**

### Profile fields

-   Country: standardized searchable single-select.
-   Region: optional structured subdivision/fallback text; no GPS.
-   Age: 18--24, 25--34, 35--44, 45--54, 55--64, 65+.
-   Languages: searchable multi-select.
-   Gender: Woman, Man, Non-binary, Self-describe, Prefer not to say.
-   Intent: Meaningful friendship; Long-term correspondence; Thoughtful
    conversation; Cultural exchange; Sharing everyday life; Practising a
    language; Meeting people different from me; Meeting people who think
    like me; Writing and self-expression; A little serendipity;
    Something else.
-   Writing style: Self-written; AI review only; AI edit; AI drafting.
-   Receiving preference: Any writing style; Self-written or
    AI-reviewed; Self-written only.

Romance/dating preference is deliberately absent.

### Geography persistence — live correction

The standardized country selector now persists both the display country and its ISO alpha-2
`country_code` (for example South Africa → `ZA`, United States → `US`). Mail Call geography
must use the structured code, not inferred device location. Region remains optional and no GPS
is collected.

------------------------------------------------------------------------

# 5. QUESTIONS --- IMPLEMENTED CORE

Questions are Tempa's continuing discovery-publishing mechanism.

### Current families

-   `reflection`
-   `everyday`
-   `imagination`

Family labels are internal.

### Current live prompts

1.  What is something you understand differently now than you did five
    years ago?
2.  What is something ordinary that means more to you than most people
    would expect?
3.  If you could spend one completely ordinary day anywhere in the
    world, where would you spend it---and what would you do?

### Rules

-   Up to three eligible Questions at once.
-   Never offer a Question the member already answered.
-   Prefer one from each family.
-   Eventually maintain 20--30+ curated prompts.
-   Answer maximum: 2,000 characters.
-   No artificial minimum beyond non-whitespace.
-   Saving says **Saved**, not Published — implemented 2026-09-05: the button reads **Save answer**
    (never "Publish answer," "Send letter," "Send," or "Submit" — a Question answer is never a
    letter: no recipient, no correspondence, no Mail Call, no Letterbox activity). Confirmation copy
    is **"Saved. This answer is now featured in Minds."** the first time a save promotes it to the
    member's featured answer, or plain **"Answer saved."** for every ordinary save after that —
    `lib/questions.ts`'s `questionSaveConfirmationCopy`, driven by `publish_question_answer`'s own
    is_current transition, never a separate guess.
-   A member may retain many historical answers.
-   Exactly one answer represents them in Minds.
-   Actions: **Show in Minds** / **Shown in Minds** — this already IS the "choose which saved answer
    is featured" action a later checkpoint might otherwise have called "Feature in Minds"; kept as-is
    (2026-09-05 audit) rather than renamed, since it's already shipped, tested, and consistent.
-   Changing current answer does not delete history or algorithmically
    bump the member.

`set_current_answer(uuid)` is live.

### Participation is non-blocking — live

The former application-level participation gate was removed from profile viewing, Minds Explore
and first-contact writing. Unanswered Questions may produce a quiet incomplete-state reminder,
but a member can browse profiles, read published writing and write an otherwise-valid first
letter without being forced into the Question flow. Drafts remain restorable.

The same non-blocking reminder (`QuestionIncompleteNotice`, gated by `needsParticipationGate`
— true only when the member has zero completed canonical answers) is now also shown on Home as
of the Home consolidation checkpoint — see §15. It is the same component, reused rather than
duplicated, refactored to present through the shared `SystemMessage` primitive.

### Future Question-design objective

Some future prompts should naturally surface what a person values in friendship, companionship,
mentorship and mutual support, helping TEMPA normalize worthwhile non-romantic correspondence
without preaching or gendered pressure. Working prompt territory (not locked production copy):

> **What kind of person would you be glad to have in your corner — and what would you hope to bring to their life in return?**

Future library still targets 20–30+ curated prompts; research and curation come before adding
more live questions merely for quantity.

------------------------------------------------------------------------

# 6. MINDS --- IMPLEMENTED CORE

Primary navigation currently remains: Home - Letters - Minds - You. Naming is not locked;
`Tempers` was discussed and rejected as awkward for now. Do not rename the surface piecemeal.

Minds: Explore - My answers - Answer a Question.

### Explore

-   Six current answers per batch.
-   "Show me six more."
-   Viewer-specific deterministic sequence.
-   Filters: Country, Gender, Age range.
-   Active correspondence partners excluded where appropriate.
-   Exact answers already used for first contact excluded.
-   Closed correspondence does not permanently exclude the person.
-   Question participation no longer blocks Explore.

### Identity / profile routing — live

Recommended/discovery identity should open the canonical public profile at `/minds/[userId]`,
not unexpectedly launch the Question tutorial. Mindform/avatar + pseudonym should behave as one
coherent identity target where practical. Re-audited during the Home consolidation checkpoint
(`RecommendedMindCard`, `ArrivalSenderLink`) — already correct, no change needed; regression
tests confirm neither ever links to `/write/` or `?view=answer`.

### Public profile — partially confirmed in authenticated testing

Canonical public profile: `/minds/[userId]`. Existing allowlist includes pseudonym, broad location,
age band, languages, current approved profile fields, interests and Question writing. The Question
prompt is hidden by default behind a small info control; longer answer writing is previewed with
`Read more` / `Show less`. Self-view suppresses `Write to this mind`.

**Open live visual issue:** interests are intended to be compact / expandable, but the latest
authenticated profile check still showed the full visible interest set without the intended
collapse. Treat that as unresolved presentation work even if component tests say otherwise.

### Future interests: conversation territory

Do not freeze the current hobby-tag model. Interests should evolve toward **conversation territory**:
reasons people would genuinely enjoy writing one another — business/building, technology, careers,
family, friendship, discipline, faith, philosophy, craft, books, culture, life transitions and
other meaningful subjects. The aim is to make same-sex friendship, mentorship, intellectual
companionship and non-romantic correspondence feel naturally valuable. Final taxonomy requires
research; do not bulk-add categories yet.

### Tutorial

Global once-per-user Minds tutorial remains implemented. It must never trap a member; voluntary
Question/navigation escape is now the product rule.

------------------------------------------------------------------------

# 7. LETTERBOX AND CORRESPONDENCE — CONSOLIDATED CORE

Primary nav label: **Letters**  
Page heading: **Letterbox**

Letterbox is correspondence/person-oriented, not a flat pile of messages.

### Level 1 — live

-   Person/correspondent rows.
-   **All / New / Sent** filters.
-   `New` means delivered + unread incoming only; undelivered mail is never unread.
-   `Sent` means the viewer has sent at least one relevant visible letter to that person.
-   Latest visible body preview is **first paragraph, maximum two visual lines**.
-   Viewer-local date/time.
-   Distinct unread state and **Mail on the way** state.
-   `Waiting` and `Correspondences` are not user-facing Letterbox filters.

A letter card is a doorway into writing, never a miniature reader. The full body belongs only on
the individual reader surface.

### Mail on the way — live mechanics, visual refinement still pending

Recipient may know that incoming mail exists while it travels, but not its hidden content.
`incoming_mail_in_transit()` exposes only the minimum correspondence/person identity needed for the
indicator. No body, letter id, exact `deliver_at`, countdown or Moment information is exposed.

The live UI now uses the shared `SystemMessage` grammar and visible **Mail on the way** text.
However, the approved final treatment is the richer terracotta/peach postal notice shown in the
approved Letterbox visual reference; that exact finish remains for the visual-system pass.

### Level 2 archive — live

-   Compact `‹ Letterbox` back navigation (chevron icon + short text, `aria-label="Back to Letterbox"` — revised 2026-09-05 from a plain `← Letterbox` text link for a lighter mobile header).
-   Identity header.
-   Direction derived at letter level.
-   Viewer-local dates.
-   Each letter preview uses first paragraph + two-line clamp.
-   Full writing opens in the reader.
-   Closed episodes remain preserved and later re-contact may create a new episode.
-   **Mail on the way, scoped to this correspondent (implemented 2026-09-05).** When the viewer has
    incoming undelivered mail specifically from the person whose archive is open, a `SystemMessage`
    `quiet`-variant line ("Mail on the way" / "A letter is travelling to you.") appears near the
    header, before the letter history. Reuses the exact same existence-only signal Letterbox Level 1
    already shows (`incomingMailInTransitPersonIds`, `lib/letters.ts`) — no new query shape, no
    inspection of the hidden letter, no count/exact `deliver_at`/countdown. Absent entirely when this
    specific person has no mail in transit toward the viewer.

### Remove from my Letterbox — UI live, authenticated retest still recommended

Viewer-local hiding is wired to `correspondence_hidden_for_user`. Copy: **Remove from my Letterbox**.
The confirmation explains that it removes the correspondence only for the current viewer; nothing
is deleted for the other participant and shared/safety records remain. Search already excludes
hidden correspondence.

**Compact icon control in the archive header (revised 2026-09-05).** The archive header's trigger was
a permanent visible text phrase, found too visually heavy during authenticated testing. Replaced with
a restrained icon-only button (`RemoveFromLetterboxIcon` — an open tray/slot with an outward arrow,
deliberately not a trash-can silhouette, so it never reads as destructive deletion). `RemoveFromLetterbox`
(`app/letters/remove-from-letterbox.tsx`) gained an optional `triggerIcon` prop for this — the accessible
name (`aria-label="Remove from my Letterbox"`) and a hover/focus `Tooltip` are preserved regardless, and
the existing confirmation flow/copy is completely unchanged. The per-letter menu item (`LetterActionMenu`)
still uses the plain-text trigger; only the archive header changed.

**Home hidden-correspondence gap — fixed (Home consolidation checkpoint, 2026-09-05).** Home
Arrivals and Home's Mail-on-the-way indicator both now exclude any correspondence the viewer has
hidden, via the exact same batched query Letterbox already ran (`getHiddenCorrespondenceIds`) plus
two new pure filters — `excludeHiddenLetters` and `excludeHiddenMailInTransit` (`lib/letters.ts`).
No SQL/RPC/RLS change was needed or made — `correspondence_hidden_for_user` already carried
everything required; only Home's own data composition needed to consult it. See §15. Live
authenticated retest still recommended before treating this as fully confirmed.

### First contact / ongoing correspondence

-   Letter 1: immediate, text-only.
-   Letter 2: delayed, text-only.
-   Letter 3 onward: Moments allowed only once the establishing Letter 2 has actually delivered.
-   Initiator cannot repeatedly send before acceptance.
-   The accepting Letter-2 sender may continue sending plain-text letters while Letter 2 travels.
-   User-facing decline wording: **Pass on this letter**.

No read receipts.

------------------------------------------------------------------------

# 8. ACTIVE RELEASE-BLOCKING INVESTIGATION --- LETTER DIRECTION

This issue is **not closed**.

Authenticated live data proved at least one correspondence has stored
`sender_id` / `recipient_id` values inconsistent with the actual
authorship represented by the letter content. Other correspondences
appear correct.

Therefore: - do not globally swap sender/recipient; - do not
special-case test users; - do not assume current migration files equal
live deployed RPCs; - inspect live `send_first_letter` and
`reply_to_letter` definitions; - establish the systemic cause before
repairing historical test data.

Universal invariant:

> For every letter, `sender_id` is the authenticated member who
> submitted that specific letter and `recipient_id` is the other
> participant.

The renderer should display that letter-level fact.

------------------------------------------------------------------------

# 9. REMOVE FROM MY LETTERBOX — BACKEND + UI LIVE

`correspondence_hidden_for_user` remains the viewer-local hide mechanism.

Meaning:
-   hide only from that member's Letterbox;
-   other participant unaffected;
-   shared correspondence and safety records preserved;
-   this is not Block and not shared deletion.

The UI now uses **Remove from my Letterbox** with an explicit confirmation. Search respects hidden
correspondences. Home now applies the same semantics as of the Home consolidation checkpoint
(2026-09-05) — see §7 and §15 for the exact fix (pure TypeScript filters over the existing hidden-ids
query; no SQL/schema change).

------------------------------------------------------------------------

# 10. MOMENTS

> **Media belongs inside the story, not attached to it.**

Moments sit between paragraphs rather than in an attachment gallery.

Current `⊕` surface: Photo / Choose from library / Take a photo / Postcard. Postcards come from
TEMPA's catalog, not device uploads.

### Qualification rule — live

-   Letter 1: text-only.
-   Letter 2: text-only.
-   Moments unlock only after the reply that first established the correspondence has delivered.
-   Therefore Letter 3 onward may carry Moments once that delivery boundary has passed.
-   This is server-enforced via `moments_qualified_for_viewer`; it is distinct from Write Anytime.

### Built / partially built

-   dedicated reply composer;
-   paragraph-gap insertion;
-   private photo storage;
-   signed URL architecture;
-   client re-encoding/EXIF stripping;
-   resize/compression;
-   Postcard picker;
-   eligibility gates;
-   first-photo consent;
-   tutorial;
-   autosaved text draft;
-   viewer-local dates.

Real-device end-to-end testing remains important.

### End-to-end completion audit (2026-09-05)

Traced the complete path — qualification → paragraph attachment → consent → composition → storage →
send/Mail Call → recipient rendering → Letterbox/Home preview surfaces — before changing anything, per
this checkpoint's own instruction not to assume the guide already matched the code.

**Confirmed already correct, code-level (re-verified this pass, not newly built):**
-   paragraph attachment is a real ProseMirror child node (`photoMoment`), never a tracked index —
    `docToMomentDrafts` walks the FINAL document fresh every time, so insert/delete/merge around it can
    never drift its reported `position` (already tested, `lib/letter-editor-doc.test.ts`);
-   the ⊕ affordance never offers a SECOND photo on a paragraph that already has one — the only way to
    change an attached photo is remove-then-reattach, which correctly works (removing recomputes the
    ProseMirror doc, which correctly re-shows ⊕ for that now-empty paragraph);
-   `MomentAffordance.configure({ enabled: momentsQualified && canSendPhoto, ... })` correctly
    reconfigures the LIVE editor instance when those server-derived props change across a re-render
    (e.g. after `router.refresh()` once photo consent is granted) — confirmed by reading
    `@tiptap/react`'s own `useEditor` source: it re-diffs and calls `editor.setOptions(...)` on every
    render when `deps` is empty, not only once at mount. Not a bug; no fix needed.
-   `letterDocHasContent`/`canSendLetter` (writing-essentials checkpoint) already explicitly and
    correctly treat a photo-only paragraph as real content — a stated, tested product rule, not an
    accident of the Tiptap reactivity fix;
-   EXIF/location stripping is genuinely connected: `processImageForUpload` (moments-composer.tsx)
    always re-encodes through an HTML canvas before upload — canvas pixel data carries no EXIF, so this
    is a real strip, not a claimed one. No OCR, no moderation, no face detection exists anywhere in this
    path — not claimed as implemented;
-   consent enforcement is a genuine SERVER boundary, not a client-side gate: the `letter_photos_select`
    storage RLS policy (`can_view_letter_photo`, docs/sql/2026-08-31-first-photo-consent.sql) requires
    `sender_id = auth.uid() OR photo_consent_status = 'enabled'` — `createSignedUrls` itself fails for an
    unauthorized path, which is what `getMomentsForLetters` correctly reads as "locked" (`imageUrl:
    null`), never a client-side decision;
-   Letterbox/Home preview surfaces (`letterPreviewText`, `people-grid.tsx`, `archive-list.tsx`,
    `home/page.tsx`) never fetch or reference `moments`/`image_path` at all — confirmed by inspection,
    not merely by not rendering it; Mail-on-the-way (`incoming_mail_in_transit`) and search
    (`search_letterbox`) likewise carry no Moments/image reference. A Moment cannot leak through any of
    these because none of them ever have the data to leak.
-   a historical/no-Moments letter renders through the exact same `LetterBody` path with an empty
    `moments` array — no special-casing, no different code path, confirmed via new tests.

**Fixed this pass:**
-   mobile tap target — the inline photo token's "Remove this photo" button was a 16px hit area (too
    small for a reliable touch tap on a destructive action); enlarged to 24px
    (`app/letters/[letterId]/photo-moment-node.tsx`). No other composer/reader control failed the
    no-hover-dependency or viewport-escape checks — the ⊕ affordance, the photo-source bottom sheet, the
    full-screen viewer's close button, and the locked-photo affordance were all already tap-only and
    reasonably sized.

**Known, accepted, low-severity gap (not fixed — cause is uncertain without live testing):** if a
`moments.image_path` row's underlying storage object is genuinely missing (never expected in normal
operation, but not impossible — e.g. manual deletion), `createSignedUrls` fails for that path for the
same reason an unconsented photo does, and the reader currently shows the SAME "Photo waiting" consent
affordance for both cases — technically misleading in the missing-object case, but distinguishing them
reliably would require inspecting Supabase Storage's actual per-path error shape under a live failure,
which cannot be done from static code reading. Documented here rather than guessed at.

**CRITICAL — verify before any live two-account testing.** Several SQL migrations this checkpoint
traced are files the CURRENT application code already assumes are live (it calls the RPCs / relies on
the policies they define), but each file's own header still literally reads "PREPARED ... NOT
EXECUTED" as of this audit:
-   `docs/sql/2026-09-01-letter2-moments-gate-fix.sql` — fixes `reply_to_letter`'s broken Moments gate
    (its own header says NOT EXECUTED, but a LATER file, 2026-09-02-reply-to-letter-moments-alias-
    fix.sql, refers to it as "the already-applied 2026-09-01 fix" — the two files disagree with each
    other);
-   `docs/sql/2026-09-02-moments-select-policy-fix.sql` — fixes `moments_select_participant`, which as
    originally written queries `public.letters` directly and fails with "permission denied for table
    letters" for EVERY read of `public.moments`, for every user, sender included, if not applied;
-   `docs/sql/2026-09-02-reply-to-letter-moments-alias-fix.sql` — fixes a live "column reference "m" is
    ambiguous" error in `reply_to_letter`'s Moments insert;
-   `docs/sql/2026-09-04-mail-call-moments-qualified.sql` — defines `moments_qualified_for_viewer`
    itself (which `isMomentsQualifiedForViewer`, lib/letters.ts, already calls) and the `write_letter`
    body that enforces the Letter-2-delivery gate for Moments.

This build guide's own file-header convention ("PREPARED ... APPLIED" vs "PREPARED ... NOT EXECUTED")
has NOT been reliably kept up to date across every file in this directory — at least one file's header
is directly contradicted by a later file's own cross-reference. I cannot query the live database from
here to check actual current function/policy definitions. **Before authenticated two-account Moments
testing, confirm directly against the live database** (the affected files' own "VERIFY" sections
already contain safe, read-only checks for this, e.g. `select pg_get_functiondef('public.
moments_qualified_for_viewer'::regproc);` and inspecting `pg_policy` for `moments_select_participant`).
If any of the four are genuinely not yet applied, they need to be run in this exact order (each depends
on the previous being live) before Moments can function at all — this is not new SQL authored by this
checkpoint, only unresolved status on SQL already written and previously presented for approval.

### Future decided direction — very short silent video

Short video is no longer merely an unspecified deferred idea. Future Video Moments may be added
under strict constraints: **maximum 5 seconds, no audio, no autoplay in letters, tap to expand/play,
same paragraph-linked grammar, same progressive personal-media consent as photos**. Video must not
become a feed or attachment gallery. Future work must solve metadata/privacy, compression/transcoding,
storage, moderation, file-size and mobile/browser compatibility. Not implemented now.

------------------------------------------------------------------------

# 11. FIRST-PHOTO CONSENT --- LIVE ARCHITECTURE

The first Photo attempt becomes the request.

Recipient sees a sealed position:

### A photo is waiting

> \[Sender\] included a photo in this letter. Photos become visible only
> when both people are comfortable exchanging them.

Choices: 1. View this photo and allow photo sharing 2. Maybe later 3.
Keep this correspondence photo-free

States: - enabled; - deferred; - photo-free.

No approve/reject language. Do not blur/leak the real image before
consent. Deferred/photo-free must not create repeated pressure.
Postcards remain available.

------------------------------------------------------------------------

# 12. TUTORIAL SYSTEM --- FIXED

Minds and Moments tutorials follow one global rule:

> Automatic tutorial occurs once per user after successful completion.

Completion uses insert-once semantics: - plain INSERT; - PostgreSQL
`23505` duplicate = already completed = success.

The former Moments trap at `Continue writing` is fixed and confirmed in
authenticated testing. A non-critical acknowledgement failure cannot
imprison the member. Genuine final navigation failure gets a restrained
**Return to Letters** escape.

Manual replay remains separate.

------------------------------------------------------------------------

# 13. MOMENTS TUTORIAL VISUALS --- PLANNED

Five personal-photo-style 9:16 subjects: 1. Morning coffee 2. Walk by
the sea 3. Little companions --- cat and puppy 4. Night city after rain
5. Market day

Carousel: - horizontal swipe/drag; - clean snap; - no visible
scrollbar; - no dots; - no slider track; - no permanent arrows
underneath; - desktop edge arrows only if needed.

Tutorial should also show the real inline grammar: **paragraph → Moment
→ paragraph**.

------------------------------------------------------------------------

# 14. TEMPA AND MINDFORMS

## Tempa --- approved direction

Tempa is the platform guide: the Mind that links minds.

Approved anatomy: - mint/moss green; - premium tactile soft-clay/rubber
3D feel; - oversized rounded head; - large expressive glossy eyes; -
small gentle mouth; - narrow body; - short flexible arm/tentacle
limbs; - gathered/fused rounded octopus-lobe base; - sex-neutral; -
recognizable silhouette.

The current crude circle/octopus placeholder is **not** final brand art.

Canonical poses: - Neutral - Thinking - Welcome - One moment -
Presenting - You're ready

Production assets need transparent backgrounds.

## Mindforms --- future

A Mindform is a member's customizable character from Tempa's
species/world.

Do **not** runtime-generate an AI portrait per member.

Use composable assets: - base; - hair/headwear; - glasses; - clothing; -
accessories; - restrained surface variations.

Store configuration, not a generated portrait. Protect the species
silhouette.

------------------------------------------------------------------------

# 15. HOME AND PUBLIC PROFILE

Home is not the Question page and must not become a conventional social feed.

### Home — consolidated (implemented, 2026-09-05; live-test still pending)

Home now has a deliberate hierarchy, in priority order, and is deliberately NOT a feed, dashboard,
notification centre, or duplicate Letterbox:

1.  **Arrivals** — delivered, viewer-visible correspondence activity only. `deriveArrivals`
    (`lib/letters.ts`) is the same recipient/status/expiry filter Home always used, extracted this
    pass into a pure, independently-tested function rather than rewritten — no behavior change. A
    single-sender arrival now also shows a restrained first-paragraph preview (`letterPreviewText`,
    the same helper and line-clamp convention Letterbox already uses) — never the full body, and
    never for the multi-sender case (no single identity to attach it to).
2.  **Mail on the way** — unchanged transit RPC/logic (`incoming_mail_in_transit`,
    `getIncomingMailInTransit`), presented through the shared `SystemMessage` primitive (`quiet`
    variant: icon + title + optional supporting text, single inline line, no border/background).
    Visually this is still the restrained neutral-sans treatment recorded in §2's system-notice
    grammar — **not yet** the terracotta/peach treatment shown in the approved Letterbox mockup;
    that remains explicitly future work for the visual-system pass (§34), not attempted here.
3.  **Discovery preview ("Recommended minds")** — audited, unchanged: a small, capped taste of Minds
    (max 6), same eligibility rule as Explore (current answer, not self, not contacted, not an
    existing correspondence partner). Identity already routes to the public profile
    (`/minds/[userId]`) via `RecommendedMindCard`/`ArrivalSenderLink`, never the Questions tutorial
    or a composer — confirmed correct by inspection and by existing regression tests, no change
    needed.
4.  **Question reminder** — non-blocking. `QuestionIncompleteNotice` (built for Minds, §5) is now
    reused as-is on Home, gated by the existing `needsParticipationGate` (true only when the member
    has zero completed canonical answers). Refactored this pass to present through `SystemMessage`'s
    `notice` variant, which gained a new optional `action` slot (a CTA + "Not now" dismiss row) to
    support it. No modal, no enforcement; ignorable; ceases appearing on its own once any canonical
    Question is answered.

**Hidden-correspondence gap — fixed, no SQL.** See §7/§9 for the exact mechanism
(`excludeHiddenLetters`, `excludeHiddenMailInTransit`, both reusing the existing
`getHiddenCorrespondenceIds` batched query). "Remove from my Letterbox" now means a correspondence
stops surfacing in Home as well as Letterbox, while remaining intact, undeleted, and fully visible to
the other participant.

**Editorial hierarchy, not a card farm.** Arrivals keeps the strongest visual weight (bordered card);
Mail on the way is a quiet inline system line beneath it, never its own equally-weighted box;
Discovery preview stays a small horizontal row under a light section label; the Question reminder
sits last and lightest. No dashboard grid, no equally-weighted boxes — order and typography carry the
hierarchy. Same narrow centered column on mobile and desktop (no stretched-mobile-column redesign this
pass, no fixed-pixel widths found in an audit of every touched file).

**Prepared for, but does not implement, Dispatches/The Board.** No placeholder section, no fake data,
no engagement metrics were added at the time. The Board's first vertical slice was later built as its
own checkpoint (§20.A) as a fifth primary-navigation destination, not a Minds sub-view as originally
sketched here — Home itself gained only a small, non-carousel Board shelf near its upper section from
that later work (§20.A), nothing else about this section's own hierarchy changed.

**Not yet done — explicitly deferred to the visual-system pass (§34):** the terracotta/peach
system-notice treatment. Home's `SystemMessage` instances are structurally ready to receive it
(variant-driven styling, no inline one-off styles to unwind first) but still render in the interim
restrained neutral palette. Do not treat the current Home as visually matching the approved mockup —
it does not yet, and that is a known, intentional scope boundary at this stage, not an oversight.

**Authenticated-testing status: not yet.** This pass's test coverage is pure-function
(`deriveArrivals`, `excludeHiddenLetters`, `excludeHiddenMailInTransit`) and static-render
(`SystemMessage`, `QuestionIncompleteNotice`, `RecommendedMindCard`, `ArrivalSenderLink`) only. Home's
own server-component page has no direct test — it requires a live Supabase session, the same
limitation already recorded for other checkpoints. Live-test Home with a real authenticated account
before authorizing the next checkpoint (§24-B).

### Public profile

Public profiles are allowlisted and writing-first. Clicking a member identity opens `/minds/[userId]`
where appropriate. Long Question writing is previewed/collapsible; Question prompt is hidden behind
a small info control. Exact auth/provider identity is never public. Interest presentation still needs
live reconciliation with the intended compact/expandable behavior.

Future profile space may include richer Dispatch presentation (beyond §20.A's already-implemented
restrained list), answer history, Postcard/preservation artifacts and richer conversation territory,
but do not build those merely to make the page busier.

------------------------------------------------------------------------

# 16. WRITING EXPERIENCE — IMPLEMENTED, LIVE-TEST PENDING (2026-09-05)

Bold, Italic, and a restrained Unicode emoji picker are now live in every letter composer, plus emoji
in the Question editor. This is TEMPA's one deliberately small writing toolbar — Bold, Italic, Emoji,
nothing else. No underline, headings, fonts, colors, links, lists, Markdown mode, or rich social-post
formatting.

### Editor architecture — unified onto one shared schema

Before this checkpoint, three writing surfaces existed on TWO different technologies: the ongoing
Write Anytime composer (`moments-composer.tsx`) already used Tiptap/ProseMirror (for the paragraph-
linked Moments grammar); the first-contact composer and the first-contact reply were both plain
`<textarea>` elements. All three now share one base Tiptap schema
(`app/letters/writing-extensions.ts`: Document, Paragraph, Text, HardBreak, History, Bold, Italic —
no heading/list/link/color/font mark or node exists, so nothing beyond bold/italic text and paragraphs
can ever enter a letter, regardless of what a member pastes). Only the Write Anytime composer adds
Moments extensions (PhotoMoment, MomentAffordance) on top — Letter 1 and Letter 2 stay text-only by
product rule (§10, §21), which is about Moments/photo eligibility, not editor technology, so unifying
the editor technology does not touch that rule. A shared `WritingToolbar`
(`app/letters/writing-toolbar.tsx`) and `EmojiPicker` (`app/letters/emoji-picker.tsx`) give every
composer identical Bold/Italic/Emoji behavior rather than three separate implementations.

The Question editor (`app/question/question-answer.tsx`) deliberately stays a plain `<textarea>` —
Questions have no Moments/paragraph-position concept to justify a heavier editor, and forcing rich
text there would add complexity disproportionate to a discovery/publishing surface that was never
part of this checkpoint's "letters" focus. It gained the same `EmojiPicker` component, wired to a
plain textarea-cursor insertion helper (`lib/textarea-insert.ts`) instead of a Tiptap command — no
Bold/Italic there, by deliberate choice, not oversight.

### Storage — no schema change

`letters.body` (and `question_answers.body`) remain plain `text` columns. Bold/italic marks are
encoded directly inside that same plain string as a small, unambiguous, non-HTML markup subset —
`**bold**` and `_italic_` (lib/letter-editor-doc.ts's `docToPlainBody`/`parseFormattedText`) — chosen
because those two delimiter shapes essentially never occur in ordinary correspondence prose and share
no characters with each other. A literal asterisk/underscore/backslash a member actually types is
escaped so it can never be mistaken for a delimiter. This is a plain string transformation, never HTML
generation — there is no injection surface, and Moments' paragraph-position logic
(`docToMomentDrafts`) is completely unaffected, since only inline text-node content changed, not
paragraph/hard-break structure. Rendering happens through `FormattedText`
(`app/letters/formatted-text.tsx`), which builds real `<strong>`/`<em>` React elements from a plain
tokenizer — never `dangerouslySetInnerHTML` — used by the reader (`letter-body.tsx`) and every
existing Letterbox/Home preview surface that shows a letter excerpt, so none of them regress into
showing raw `**`/`_` markers literally.

**Known, accepted limitation:** a letter body saved before this feature existed that happens to
already contain an unescaped `**` or `_` pair (rare in ordinary prose) will be misread as formatting
the first time it's displayed under the new parser — the words themselves are never lost, only
possibly mis-styled once.

### Double-click/selection fix

The paragraph-gap Moment affordance (`⊕`, `moment-affordance-extension.ts`) previously cached its
widget DOM elements in a WeakMap but still rebuilt an entirely new ProseMirror `DecorationSet` on
every transaction, including pure selection-only ones (moving the caret, the two clicks of a
double-click) — handing the editor view a fresh object graph to diff on every click, not only every
keystroke. Fixed by additionally caching the computed `DecorationSet` itself, keyed on
`(doc, activeIndex)` — a ProseMirror `doc` is a persistent/immutable structure, so reference-equal
`doc` plus an unchanged "which paragraph is active" index means the decorations are PROVABLY
identical, and the literal same `DecorationSet` object is returned rather than rebuilt. This is the
textbook fix for this exact class of bug: returning the same reference lets the view skip decoration
diffing (and therefore any DOM touching) entirely for a selection-only transaction. The decision logic
itself (`canReuseMomentDecorations`) is unit-tested directly; full confirmation that a double-click now
selects the clicked word needs a live browser session (this project's Vitest environment is `node`,
not `jsdom` — see vitest.config.mts — matching its established renderToStaticMarkup-only convention,
so no real ProseMirror EditorView can be mounted in a test).

### Paste behavior — schema-constrained by construction, not a custom filter

No custom paste-sanitization code was written. ProseMirror's DOM parser can only ever produce nodes/
marks that exist in the schema above — confirmed by reading the installed `@tiptap/extension-bold`/
`@tiptap/extension-italic` packages' own `parseHTML` rules directly: they recognize `<strong>`/`<b>`/
`font-weight` and `<em>`/`<i>`/`font-style` respectively, and nothing else. A heading, link, table,
color, or font pasted from Word/Google Docs/a website has no corresponding schema node/mark to become,
so it degrades to plain paragraph text (or is dropped) automatically — this is a structural property
of a minimal schema, not a filter that can be bypassed. Genuine paste-from-real-application testing
still needs a live authenticated browser session.

------------------------------------------------------------------------

# 17. SAFETY BEFORE STRANGER SCALE

Required before broad stranger rollout: - Block - Report + admin
review - Rate limits - Scam/off-platform-money warnings - Account
deletion semantics - Export - Image moderation - Abuse controls - 18+
initial positioning

Hiding a correspondence must not destroy safety records.

### Future network-location mismatch caution

TEMPA may later compare a member's declared profile country with approximate **network/IP country**
at letter submission. A mismatch is a caution signal, never proof of fraud: travel, VPNs and mobile
networks can explain it. Recipient-facing language should say the letter *appears* to have been sent
from a network in another country; never claim precise device location, never expose IP/GPS, and never
block delivery solely for mismatch. Build this with scam warnings, Block/Report and admin safety later.

------------------------------------------------------------------------

# 18. FACE-PHOTO TRUST WARNING --- FUTURE

Before sending an image, Tempa may eventually detect whether it appears
to contain a human face.

This is **not identity recognition** and should not claim "selfie
detected."

Suggested warning: \> **This photo appears to contain a face.**\
\> Photos that reveal your identity can change the nature of a
correspondence. Make sure you trust this person before sharing one.

Actions: - Send anyway - Choose another photo

Possible correspondence-specific option: - Don't remind me about face
photos in this correspondence.

Prefer on-device detection where practical.

------------------------------------------------------------------------

# 19. INTERNATIONAL TEMPA --- FUTURE TRANSLATION

Separate:

### Interface localization

Menus, onboarding, Questions, safety copy, tutorials and system messages
appear in the member's chosen interface language. Static copy uses
localization resources.

### Human-writing translation

The original letter/answer remains canonical and unchanged.

When languages differ: - detect source language; - render translation
according to eventual product settings; - preserve easy access to
original; - cache translations to avoid repeated cost.

Translation must never overwrite original writing.

Provider choice is deferred until implementation.

------------------------------------------------------------------------

# 20. DISPATCHES AND THE BOARD

"TEMPA — DISPATCHES AND THE BOARD" (2026-09-07) is the canonical specification for Tempa's
public-writing surface. It supersedes the earlier "Open Letters" product-direction notes previously
recorded in this section — Open Letters terminology, swipe-based public-writing navigation,
title-less public writing, and video Moments in public writing are all superseded and must never
appear as product-facing language or behavior again (see §20.C's explicit rejected-directions list).

## 20.A — CANONICAL MODEL AND FIRST IMPLEMENTATION — 2026-09-07, SQL NOT YET APPLIED

### Locked terminology

A public piece of writing: **Dispatch**. The public reading/discovery destination: **The Board**.
"Open Letters" must never be used as product-facing terminology after this checkpoint — internal
filenames/routes were migrated to `board`/`dispatch*` naming (with temporary redirects preserved from
the old `/minds/open-letters*` paths so no stale link simply 404s), and the underlying `open_letters`
table was renamed in place to `dispatches` (an ALTER, not a drop/recreate — it was already live and
may hold real rows; see the migration's own doc comment,
docs/sql/2026-09-07-dispatches-and-board.sql).

### Product philosophy (unchanged from Open Letters' original framing)

One member's writing, deliberately offered to the wider authenticated Tempa community — never a
status update, feed-for-engagement, or popularity contest. Ordinary members are the writers; no
professional-editor/writer caste. Minds remains deliberate discovery through Question writing; The
Board is ambient/unprompted public writing — a distinct, sibling activity, not a sub-view of Minds.

### Primary navigation

The Board is Tempa's fifth primary navigation destination: **Home, Letters, Minds, Board, You** (see
`app/app-shell.tsx`). The former Minds-hosted entry point (`app/minds/open-letters-link.tsx`) was
removed — Minds and The Board are distinct first-class activities, never one nested inside the other.
Icon: a restrained notice-board glyph (a frame with a couple of posted-note lines), distinct from
Minds' magnifying glass and Letters' envelope.

### Routes

- `/board` — browse/discovery, with search near the top (title + topics + body).
- `/board/write` — the composer.
- `/board/[dispatchId]` — the reader.
- `/minds/open-letters`, `/minds/open-letters/write`, `/minds/open-letters/[id]` — temporary redirect
  stubs to the routes above, carrying no UI of their own, kept only so a stale development link never
  404s. Safe to remove once nothing in active use still points at them.

### Data model

`public.dispatches` (renamed from `open_letters`): `id`, `author_id` (references `auth.users`, same
convention as `letters.sender_id`), `title`, `body`, `status` (`'published'` | `'unpublished'` —
every row this app version creates is `'published'` at insert time; `'unpublished'` is reserved for a
future unpublish feature, nothing writes it yet), `created_at`, `published_at`. No update/delete
policy exists at all — a published Dispatch is immutable and undeletable at the database level in
this version (see "Deliberately deferred" below).

**Title — required, one line, ≤ 70 characters.** Composer placeholder is the exact locked copy: "What
is this about, in one line?" Never marketed as a headline; no headline/clickbait coaching exists
anywhere in the composer. Enforced client-side (immediate `maxLength` + `dispatchTitleError`,
lib/dispatches.ts) and authoritatively server-side inside `publish_dispatch`.

**Body — no visible counter, no visible maximum-length messaging, no "getting long" warning
anywhere.** Server/database hard maximum: 10,000 **member-visible** characters, not encoded storage.
Rich-body encoding (the same Bold/Italic marker/delimiter system every letter and Question answer
already uses — see §16) can make the stored string longer than what a member actually typed; a naive
`char_length(body)` check would therefore falsely reject legitimate long-form writing the moment it
used any formatting. `public.dispatch_visible_length()` strips the invisible rich-body marker and the
`**`/`_` delimiters before counting, so the 10,000 ceiling is measured against what the member sees,
not what's stored. This function's own doc comment records one deliberate, known approximation (an
escaped literal `\*\*`/`\_` is slightly undercounted) — which can only ever make the check MORE
permissive, never less, so it can never cause a legitimate submission to be falsely rejected, the
actual requirement.

**Topics — 0 to 3 plain tags per Dispatch**, stored in a normalized child table
(`public.dispatch_topics`) rather than an array column, so case-insensitive dedup and search-by-topic
are both plain SQL rather than array gymnastics. `normalizeTopics` (lib/dispatches.ts) trims,
drops blanks, dedupes case-insensitively (keeping the first casing seen), clips an abusively long tag,
and caps at 3 — mirrored authoritatively inside `publish_dispatch`, never trusted from the client
alone. No hashtags in the UI, no tag counts, no tag pages, no tag following, no trending topics — a
topic is metadata belonging to one Dispatch, nothing more.

**Search** covers title + topics + body via `search_dispatches` (plain `ILIKE`, no ranking/scoring),
security-invoker so RLS still hides anything unpublished from a search that isn't the author's own.

### Composer

`app/board/dispatch-composer.tsx` — the same shared Tiptap schema/toolbar every letter composer uses
(Bold/Italic/Emoji), a plain title input, a topic-chip input (max 3), and an optional still-image
Moment affordance (see below). Button reads exactly **"Publish Dispatch"** — never "Send letter",
"Save answer", "Post", or "Submit". No length UI of any kind for the body (see above); `canSendLetter`
is always called with `aboveMax: false`, the same principle already established for an ongoing
correspondence (§16) — mature long-form writing is never artificially capped by the introductory-
answer limit.

**Drafts.** No server-side draft row exists for a Dispatch at all — drafting is entirely the existing
localStorage architecture (`lib/letter-editor-draft.ts`), extended with a Dispatch-scoped variant
(`readDispatchDraft`/`writeDispatchDraft`/`clearDispatchDraft`) carrying title + document + topics
together, keyed by author id. Publish clears the draft only on success; a failed attempt (RPC error or
thrown exception) leaves it untouched, matching every other composer's established try/finally
robustness convention.

### The Board (browse) page

`app/board/page.tsx` — a normal vertically scrolling discovery/list page, explicitly NOT Reels,
Stories, an animated feed, or a swipe feed. Each preview (`app/board/dispatch-card.tsx`) prioritizes
title, excerpt, writer identity, date, and up to 3 restrained topic chips — no engagement chrome of
any kind. A Keep action renders per-row (never on a viewer's own Dispatch).

**Board ordering** (`sortBoardDispatches`, lib/dispatches.ts) is a pure, fully unit-tested three-tier
sort:
1. unseen Dispatches from minds the viewer Keeps;
2. unseen Dispatches from other writers;
3. previously seen Dispatches;

newest-first within each tier, never a popularity signal — none of likes/views/followers exist
anywhere in this schema to rank by. Tier 1 is passed through `interleaveByAuthor` first, a round-robin
reorder that keeps one prolific kept writer from occupying the entire first screen, without any score
or weighting. Search results (`?q=`) are shown newest-first only, without the seen/kept tiering — a
deliberate lookup, not passive discovery.

### The Dispatch reader

`app/board/[dispatchId]/page.tsx` — the writing is the hero: title, writer identity (interactive,
linking to the existing public Mind/profile route), publication date, topics, full formatted body,
paragraph-linked Moments, a Keep action, and Close/back. **No horizontal swipe, no next-on-swipe, no
automatic next Dispatch, no "Up next" — Close/back is the only way out, and opening a different
Dispatch always requires a separate, deliberate tap** from The Board, Home's shelf, or a profile.
`getDispatchById` relies entirely on RLS to decide visibility — a missing id and a genuinely private/
unpublished one are indistinguishable by design, both rendering `notFound()`.

### Viewed / automatic reading position

`public.dispatch_views` (`viewer_id`, `dispatch_id`, `last_paragraph_index`, `viewed_at`) is private
per-viewer state — RLS scopes every row to `auth.uid() = viewer_id`, so an author has no way to query
how many people have viewed their own Dispatch. **No view count exists anywhere.** Resume position is
a content-stable paragraph index, not a raw pixel scroll offset (which breaks across viewport widths,
font-size changes, and any future reflow) — tracked via an `IntersectionObserver` in
`app/board/[dispatchId]/dispatch-reader.tsx`, saved on a 4-second interval and on unmount, never on
every scroll event. No Save Bookmark button or visible bookmark workflow exists; `clampReadingPosition`
(lib/dispatches.ts) guarantees the reader always lands somewhere valid even if a stored position is
now out of range.

### Keep in Mind

Terminology is locked: full concept **Keep in Mind**, short action **Keep**, selected state **In
mind**, private-collection language **Minds I keep**. Icon: a bookmark ribbon
(`app/board/keep-button.tsx`) — never a heart, eye, or bell (all explicitly considered and rejected).
`public.kept_minds` (`viewer_user_id`, `kept_user_id`) enforces every rule at the database level, not
merely by app convention: a member cannot Keep themselves (`kept_minds_no_self_keep`), RLS scopes
every row to `auth.uid() = viewer_user_id` so the kept person has no policy path to ever query who has
kept them, and there is no UPDATE — Keep is a plain insert/delete toggle. Keeping someone does **not**
establish correspondence, does **not** authorize private messaging, and does **not** notify the writer
in this release. Used only for Board ordering (above) — never displayed as a count anywhere.

### Home Board shelf

A static responsive row/grid near the upper part of Home (`app/home/board-shelf-card.tsx`, wired into
`app/home/page.tsx`) — **explicitly not a carousel**: no swipe, no drag, no auto-advance, no arrows.
Fetches a small fixed pool (4, via `getRecentDispatchesForShelf`) and lets a responsive grid
(`grid-cols-2 sm:grid-cols-4`) reflow per viewport rather than forcing exactly 4 cards on narrow
mobile. Each preview shows title, ~2 lines of writing, writer pseudonym + Mindform, and one small
Moment thumbnail when the Dispatch has one (`getFirstMomentThumbnails`, batched). Tapping a preview
opens that Dispatch directly; "See all" leads to `/board`.

### Still-image Moments in Dispatches

Dispatches support still-image Moments using the same paragraph-linked grammar as private letters —
reused, not reinvented. Critically, this is a **separate table and storage bucket** from private
letters', not a shared one: `public.dispatch_moments` (photo-only — no `postcard_key` column exists
here at all) and the `dispatch-photos` storage bucket, with their own RLS entirely independent of
`public.moments`/`letter-photos`' correspondence-specific consent model
(`moments_select_participant`, `can_view_letter_photo`, `photo_consent_status`). That model must never
be weakened or reinterpreted to fit a public-publishing context — a Dispatch photo's actual visibility
rule is simply "published, or the viewer is the author," enforced by `dispatch_photo_is_visible`.
Storage path is keyed by **author id**, not Dispatch id (`dispatch-photos/{author_id}/{random}.jpg`)
— deliberately, since a Dispatch photo is uploaded during composing, before the Dispatch row exists at
all; keying by Dispatch id would create a chicken-and-egg problem where even the author couldn't
preview their own not-yet-published photo. Reuses image re-encoding/EXIF-stripping/compression
unchanged (extracted to the shared `lib/image-processing.ts` during this checkpoint specifically so
both composers use one implementation, not two that could drift) and the existing inline-token/
full-screen-viewer reader components (`photo-moment-token.tsx`, `photo-moment-viewer.tsx`) as-is.
Reader: small inline/paragraph-associated token → tap → full image → close → return to reading, same
as a private letter. **No video. No Postcards in Dispatches — Postcards remain private-
correspondence-only** (see §20.D).

### Postcard entry-point audit — real defect found and fixed

Inspection found the Write Anytime composer's Postcard entry point had been genuinely lost: since the
continuous-Tiptap-editor rewrite, `moments-composer.tsx` had become photo-Moments-only (its own
doc comment already said so), and `postcard-picker.tsx` was defined but imported nowhere in the app —
Postcards had no reachable entry point at all in live code, only in the underlying architecture
(reader rendering, RPC support) which was never actually exercised. Restored the minimum working
access, per the explicit instruction not to redesign Postcards: added a `postcardMoment` Tiptap node
(`app/letters/[letterId]/postcard-moment-node.tsx`, mirroring `photoMoment`'s architecture exactly) and
an "Add a postcard" option in the composer's existing photo-picker sheet, opening the unchanged
`PostcardPicker` inline. `docToMomentDrafts` now also serializes a `postcardMoment` node into a
`{type: 'postcard', postcardKey}` draft. No change to `write_letter`'s Postcard validation, the
catalog, or Featured/My Postcards/Places/Collections sections — all confirmed already correct and
untouched. Premium Postcard presentation/collectibility/scarcity/catalog packaging remains its own,
separate, later checkpoint (§22's monetization notes already record this direction) — not built here.

### Public profile integration

`app/minds/[userId]/page.tsx` shows a restrained "Dispatches" section (up to 5, newest first) when
that author has published any, and shows nothing at all otherwise — no empty-section chrome, no
follower/social-statistics of any kind. Question answers remain visible in their own, separate,
unchanged section. The full future profile redesign was explicitly NOT performed in this checkpoint.

### Privacy / safety

The Board is authenticated-community public writing — every route redirects an unauthenticated
visitor to sign-in, matching every other Minds-adjacent surface (confirmed live: `/board`,
`/board/write`, `/board/[dispatchId]`, and the legacy redirect stubs all 307 to `/sign-in` when
signed out). No email, exact location, GPS, storage path, correspondence-only data, private draft
data, viewer reading position, or Keep relationship/count is ever exposed by any Dispatch query or
RPC — reading position and Keep relationships are both scoped by RLS to `auth.uid()` alone, not merely
by app-level convention. No blocking/report relationship table exists yet anywhere in this schema
(confirmed by inspection — §24-E still lists Block/Report as not yet built); there is therefore
nothing for a blocked relationship to bypass today, and no half-working safety framework was invented
to compensate — `dispatches_select_published`/`kept_minds_own`/`dispatch_views_own` are the policies
to extend once blocking exists.

### Deliberately NOT built this checkpoint

Unpublish/edit/delete (no UPDATE/DELETE policy exists on `dispatches` at all — a genuine database-
level guarantee, not just an absent UI control); Notes (comments); video Moments; the redaction tool
(spec locked, see §20.E); the full future profile redesign; complex ranking beyond the fixed
unseen-kept → unseen-other → seen tiers; notifications; the final visual-system pass.

### Tests

New/updated across `lib/dispatches.ts`, `lib/dispatches.test.ts`, `lib/__tests__/fakeDispatches.ts`,
`lib/letter-editor-draft.ts`/`.test.ts` (Dispatch-scoped draft), and the `app/board/*`/`app/home/
board-shelf-card*` component files — covering: only published Dispatches are visible (browse,
per-author, reader, search) both when the viewer is a stranger and when they're the author; title
required/blank-rejected/max-length-enforced both client-side and via the `publish_dispatch` RPC
mirror; topic normalization (trim, blank-rejection, case-insensitive dedup, 3-cap, length-clip); Board
ordering's three-tier structure and author-diversity interleave, proven with no popularity signal
anywhere in the inputs; Keep's self-rejection and its strict per-viewer privacy (a kept person's own
query for "do I keep them" — a nonsensical but concretely tested reversal — correctly finds nothing);
reading-position clamping against an out-of-range stored value; rich/plain body rendering safety and
Moment-paragraph-position correctness; no Postcard rendering in a Dispatch; no swipe/carousel
vocabulary or machinery in the reader or the Home shelf; no like/reaction/comment/view/follower
vocabulary anywhere in the new components. `tsc --noEmit` clean. Full Vitest run: 50 files, 513 tests,
all passing (507 prior + a handful net new after two initial test-authoring mistakes were caught and
fixed — a `viewBox`-substring false positive and a `maxLength` casing mismatch — both fixed within
this same checkpoint). ESLint: the same 10 pre-existing findings as before, plus 3 new `<img>` LCP
warnings from new photo-Moment/shelf-thumbnail components — the same accepted warning category every
existing Moment-image component in this codebase already carries, not a new category of issue — and
zero new errors (one legitimate `react-hooks/set-state-in-effect` finding surfaced during this
checkpoint's own work was fixed, not merely suppressed, by the time of the final run).

### SQL/schema status

`docs/sql/2026-09-07-dispatches-and-board.sql` is PREPARED and NOT EXECUTED. It is one transactional
migration against the ALREADY-LIVE `open_letters` table (renamed in place to `dispatches`; existing
rows, if any, survive) — never a drop/recreate. It adds: the `title` column (nullable-then-backfilled-
then-NOT-NULL, the standard safe sequence); the `dispatch_visible_length` ceiling function and its
constraint (replacing the old 200,000-character defensive-only check); `dispatch_topics`;
`dispatch_moments` plus the `dispatch-photos` storage bucket and its policies; `dispatch_views`;
`kept_minds`; the `publish_dispatch` RPC (title/topic/Moment validation, one atomic transaction, same
reasoning as `publish_question_answer`); and `search_dispatches`. It also adds `dispatch_shares`,
`dispatch_photo_is_externally_shared`, and `get_shared_dispatch` (see "Dispatch sharing / external
reading" below) — all still part of the same single, still-unexecuted transaction. Nothing above is
functional until this migration is run and confirmed live — the composer/browse/reader code already
calls tables that do not exist yet, and the external-sharing route/UI described below has not been
built yet either (SQL only, prepared ahead of that implementation pass).

### Dispatch sharing / external reading

Canonical addition (2026-09-07). A published Dispatch may be shared outside TEMPA and read by a
signed-out visitor via an unguessable share link; the raw Board and `/board/[dispatchId]` remain fully
authenticated as before — nothing about them is weakened. Design, after inspecting the existing
architecture (no service-role/admin Supabase client exists anywhere in this codebase; every client uses
the publishable key; there is no `middleware.ts` and no existing precedent for a signed-out visitor
reading Postgres data — every other route gates via `redirect('/sign-in')`):

**Database contract: LIVE and VERIFIED (2026-09-08).**
`docs/sql/2026-09-07-dispatches-and-board.sql` has been executed against the live database and
`docs/sql/2026-09-07-dispatches-and-board-verify.sql` passed every check — all six tables' RLS, the
one-active-share partial unique index and its invariant, all four hardened `SECURITY DEFINER` functions
(`pg_catalog`-pinned `search_path`, no unqualified references), no `anon`/`PUBLIC` base-table grants
anywhere, `anon`'s read access to a shared Dispatch and its photos, the two sharing RPCs' authenticated-
only execute grants, `dispatch-photos`'s continued privacy, and the storage policies' exact role scopes.
The **application layer described below is now built and live on top of that contract** (2026-09-08).

**Three distinct product states — kept structurally distinct, not just in prose:**

-   **Published** = `dispatches.status = 'published'` — visible to any authenticated member on the
    Board. Sharing changes nothing about this.
-   **Shared** = a live `dispatch_shares` row exists for that Dispatch (`revoked_at is null`) — the
    author deliberately tapped Share. Published does not imply shared, and vice versa (a share row
    surviving a later unpublish is simply never readable — `get_shared_dispatch` gates on both).
-   **Private correspondence** = has no table, function, or route anywhere in this design, or anywhere
    in this file. Sharing is exclusively a Dispatch concept, by construction.

External recipients read the *entire* shared Dispatch — title, pseudonym, body, topics, still-image
Moments — without creating an account; signup never gates the writing itself. Authentication is
required only for TEMPA actions beyond that one shared Dispatch: Keep, Board browsing, a member's
profile/history, discovery, and correspondence.

-   `dispatch_shares` (`id` doubling as the share token itself, `dispatch_id`, `created_at`,
    nullable `revoked_at`) — RLS grants the owning author `SELECT` only on their own rows; there is
    no `INSERT`/`UPDATE` policy or table grant at all. Creating and revoking a share are never ordinary
    client mutations against this table — see the two RPCs below, the only write path.
-   A partial unique index, `dispatch_shares_one_active_per_dispatch` on `(dispatch_id) where
    revoked_at is null`, enforces at the database level that a Dispatch can have at most one live
    share at a time. Historical revoked rows are unrestricted and simply accumulate.
-   `share_dispatch(p_dispatch_id uuid)` — authenticated-only `SECURITY DEFINER` RPC. Verifies auth,
    ownership, and that the Dispatch is currently published; atomically returns the existing live share
    if one exists, or creates one (via `INSERT ... ON CONFLICT` against the partial unique index above,
    which is what makes the get-or-create race-safe under concurrent calls, not application-level
    locking). `DEFINER` is required, not a convenience: authenticated holds no `INSERT` grant on
    `dispatch_shares` at all, so an `INVOKER` function would fail on privilege before its own
    ownership/status check even ran.
-   `revoke_dispatch_share(p_dispatch_id uuid)` — "Stop sharing externally." Authenticated-only
    `SECURITY DEFINER` RPC; verifies ownership only (deliberately not also requiring `published`, so an
    author can still stop sharing something they've since unpublished) and sets `revoked_at = now()` on
    the live share if one exists — a no-op, not an error, if none does.
-   `get_shared_dispatch(p_token uuid)` — a narrowly-scoped `SECURITY DEFINER` RPC, the *sole* path
    by which an anonymous visitor may read anything: title, body, `published_at`, the author's
    pseudonym only (via `public_profiles`), topics, and each Moment's position/path. Returns zero rows
    (never an error, never another Dispatch's data) for an invalid, revoked, or not-currently-published
    token — deliberately not distinguishing those three cases. `DEFINER` is genuinely required here
    (`anon` holds no table grants at all in this schema) rather than a convenience choice.
-   `dispatch_photo_is_externally_shared` + a new `dispatch_photos_select_shared` storage policy
    (`to anon` only) — scoped specifically to "this photo belongs to a Dispatch with a live share,"
    never to "any published Dispatch's photo." The `dispatch-photos` bucket stays private
    (`public = false`); nothing makes it publicly listable.
-   Fixed in the same pass: `dispatch_photos_insert`/`dispatch_photos_select` had no explicit
    `to authenticated` clause (defaulting to role `PUBLIC`), an inconsistency with every other policy
    in the file, closed as part of adding the new anon-facing policy alongside them.
-   A raw Dispatch UUID continues to grant an anonymous caller nothing — `dispatches`/`dispatch_topics`/
    `dispatch_moments` keep their existing `authenticated`-only grants completely unchanged; only a
    valid share token, through `get_shared_dispatch`, works. `share_dispatch`/`revoke_dispatch_share`
    are never executable by `anon` under any circumstance — only an authenticated author can create or
    revoke a share on their own Dispatch.

**Application layer — built (2026-09-08):**

-   **Share control** (`app/board/share-dispatch-button.tsx`) — rendered in place of Keep on the
    Dispatch reader header (`app/board/[dispatchId]/page.tsx`) exactly when the viewer is the Dispatch's
    own author. Always calls `share_dispatch` via `lib/dispatches.ts`'s `shareDispatch` (never a
    client-generated token, never a direct `dispatch_shares` insert); the page's own initial render
    additionally fetches the current live share, if any, via `getActiveDispatchShare` (a plain,
    author-scoped `SELECT` — the one case where reading the table directly, rather than through an RPC,
    is genuinely appropriate, since it is only ever checking the caller's own state) so "Share" vs
    "Sharing • Stop sharing" renders correctly without an extra round trip. Uses `navigator.share` where
    supported (title = Dispatch title, text = `"<title> — by <pseudonym> on TEMPA"`, url = the
    `/d/[token]` link — never the Dispatch body, never a raw id or storage path); falls back to
    `navigator.clipboard.writeText` with a quiet inline "Link copied" confirmation, never a blocking
    `alert()`. "Stop sharing externally" calls `revokeDispatchShare` (`revoke_dispatch_share`) and
    touches nothing about the Dispatch row itself — publication and Board visibility are unaffected,
    confirmed by test (`lib/dispatches.test.ts`, item 20).
-   **External reader** (`app/d/[shareToken]/page.tsx` + `shared-dispatch-view.tsx` +
    `dispatch-unavailable.tsx`) — a signed-out-accessible route deliberately outside `AppShell`, with its
    own `generateMetadata` (title + pseudonym only, never the body). Fetches exclusively through
    `getSharedDispatch` (`get_shared_dispatch`) — never a direct query against
    dispatches/dispatch_topics/dispatch_moments/public_profiles/kept_minds/dispatch_views. An invalid,
    revoked, or unpublished token all render the same generic `DispatchUnavailable` state ("This
    Dispatch is no longer available."), never revealing which case occurred. Reuses `DispatchBody`
    unchanged (no paragraph-index tracking — there is no reading-position state for an anonymous
    visitor). No Board/Letters/Minds/You nav, no search, no Keep, no link to the author's profile or
    their other Dispatches, no swipe/next-Dispatch/feed-continuation of any kind. The Join TEMPA CTA
    (`"Discover more minds and writing like this."`) sits *after* the full body, additive, never gating
    it; an already-authenticated visitor sees "Go to The Board" instead. Mindform's `identifier` is the
    Dispatch's own id, not the author's user id — `get_shared_dispatch` deliberately never returns the
    author's id to an anonymous caller, so the same author's tint will not match their in-app Mindform
    here; a deliberate, accepted consequence of that privacy boundary.
-   **Moment images** — no code changes were needed beyond what the live SQL already authorizes:
    `getSharedDispatch` resolves each Moment's `image_path` via the same
    `supabase.storage.from('dispatch-photos').createSignedUrls(...)` call `getDispatchMoments` already
    used for the authenticated reader, now authorized for an anonymous caller by the live
    `dispatch_photos_select_shared` policy + `dispatch_photo_is_externally_shared`. No service-role
    credentials, no bucket-public flip, no proxy — the storage RLS layer is the entire mechanism. Raw
    storage paths never reach rendered output (only the resolved `imageUrl` is ever passed to a
    component).

**Private letters — hard exclusion, permanent.** Private correspondence (Letter 1 and every established
correspondence letter) is not forwardable through TEMPA in any form: no Share/Forward control, no
share-token schema, no "send this letter to another TEMPA user" action, no social-sharing action of any
kind. Nothing in `dispatch_shares`/`get_shared_dispatch`/`dispatch_photo_is_externally_shared` touches
`letters`, `correspondences`, or `public.moments` — sharing is exclusively a Dispatch concept, by
construction. TEMPA cannot prevent an operating-system screenshot or manual copy-paste, but the product
itself must never provide forwarding infrastructure for sealed correspondence. Any future feature work
must preserve this exclusion; it is not an oversight to revisit. Audited 2026-09-08: no file under
`app/letters` or `app/write` contains a Share/Forward control, `navigator.share`, or any reference to
`dispatch_shares`/`share_dispatch`/`revoke_dispatch_share`/`get_shared_dispatch` — confirmed both by
inspection and by a source-level regression test
(`lib/__tests__/privateLettersNoSharing.test.ts`) that scans every file in both directories, plus a
rendering-level guard on the letter reader itself (`letter-body.test.tsx`'s "no external sharing
affordance" test).

**Tests (2026-09-08):** `lib/dispatches.test.ts` (share_dispatch/revoke_dispatch_share/
get_shared_dispatch call shape, token reuse, a fresh token after revoke, revoke leaving the Dispatch
published, an invalid/revoked/unpublished token all returning null, Moments scoped to the correct
Dispatch only, no raw storage path ever returned), `app/board/share-dispatch-button.test.tsx`
(accessible "Share" control, never "Forward", correct conditional "Stop sharing externally"),
`app/d/[shareToken]/shared-dispatch-view.test.tsx` (full reading without gating, no Board/Keep/profile/
feed-continuation affordance, authenticated-vs-anonymous CTA branching, generic `DispatchUnavailable`
copy), and the private-letter audit above. Click-driven behavior (the actual RPC call, native-share-vs-
clipboard branching, URL construction) is covered at the `lib/dispatches.ts` level rather than via
simulated DOM events, consistent with this codebase's established renderToStaticMarkup-only testing
convention (no jsdom) — the same reason `KeepButton` has never had a dedicated test file either. Async
Server Component pages (`app/d/[shareToken]/page.tsx`, `app/board/[dispatchId]/page.tsx`) are verified
by inspection and live browser navigation, not unit tests — also established precedent.

### Live-test procedure, after the SQL is applied

1. Publish a Dispatch with a title, body, and 2-3 topics; confirm it appears at the top of `/board`
   immediately, with its title/excerpt/topics all correct.
2. Attempt to publish with a blank title, then a 71-character title; confirm both are rejected with
   the expected copy, before and after a page reload (draft survives).
3. Publish a deliberately very long (near-10,000-character) Dispatch using Bold/Italic; confirm
   Publish is never blocked and no length UI ever appears.
4. Attach a still-image Moment during composing; confirm it previews correctly, publishes correctly,
   and renders as an inline token in the reader that opens/closes correctly.
5. From the reader, tap the writer's identity; confirm it opens their correct public profile, and that
   profile's "Dispatches" section lists this one.
6. Keep a writer from a Board card and from the reader; confirm the button state persists across a
   reload, and confirm (as a second test account) that the kept writer has no way to see who kept
   them.
7. Read partway through a long Dispatch, navigate away, and reopen it; confirm it resumes near where
   you left off, and confirms this position is not visible to the author or anyone else.
8. Confirm Board ordering: as a fresh account, an unseen Dispatch from someone you Keep appears ahead
   of unseen Dispatches from people you don't, which appear ahead of anything you've already opened.
9. Search for a word that only appears in one Dispatch's topics, then one that only appears in its
   body; confirm both find it.
10. Sign out and confirm `/board`, `/board/write`, and `/board/[dispatchId]` all redirect to sign-in;
    confirm the legacy `/minds/open-letters*` paths redirect to their new `/board*` equivalents.
11. In the Write Anytime composer (an established correspondence), confirm "Add a postcard" is
    reachable again from the photo-picker sheet and attaches correctly, unchanged from its previously
    working behavior.
12. Repeat the composer, Board list, and Home shelf at mobile width — confirm no horizontal overflow
    and no accidental swipe/drag behavior anywhere.
13. As the author of a published Dispatch, tap Share; confirm the native share sheet appears on a
    supporting device (or Copy link + a quiet "Link copied" confirmation otherwise), and that tapping
    Share again reuses the same link rather than producing a new one.
14. Open the copied `/d/[token]` link in a private/incognito window (signed out); confirm the full
    Dispatch (title, pseudonym, date, topics, body, Moments) renders with no account wall, no Board/
    Letters/Minds/You nav, no Keep control, and a restrained "Join TEMPA" CTA after the writing.
15. As the author, tap "Stop sharing externally"; confirm the same link now shows the generic "This
    Dispatch is no longer available" state, that the Dispatch itself still appears normally on the
    authenticated Board, and that tapping Share again produces a genuinely new link (not the old one).
16. Open an invalid `/d/` token (a random string) and confirm the same generic unavailable state as a
    revoked one — no way to tell the two apart from the outside. Open a valid, live `/d/[token]` link
    while signed in and confirm it still renders correctly, with "Go to The Board" in place of "Join
    TEMPA".

### Board live-test corrections (2026-09-10)

A live-test pass on the Board usability + external-sharing work above surfaced one critical bug and a
set of application-layer/copy corrections. **No SQL was executed as part of this checkpoint** — the one
genuine schema gap found (external country) is prepared but deliberately NOT applied; everything else
below was already a code/copy-level fix.

**External Moments not rendering — initial hypothesis (superseded, see the 2026-09-10 live-trace section
below for the confirmed root cause).** Full-chain inspection (`get_shared_dispatch`'s SQL body →
`lib/dispatches.ts`'s `getSharedDispatch` → the `dispatch-photos` signed-URL resolution →
`SharedDispatchView`/`DispatchBody`) found the entire application-layer chain logically correct and
already covered by a passing `lib/dispatches.test.ts` test ("a valid, live token returns ... resolved
Moment URLs") against a fake that always signs successfully. The first hypothesis — that section 12 of
`docs/sql/2026-09-07-dispatches-and-board.sql` (`dispatch_photo_is_externally_shared` /
`dispatch_photos_select_shared`) simply wasn't live — was checked directly with a read-only database audit
and **disproven**: that entire contract was confirmed correctly live. `getSharedDispatch` gained dev-only
per-stage diagnostic logging as part of chasing this down (see below); a live trace against a real shared
Dispatch with a real Moment then found the actual cause, which was neither a code bug nor a gap in the
Dispatch-specific SQL at all.

### External Dispatch Moment — confirmed root cause and fix (2026-09-10, live trace)

A read-only Supabase audit confirmed the entire Dispatch-specific external-sharing contract
(`dispatch_photo_is_externally_shared`, `dispatch_photos_select_shared`, the private `dispatch-photos`
bucket, RLS on every Dispatch table, the one-active-share index, `get_shared_dispatch`'s grants) was
correctly live — retiring the SQL-not-applied hypothesis above. A live end-to-end trace was then run
against a real shared Dispatch with a real Moment (dev-only diagnostics added to `getSharedDispatch` in
`lib/dispatches.ts` and to `DispatchBody`), which found:

-   `get_shared_dispatch` correctly returned all 4 Moments with correct positions/paths.
-   All 4 paths correctly reached `createSignedUrls`.
-   The signing call failed for **all** paths, at the call level (not per-path), with:
    `{ message: 'permission denied for function can_view_letter_photo', name: 'StorageApiError', status: 400 }`.

**Root cause:** `can_view_letter_photo` (`docs/sql/2026-08-31-first-photo-consent.sql`) is a
PRIVATE-LETTER-photo function, wholly unrelated to Dispatches, `EXECUTE`-granted to `authenticated` only.
The policy that calls it, `letter_photos_select`, was created with **no explicit `to` clause**, so it
defaults to role `PUBLIC` — meaning Postgres includes it when evaluating ANY role's (including `anon`'s)
SELECT against `storage.objects`, for every row, regardless of `bucket_id`. Because RLS-protected
relations are wrapped as security-barrier views, `bucket_id = 'letter-photos' and
can_view_letter_photo(name)` is not guaranteed to short-circuit past the `bucket_id` check for a
`dispatch-photos` row — Postgres attempts to evaluate `can_view_letter_photo(name)` regardless, `anon` has
no `EXECUTE` privilege on it at all, and the entire `storage.objects` RLS check errors out for `anon`, for
every bucket, not just `letter-photos`. This is the exact same class of gap already found and fixed for
`dispatch_photos_insert`/`dispatch_photos_select` in the Board usability checkpoint (2026-09-08) — this
one pre-existing policy, from an earlier migration, simply predated that fix and nothing had exercised an
`anon` request against `storage.objects` at all until Dispatch sharing shipped, so the gap went unnoticed.

**No application-code bug exists.** Every stage of `getSharedDispatch` and `DispatchBody` traced correctly
(paths, structure, paragraph/position alignment) — the failure happens entirely inside Postgres's RLS
evaluation before app logic has any influence over it.

**The fix** (`docs/sql/2026-09-10-letter-photos-select-role-scope-fix.sql`, guarded by pre/post-mutation
verification inside one transaction, prepared for the user to run — never executed by the assistant):
scope `letter_photos_select` to `authenticated` — a pure narrowing, not a capability change, since
`authenticated` callers already satisfied the implicit `PUBLIC` scope and `anon` could never legitimately
pass this policy anyway (no `EXECUTE` grant on the function it calls). Private-letter photo consent/
visibility logic, `can_view_letter_photo` itself, both storage buckets' public/private state, and every
Dispatch-specific storage policy are unchanged — verified explicitly both before and after the change,
inside the same transaction, which aborts via `RAISE EXCEPTION` if any invariant doesn't hold.

**External Moment discovery hint.** A shared Dispatch with ≥1 photo Moment now shows one restrained,
dismissible line above the reading surface — "A glimpse from the writer's world — tap a small image as
you read to open it." (`app/d/[shareToken]/moment-hint.tsx`) — never per-image, never a modal, no
animation. Dismissal is `sessionStorage`-only, keyed per Dispatch id; there is deliberately no database
persistence for an anonymous visitor's hint state.

**Stamps audited: not a Dispatch feature.** No "Stamps" concept exists anywhere in the Dispatch schema,
RPCs, or reader components — it does not need an external-safe representation because it was never built
for Dispatches in the first place. (The term does not appear anywhere under `app/board` or
`lib/dispatches.ts`.)

**Board list Moment thumbnail.** `app/board/page.tsx` now calls `getFirstMomentThumbnails` (the same
batched lookup Home's shelf already used) and threads a `thumbnailUrl` prop into `DispatchCard` — the
same small, fixed `h-14 w-14` treatment `BoardShelfCard` already used, so a Dispatch's Moment now shows
consistently on both Home and the Board, not just Home.

**Keep/In-mind layout — locked structure.** `DispatchCard` now separates the identity row
(Mindform + pseudonym + flag + date) from the title/excerpt/thumbnail block below it — `keepSlot` is a
sibling of the identity group only, never inside the same flex row as the title/excerpt, so its width can
no longer influence how much room the excerpt column gets. `KeepButton`'s own label ("In mind" vs.
"Keep <pseudonym>", different lengths) is rendered as two stacked CSS-grid children, only one ever
visible (`invisible`, which still reserves layout space) — so the control's own width is always the wider
of the two possible labels for that specific pseudonym, and toggling never shifts anything around it. Kept
state is fetched once per Board page load into a single `keptUserIds` set and passed identically to every
`DispatchCard` by that author, so it already reflects consistently across all of one writer's Dispatches
for a given viewer — confirmed by inspection, not a new mechanism.

**Author actions menu — reordered, spaced, and share-complete.** Fixed order is now: Edit Dispatch; Pin to
profile / Unpin from profile; Share externally / Stop sharing externally; a divider; destructive Delete
Dispatch; a full-width quiet Cancel. The menu previously had no "Share externally" action at all when
nothing was currently shared (only a conditional "Stop sharing"), forcing an author to use the separate
always-visible `ShareDispatchButton` to start sharing in the first place — inconsistent language for the
same capability. `AuthorActionsMenu` now offers both directions itself, calling the same `shareDispatch`/
`revokeDispatchShare` RPCs either component would. Desktop (`sm:` breakpoint) renders the same content as
a small anchored popover under the trigger instead of an oversized full-width mobile sheet, dismissible by
clicking outside it.

**Share lifecycle — confirmed correct, no SQL change.** `share_dispatch`'s existing get-or-create semantics
(`INSERT ... ON CONFLICT` against the partial unique index scoped to `revoked_at is null`) already
guarantee that stopping a share permanently kills that token and a later re-share always mints a brand-new
one — verified by the existing `lib/dispatches.test.ts` test ("sharing a Dispatch that is already shared
again after a revoke produces a fresh token"). Nothing about this required touching the database; the fix
was purely giving the author-actions-menu equivalent language to the standalone share button.

**External country flag — the one prepared-but-NOT-executed SQL gap.** `get_shared_dispatch` genuinely
does not return country today (title/body/published_at/author_pseudonym/topics/moments only), so the
external reader has nothing to flag with. `docs/sql/2026-09-10-shared-dispatch-country.sql` is prepared
(widens the function's return row by one column, `author_country`, sourced from the same
`public_profiles.country` the pseudonym already joins against — no grant/RLS/security change of any kind)
but **deliberately not executed**. `lib/dispatches.ts`'s `SharedDispatch`/`SharedDispatchRpcRow` and
`SharedDispatchView` are already updated to read `authorCountry` and render `CountryFlag` once/if that
migration is applied; until then `authorCountry` is simply always `null` and no flag renders externally
(correct, harmless fallback — never queries `public_profiles` directly from the anonymous page as a
workaround).

**External acquisition entry.** `/sign-in` now supports a `?intent=join` mode (`app/sign-in/page.tsx`) —
headline "Create your Tempa account" with a "Already have an account? Sign in" toggle, versus the default
"Sign in" with "New to Tempa? Create an account." Both modes drive the exact same magic-link/Google flow;
nothing guesses whether a visitor already has an account, since the underlying mechanism already handles
both identically (a magic link creates an account for a new email, signs in an existing one). The external
reader's Join CTA and `DispatchUnavailable`'s CTA both route to `/sign-in?intent=join` now, not a bare
"Sign in" a first-time visitor would find confusing.

**External positioning copy.** Replaced "Discover more minds and writing like this." (read as
Medium-style content-discovery framing) with explicit pen-pal/correspondence positioning: "Tempa is a
pen-pal experience built around thoughtful letters, shared questions, and glimpses from people's worlds.
Meet minds worth writing to." — kept to one short line, not a marketing paragraph, and shown only to a
signed-out visitor (an authenticated visitor sees just "Go to The Board").

**Revoked/unavailable link copy — security constraint preserved.** The preferred copy direction included a
line implying the writer had chosen to stop sharing; that would leak "revoked" specifically as distinct
from invalid/deleted/unpublished, so it was deliberately **not** used — `DispatchUnavailable`'s failure
message stays exactly as generic as before. Only its CTA wording ("Join Tempa," pen-pal framing) and
routing (`/sign-in?intent=join`) changed.

**TEMPA wordmark rule — locked.** The masthead treatment is `font-serif text-lg italic text-foreground`
with mixed-case "Tempa" (as already used in `app-shell.tsx`, `dispatch-unavailable.tsx`,
`letters/moment-display.tsx`) — reserved for an actual masthead position, never sprinkled into ordinary
sentences or buttons. `shared-dispatch-view.tsx`'s masthead previously used the small-caps
`sectionLabelClass` eyebrow style with all-caps "TEMPA" instead — an inconsistent one-off, now corrected
to the same italic-serif masthead every other screen uses. Every remaining all-caps "TEMPA" found in
UI-adjacent copy (`share-dispatch-button.tsx`'s native-share text, `app/d/[shareToken]/page.tsx`'s page
`<title>`, both CTA buttons) was normalized to plain mixed-case "Tempa." A masthead is a placement, not a
casing rule to reapply elsewhere.

**Medium/product distinction — recorded, not enforced mechanically.** Writing stays primary; a Moment is
a small glimpse anchored to a point in the reading, never a conventional article image; the destination a
reader is being invited toward is discovering a mind/correspondence, not followers or readership. No
competitor names appear anywhere in UI copy. Future note: "pen pal"/"pen-pal" should appear in public-
facing landing/SEO/store-listing metadata once that surface exists — but this is never to be mechanically
injected throughout the authenticated in-app UI, which stays in its own established system/human-voice
grammar (see the SYSTEM VOICE section of `app/profile/ui.ts`).

**Paper surface — unchanged, confirmed preserved.** The `bg-surface-shell` sweep from the prior checkpoint
was not touched or regressed by any change in this pass.

**Tests added:** `app/d/[shareToken]/shared-dispatch-view.test.tsx` (country flag, Moment hint visibility,
pen-pal positioning copy, updated "Join Tempa" casing), `app/board/dispatch-card.test.tsx` (thumbnail
rendering, identity-row/keep-slot separation), `app/board/keep-button.test.tsx` (both labels always
present in markup, only one ever `invisible`, regardless of `initiallyKept`), `lib/dispatches.test.ts`
(an old revoked token stays permanently unavailable even after a fresh re-share exists). Existing
regression coverage (private letters non-shareable, no Postcards/video in Dispatches, external identity
non-clickable when signed out) re-confirmed unchanged.

### Approved visual language — partial pass (2026-09-10), blocked pending reference image

A checkpoint requested a full visual-fidelity pass against an approved reference image
(`TEMPA-APPROVED-LETTERBOX-VISUAL-REFERENCE-2026-09-05new(1).png`). **That image was never actually
received** — the message referenced it as an attachment, but no image content reached the assistant, and
it was not found anywhere in the project directory or common local upload locations after an explicit
search. Every part of that checkpoint that depends on actually seeing the reference (the semantic color
palette, typography roles, Letterbox desktop/mobile layout changes, the postal-status SVG's exact
grammar, decorative botanical/postmark motifs, the border/divider system, and the full spacing audit) is
**deliberately not attempted** — fabricating a "warm ivory/terracotta/olive" palette or a Letterbox
redesign without ever having seen the actual reference would be a guess dressed up as fidelity, which is
the opposite of what was asked. This section records ONLY the two items from that checkpoint that were
genuinely independent of the reference image and were completed; the rest remains open, gated on the
image being supplied.

**Country flags — real defect, fixed.** `app/country-flag.tsx` previously rendered flags via the Unicode
Regional Indicator Symbol trick (two emoji code points per flag) — this degrades to bare two-letter text
("BR", "NG") on Windows/browser combinations without flag-emoji glyphs, which is exactly the defect
reported. Replaced with local static SVG assets: `country-flag-icons` (MIT-licensed npm package) ships one
raw SVG per ISO 3166-1 alpha-2 code at `node_modules/country-flag-icons/3x2/*.svg` — all 265 were copied
once into `public/flags/` (591KB total, served as ordinary static assets, never hotlinked, never bundled
into client JS) rather than importing the package's React component module, which would ship every flag's
SVG data into every page's JS bundle regardless of which single flag a given page actually needs. The
component now renders `<img src="/flags/{ISO_CODE}.svg">` at a fixed `h-[9px] w-[13px]` (a 3:2 flag
aspect ratio) so a load failure (an unmapped/garbled country value) collapses to nothing via `onError`
rather than shifting the identity row or showing a broken-image icon. Tooltip/tap-to-reveal behavior,
`aria-label`, and "never more precise than country" are all unchanged. `isoCodeToFlagEmoji` is gone;
`flagAssetPath(isoCode)` is its pure-function replacement, directly tested.

**Internal Dispatch Moment hint — now shared.** The external reader's Moment discovery hint ("A glimpse
from the writer's world — tap a small image as you read to open it.") moved from
`app/d/[shareToken]/moment-hint.tsx` to the shared `app/board/moment-hint.tsx`, with no behavioral change
to the component itself — session-scoped via `sessionStorage`, keyed per Dispatch id, no DB persistence,
no modal. `app/board/[dispatchId]/page.tsx` (the authenticated reader) now renders the same component
whenever `moments.some((m) => m.imageUrl)`, exactly mirroring the external reader's own gating; the
external reader's import path was updated to the new shared location with no other change. Explicitly an
early-launch education treatment for both authenticated and external readers — recorded here as a
candidate for retirement once usage data shows members no longer need the explanation. Never shown on a
Board/Home listing card (`dispatch-card.tsx`/`board-shelf-card.tsx` don't import it — regression-tested).

**Deferred, pending the reference image:** the semantic color token set (`--surface-page`,
`--surface-paper`, `--surface-status`, `--border-warm`, `--accent-postal`, `--accent-olive`, `--ink-
primary`, `--ink-muted` or equivalent), the Letterbox desktop/mobile visual overhaul, the `PostalStatus`
component and "Mail on the way" art, decorative postmark/botanical signature graphics, the "Good letters
take time." treatment, the sidebar empty-space brand line, the typography-role audit, and the border/
divider standardization. None of this was guessed at or partially implemented against an assumed palette.

## 20.D — SAFETY & TRUST: BLOCKING + ENFORCEMENT FOUNDATION (Checkpoint 1B, 2026-09-11)

**Status: SQL prepared, NOT executed.** `docs/sql/2026-09-11-safety-blocking-foundation.sql` +
`-verify.sql` are complete and ready for review but have not been run against the live database.
Application code (lib/blocking.ts, the Keep RPC conversion, BlockButton/UnblockButton, the Blocked
minds settings screen) is written and tested against a fake client, but cannot function end-to-end
until that migration is applied.

**Adults only.** TEMPA remains 18+; Tempa Kids is a separate, future, structurally distinct
environment — no Kids schema, parent/guardian verification, child accounts, or Kids UI exist or are
implied by anything in this section. A verified-guardian-controlled child account model, delivery
passing through guardian approval, and the adulthood transition all require a dedicated future legal/
child-safety architecture review before any of it is built.

**Block record vs. effect.** One directional stored row (`blocked_users`: A blocks B) with a mutual
behavioral effect — once either side has blocked the other, neither can initiate new interaction with
the other anywhere in the product. No block count, no "blocked by" list, no notification to the
blocked member, anywhere. Blocking and (future) reporting are architecturally independent — a block
never creates a report row, and nothing here assumes reporting exists yet.

**Profile invisibility, enforced at the data boundary.** `public_profiles` (the sole cross-user
profile read path, used by Discovery, the public profile page, and every Dispatch author lookup) is
rewritten to exclude a blocked pair from each other's view, in the view's own `WHERE` clause — not in
application code. A known profile URL cannot bypass this: `GET public_profiles?id=eq.<blocked-user>`
returns zero rows through any access path, and the existing `notFound()` handling on `/minds/[userId]`
needs no change at all, since it already treats "no row" as the generic unavailable state — a blocked
profile is structurally indistinguishable from a nonexistent one, never a distinguishable message.
External anonymous `/d/[shareToken]` never reads `public_profiles` and is completely unaffected — see
below.

**Board/Question exclusion, also at the data boundary.** `dispatches_select_published`'s own RLS
`USING` clause gained the same block exclusion — `dispatch_topics`/`dispatch_moments`'s own policies
inherit it automatically (they delegate via a genuine `exists` subquery against `dispatches`, and
Postgres RLS applies recursively to a protected table referenced anywhere in a query plan), as does
`search_dispatches` (confirmed `SECURITY INVOKER`, not definer — corrects an earlier architecture-
phase assumption). The `question_answers` cross-user SELECT policy (captured via a prerequisite
read-only diagnostic before being touched at all — see below) got the identical treatment, with the
self-SELECT/INSERT/UPDATE policies left completely untouched.

**Correspondence history is never touched by a block.** Historical letter text remains fully readable
by both parties forever; correspondences and archives are never deleted or hidden as a side effect of
blocking; an already-in-transit letter delivers on its existing schedule regardless of a block created
afterward. The only change is forward-looking: `send_first_letter`/`reply_to_letter`/`write_letter`
each refuse to create a NEW letter between a blocked pair, with wording identical to an existing,
unrelated failure case in the same function (never a distinguishable "you are blocked" message).

**No new media after a block; Postcards are a distinct case.** `can_view_letter_photo`/
`dispatch_photo_is_visible` both refuse to issue a *new* signed URL for a blocked pair's private photo
Moments. An already-issued signed URL remains valid until its existing TTL (10 minutes everywhere in
this codebase) — a real, accepted, time-bounded limitation, not something further closeable, since
Supabase signed URLs are bearer tokens never re-checked against RLS after issuance. Postcards need NO
equivalent mechanism at all: a Postcard is a `moments` row referencing a fixed, identical-for-everyone
catalog image (`lib/moments.ts`'s `POSTCARD_CATALOG`), never per-user storage or a signed URL — the
only block-relevant control is that Postcards travel inside letters, and letter-sending is already
blocked, which fully covers it.

**External anonymous Dispatch shares cannot honor a block — by design, not oversight.** `/d/
[shareToken]` has no authenticated identity to check a block against; fingerprinting or otherwise
tracking anonymous visitors to approximate one would be a real privacy regression, not a safety
improvement. This is a permanent, structural limitation, documented rather than worked around — the
correct tool for harmful shared content is the future reporting system (which acts on content
regardless of viewer identity), not blocking (which governs account-to-account interaction).

**Keep cascade, and Keep's RPC-only conversion.** `block_user` atomically removes any existing
`kept_minds` row between the pair, in both directions, in the same transaction as the block itself —
unblocking never restores it. Finding: `kept_minds` was the one write surface in the entire schema
still open to direct client INSERT/DELETE (gated only by RLS, no RPC) — exactly the kind of gap that
would let a hostile client bypass any block check placed only inside application code. Fixed by
revoking `authenticated`'s direct insert/delete grant and introducing `keep_mind`/`unkeep_mind` as the
only write path; `keep_mind` checks self/block/account-status, `unkeep_mind` (de-escalating) remains
available unconditionally.

**Restricted/suspended/banned — what each can and cannot do.** `account_enforcement_state` (a table
deliberately separate from `profiles`/`public_profiles`, never bolted-on columns, so a future `select
*`/view change can never accidentally widen who can read it) holds one of `active` (default — absence
of a row means active, no backfill needed), `restricted`, `suspended`, `banned`. Restricted: can read
own history, reply by text in an established correspondence, delete an existing Dispatch, unpin, stop
external sharing, unkeep; cannot initiate correspondence, publish a new Dispatch, edit existing
Dispatch content, publish/set a new public Question answer, Keep a new mind, externally share, or
attach new Moments/media (including a text reply that tries to add a photo — rejected with the exact
wording an ordinary Moments-not-unlocked-yet member already sees). Suspended: none of the above at
all, read-only access to own history. Banned: all writes blocked server-side; immediate session
termination is explicitly deferred to the future admin-enforcement checkpoint, not built here — see
below for why write-blocking is already fully authoritative without it.

**Why server-side checks are authoritative against a modified client, with no further infrastructure
required for write-blocking.** Every RLS policy and RPC check in this migration is evaluated by
Postgres itself, on every single request, regardless of what a client sends — a modified client, a raw
`curl`, or a hand-crafted PostgREST call cannot skip a check enforced server-side; this is the entire
point of putting enforcement in RLS/RPCs rather than the UI. Session revocation (cutting off an
already-issued, unexpired JWT immediately) is a SEPARATE, complementary concern — purely about whether
reads should also stop immediately for a banned account — not a requirement for write-enforcement
integrity, since Postgres refuses the write regardless of session validity. Recommended, when built,
only for `banned` (restricted/suspended explicitly retain read access to their own history by design).

**No public block-check oracle.** `tempa_private.is_blocked_pair(a, b)` lives in a schema never added
to Supabase's PostgREST exposed-schema list, is `SECURITY DEFINER` with a hardened `pg_catalog` search
path, and has no EXECUTE grant to any client-facing role at all — it is reachable only from inside
another `SECURITY DEFINER` function owned by the same role. A blocked member has no way, direct or
indirect, to ask "has this specific person blocked me?" — the closest thing, `get_blocked_profiles()`,
is deliberately narrower: it returns pseudonyms only for the CALLER's own outgoing blocks, which they
already created themselves, existing specifically because the block-aware `public_profiles` view would
otherwise make a member's own "Blocked minds" screen unable to resolve a name for someone they blocked.

**Least-privilege / explicit-policy-role findings.** A live audit found `anon` and `authenticated` both
holding effective TRUNCATE/TRIGGER/REFERENCES privileges on `profiles` and `question_answers` — RLS
does not make TRUNCATE safe; it has no jurisdiction over a table-level operation like that at all. All
three were revoked for both roles on both tables (traced first — nothing in this codebase depends on
any of them), and `anon` had every remaining privilege on both tables revoked outright (no anonymous
code path, including external Dispatch sharing, ever needs them). These privileges almost certainly
trace back to Supabase's own project-level default-privilege bootstrapping, not this codebase's own
migrations — meaning every future `create table` inherits the same broad grant unless the project's
default privileges are changed, a separate, cross-cutting decision **deliberately not made here**
(flagged for explicit future review). Every new table in this migration got its own explicit
revoke/grant pass regardless, so this migration is correct independent of that future decision. Every
new RLS policy carries an explicit `to <role>` clause — never left to default to PUBLIC, the exact bug
class already found and fixed twice this engagement (`dispatch_photos_insert`/`select`, then
`letter_photos_select`).

**Staff-role and audit-log foundation, not moderation itself.** `staff_roles` (`user_id` → `moderator` |
`admin`, self-select-only RLS, zero client write path — the first role is granted by a direct database
action, never a client self-grant) and `admin_audit_log` (append-only, zero policies and zero
client-facing grants at all — not even staff can read it through PostgREST yet) both exist now purely as
the authorization/audit foundation later moderation RPCs depend on, per the checkpoint's own instruction
that those RPCs "must not rely on hard-coded emails or client flags." No moderation action, report, case,
or admin RPC is built in this checkpoint — `admin_audit_log` receives its first row only once a real
privileged action exists to write one; `is_staff(p_min_role)` is the authoritative check every future
privileged RPC calls first.

**Pre-execution audit (2026-09-11) — one real gap found and fixed before running anything.**
`get_post_closure_recommendations` (traced directly to `docs/sql/2026-08-30-letters.sql:680-820`) is
`SECURITY DEFINER` and joins `question_answers`/`profiles` directly — it bypasses both the block-aware
`question_answers` RLS policy and `public_profiles` entirely, since a definer function runs as its owner,
not the calling role. Without a fix, a blocked pair could still be recommended to each other after a
closed first-contact letter. Fixed with the same one-line addition pattern as everywhere else in this
migration — reproduced verbatim otherwise, same `RETURNS TABLE` shape (the exact `get_shared_dispatch`
failure class explicitly checked for and ruled out). Also: `tempa_private.is_blocked_pair` was reordered
to be defined strictly after `blocked_users` (previously defined first, relying on a very likely but
not certainty-verified property of `language sql` function creation in Postgres) — a zero-cost reorder
that removes the question entirely rather than resting on a claim that couldn't be independently proven
in this environment. `pin_dispatch`'s existing gating was confirmed to already exactly match the locked
product decision (unpin always available; pin and re-pin are the same RPC, both correctly blocked
together) — no change needed there, only confirmation. Every new table's explicit `revoke all` pass was
re-confirmed sufficient to neutralize Supabase's broad default table privileges independent of the
project-wide default-privilege decision this migration still deliberately does not touch. The
verification script gained a single aggregated PASS/FAIL summary row covering all of the above, with the
original detailed diagnostic queries retained beneath it.

**Reported private media — future lock, recorded now.** Not built this checkpoint (reporting doesn't
exist yet), but recorded so the eventual design isn't foreclosed: moderator access to a reported photo
Moment must be tied to a specific report/evidence record, server-authorized, short-lived, and audit-
logged — never a standing "browse any image in report_evidence" storage policy. The future shape:
`get_report_evidence(report_id)` audits the access first, then a narrow storage policy scoped
specifically to paths referenced by an evidence record (never the whole bucket) authorizes a short-
lived signed URL.

**One-Operator Principle — the Control Room is required before public launch, not deferred.**
Correction from the Checkpoint 1A sequencing: a minimal moderator Control Room is required before
public launch even with a single administrator — not something to defer merely because there is no
second moderator yet. Routine moderation work must be organized by the system (cases group related
reports; a computed priority bucket, not raw report volume, drives review order) rather than dumped on
the operator as a raw list. Automation may deduplicate, group, prioritize, and summarize — it may never
autonomously impose consequential enforcement; every state-changing action remains a deliberate,
individually-authenticated human decision.

**Files added:** `lib/blocking.ts`, `lib/blocking.test.ts`, `app/block-button.tsx`,
`app/block-button.test.tsx`, `app/you/safety/blocked-minds/page.tsx`,
`app/you/safety/blocked-minds/unblock-button.tsx`. **Files changed:** `lib/dispatches.ts` (`keepMind`/
`unkeepMind` now call RPCs), `lib/__tests__/fakeDispatches.ts` (block/keep-cascade/get_blocked_profiles
support), `lib/dispatches.test.ts` (new coverage), `app/minds/[userId]/page.tsx` (BlockButton),
`app/letters/[letterId]/letter-action-menu.tsx` + `page.tsx` (BlockButton, wired with the other
participant's id/pseudonym), `app/you/page.tsx` (Blocked minds link).

**Tests added:** block/unblock RPC wrapper behavior and reporter-side privacy (`lib/blocking.test.ts`);
Keep RPC conversion, block cascade in both directions, unblock-does-not-restore, self-block rejection,
Dispatch-visibility exclusion mirroring the documented RLS contract (`lib/dispatches.test.ts`);
BlockButton's default shape and locked copy (`app/block-button.test.tsx`). **Explicitly NOT verifiable
by this harness**: the actual live Postgres RLS/RPC/privilege behavior — that requires the migration to
be executed and exercised for real, per the migration's own read-only verification script and a live
adversarial test pass, never mocks standing in for a real database.

## 20.G — SAFETY & TRUST: TWO LEVELS OF BLOCKING + BOARD IDENTITY-LINK REGRESSION + PUBLISH_DISPATCH FIX (Checkpoint 1C, 2026-09-12)

**Status: SQL prepared, NOT executed.** `docs/sql/2026-09-12-scoped-blocking-and-fixes.sql` +
`-verify.sql` are complete and ready for review but have not been run against the live database. This
is an INCREMENTAL migration against the current live state: the Checkpoint 1B foundation, its
pre-execution privilege correction, and a manual live hotfix to `publish_dispatch` are all already
applied — this migration does not re-create or assume otherwise.

**Why:** live testing after the 1B migration surfaced three separate findings that this checkpoint
addresses together: (1) a single "Block" action is too coarse — a member may want to stop private
correspondence with someone without losing all public visibility of them, or vice versa is not
offered at all; (2) The Board's author pseudonym was not clickable on any listing card, contradicting
the locked rule that a member's identity label must always link to their profile; (3) `publish_dispatch`
failed live because its INSERT omitted `status`/`published_at`, violating
`dispatches_published_at_required` (repaired by hand in the live database at the time).

**Two levels of blocking.** `blocked_users` gains `scope text not null default 'full' check (scope in
('letters', 'full'))` — existing rows default to `full` (a metadata-only `ALTER TABLE ... ADD COLUMN
... DEFAULT`, no rewrite). No second table: the same directional row now carries which of two mutual
effects applies.
- **"Stop letters" (`scope = 'letters'`)** — neither party may start or continue private
  correspondence. Everything public (profiles, Question answers, Minds/discovery, Dispatches/Board,
  Keep) is completely unaffected. No notification to the other party. Historical and in-transit
  letters are untouched.
- **"Block everywhere" (`scope = 'full'`)** — unchanged from Checkpoint 1B: mutual app-wide public
  invisibility, no new correspondence, Keep removed in both directions atomically. Unblock never
  restores a removed Keep.

`block_user(p_blocked_id, p_scope default 'full')` is idempotent and atomically upgrades/downgrades in
place on conflict (`on conflict (blocker_id, blocked_id) do update set scope = excluded.scope`) — there
is no separate upgrade RPC, and a downgrade from `full` to `letters` never restores Keep. `unblock_user`
is unchanged. `get_blocked_profiles()` was replaced via `drop function if exists` + fresh
`create function` (not `create or replace`, to avoid the `RETURNS TABLE` column-list ambiguity the
`get_shared_dispatch` incident earlier this engagement already flagged as risky) to add a `scope`
column, with `revoke`/`grant execute` reissued explicitly.

**Two internal helpers, one meaning each.** `tempa_private.is_blocked_pair(a, b)` is redefined to mean
FULL block only, either direction — every surface that used it under Checkpoint 1B keeps working
unchanged, now correctly scoped to full blocks alone. A NEW `tempa_private.is_correspondence_blocked_pair
(a, b)` means ANY active block (letters or full), either direction. Both remain in `tempa_private`,
never exposed to PostgREST, with no grants to any client-facing role.

**Locked surface assignment:**
- **FULL BLOCK ONLY** (`is_blocked_pair`): `public_profiles` visibility, Minds/discovery, Question-
  answer cross-user discovery, Board/Dispatch visibility and search, profile Dispatch shelves, pinned
  Dispatch, authenticated Dispatch Moment visibility (`can_view_letter_photo`/
  `dispatch_photo_is_visible` deliberately stayed on this helper — viewing already-existing content is
  reasoned as not "new interaction" — **flagged as a judgment call needing explicit confirmation**,
  since neither locked list named letter/Dispatch-photo viewing specifically), Keep in Mind
  authorization.
- **ANY BLOCK** (`is_correspondence_blocked_pair`): `send_first_letter`, `reply_to_letter`,
  `write_letter`, `request_photo_sharing`, `respond_photo_sharing`'s `enable` branch — every RPC that
  creates a NEW private-correspondence interaction. Historical letters are never hidden by a
  letters-only block. External anonymous `/d/[shareToken]` is unaffected either way — it has no account
  identity to check a block against, a structural limitation that remains.

**Board author-identity regression, fixed.** Live testing disproved the earlier (Checkpoint 1B-era)
assumption that Board author-identity navigation already worked — the pseudonym on every Board/Home
listing card was inert text; reaching a member's profile from a card required opening the Dispatch
first. Fixed with one shared component, `app/board/dispatch-author-link.tsx` (Mindform + pseudonym +
flag, linking to `/minds/[authorId]`), reused by both `DispatchCard` (Board, profile shelves, Board
search — all share the same list/component) and `BoardShelfCard` (Home). `BoardShelfCard` required a
markup restructure — it used to be ONE enclosing `<Link>` to `/board/[id]`, which made a second nested
`<a>` for the identity link invalid HTML; it is now a plain non-interactive outer `<div>` containing two
SIBLING Links (identity → `/minds/[authorId]`, content → `/board/[id]`), mirroring the pattern
`DispatchCard` already used correctly for unrelated Keep-button layout reasons. The Dispatch reader page
(`app/board/[dispatchId]/page.tsx`) already linked the author correctly and needed no change.

**`publish_dispatch` canonical fix.** The live-tested INSERT now explicitly lists all five columns:
`insert into public.dispatches (author_id, title, body, status, published_at) values (auth.uid(),
p_title, p_body, 'published', now())` — the app has no draft state, so every Dispatch this version
creates is published immediately, and these two values must never again be left to an implicit column
default for a constraint this load-bearing. The account-status enforcement check added by the 1B
migration is preserved unchanged. `dispatches_published_at_required` itself is untouched (not weakened,
not dropped) — only located via manual confirmation, since it isn't named in any tracked migration file
this repository holds; the verification script's own check for it reports "confirm manually" rather than
asserting existence for that reason.

**Files added:** `docs/sql/2026-09-12-scoped-blocking-and-fixes.sql` + `-verify.sql`,
`app/board/dispatch-author-link.tsx` + `.test.tsx`, `lib/__tests__/publishDispatchMigration.test.ts`.
**Files changed:** `lib/blocking.ts` (scope-aware types/functions, new `getBlockScope`),
`lib/__tests__/fakeDispatches.ts` (scope-aware `is_blocked_pair`/new `is_correspondence_blocked_pair`
simulation, scope-aware `block_user`/`get_blocked_profiles`, `blocked_users` `.eq().maybeSingle()`
support, Moments recorded on `publish_dispatch`), `lib/blocking.test.ts` + `lib/dispatches.test.ts` (new
scope coverage), `app/block-button.tsx` (+ `.test.tsx`) (two-option choice UI with the exact locked
copy, scoped states), `app/minds/[userId]/page.tsx` + `app/letters/[letterId]/page.tsx` +
`letter-action-menu.tsx` (thread `initialScope`/`initialBlockScope` through to BlockButton),
`app/board/dispatch-card.tsx` + `app/home/board-shelf-card.tsx` (+ both `.test.tsx`) (shared
identity-link component, sibling-Links restructure for BoardShelfCard),
`app/you/safety/blocked-minds/page.tsx` + `unblock-button.tsx` (scope display, in-place upgrade
action).

**Tests added:** scope-aware `block_user` (create letters/full, idempotent upgrade/downgrade in place,
`getBlockScope`/`getBlockedUsers`/`getBlockedProfiles` all report scope) in `lib/blocking.test.ts`;
letters-only block leaves Dispatch visibility and Keep untouched, full block still removes both,
upgrade removes Keep at the moment of upgrade, downgrade never restores Keep, unblock works for either
scope, in `lib/dispatches.test.ts`; a publish with topics AND a Moment together succeeds atomically
with a non-null `publishedAt`; Board/Home author-pseudonym-links-to-profile plus no-invalid-nested-
anchor regression tests in both card test files; BlockButton's scoped states and exact locked copy in
`app/block-button.test.tsx`; a source-text regression test (`publishDispatchMigration.test.ts`) proving
the tracked migration's `publish_dispatch` explicitly sets `status`/`published_at` and never weakens
`dispatches_published_at_required`. **Explicitly NOT verifiable by this harness:** the actual live
Postgres RLS/RPC/privilege behavior for any of the above — that requires the migration to be executed
and exercised for real.

## 20.B — REJECTED DIRECTIONS (explicitly considered and decided against)

- "Open Letters" as product-facing terminology (superseded by Dispatch/The Board);
- "Unsealed" as terminology (considered, rejected);
- swipe-based public-writing navigation / fluid horizontal movement between Dispatches (the original
  Open Letters presentation direction — explicitly superseded; The Board and the reader are both
  plain vertical/tap navigation only);
- Reels/Stories-style consumption of any kind;
- title-less public writing (Dispatches require a title; only private letters and Question answers
  stay title-less);
- video in this release (still-image Moments only; no upload, no playback, no schema fields "for
  later");
- Postcards inside Dispatches (Postcards remain private-correspondence-only, permanently in this
  version — not merely deferred);
- eye, heart, or bell as the Keep-in-Mind icon (a bookmark ribbon was chosen instead);
- a manual bookmark feature (reading position is fully automatic; no Save Bookmark button exists);
- a hashtag ecosystem (topics are plain metadata — no tag pages, tag following, or trending topics);
- popularity/engagement-based sorting anywhere (Board ordering is a fixed, viewer-aware but never
  popularity-aware, three-tier rule);
- public follow/Keep/view counts of any kind (all three are private per-viewer state, enforced by RLS,
  not merely by app convention);
- automatic face detection for the redaction tool (see §20.E) — manual placement only, no AI subject
  detection of any kind.

## 20.C — NOTES, LARGER RANKING, AND OTHER STILL-FUTURE DIRECTION

The following remain recorded future direction, gated on real cohort evidence per §24, not rejected:

- **Notes** (working term, not Comments) — short text-only responses beneath a Dispatch; Unicode
  emoji permitted, no images/Moments/GIFs/voice/attachments, no like/reaction system. Exact limit
  remains unlocked (~300–500 territory).
- **Dispatch → private correspondence** — a reader may leave a Note (once built), Keep the writer in
  mind, open their profile, or choose "Write to this mind" through the normal first-contact mechanism.
  Public interaction never auto-establishes correspondence — this principle is already fully honored
  by the current implementation (Keep alone never does).
- Larger ranking/diversity refinements beyond the fixed three-tier order and author-diversity
  interleave already implemented.
- Richer profile/preservation surfaces (§26/§29).

Do not implement Notes before the private correspondence loop has been tested with a small real
cohort, per the original Open Letters caution — that caution still applies to Notes specifically, even
though the base Dispatch/Board vertical slice itself was deliberately pulled forward ahead of that
milestone by explicit product decision (see 20.A's opening note).

## 20.D — POSTCARDS: PRESERVE, DO NOT REDESIGN

Existing Postcard behavior — catalog picker, Featured/My Postcards/Places/Collections sections, catalog
postcard attaching correctly to a private letter — was re-confirmed correct and NOT modified in this
checkpoint. The one real defect found (the entry point had been lost from the current composer,
see 20.A) was fixed with the minimum necessary change. Postcards remain private-letter objects
permanently; they must never be exposed on The Board. The premium Postcard catalog redesign
(presentation, collectibility, scarcity, packaging) remains a future, separate, dedicated checkpoint —
recorded here and in §22, not built now.

## 20.E — REDACTION TOOL — SPEC LOCKED, IMPLEMENTATION DEFERRED

Canonical future requirement, recorded but NOT built (not nearly complete, so per instruction it stays
deferred): a shared manual Moment redaction tool for private letters + Dispatches. Rules — manual
placement only, no face detection, no AI subject detection of any kind; a vector overlay while
editing, resizable and repositionable; a default smiley option plus one additional plain solid shape,
possibly a third restrained option at most; flattened permanently into the final raster image before
upload, with the underlying pixels genuinely removed from the exported result (never a client-side-
only overlay a screenshot could bypass); useful for faces, addresses, plates, and any identifying
detail; one shared component across every photo-Moment surface (private letters and Dispatches alike).
This explicitly overrides and removes any earlier Build Guide direction that proposed automatic face
detection — none exists anywhere in this codebase, and none should be built.

## 20.F — BOARD USABILITY / AUTHOR CONTROL — 2026-09-09, SQL NOT YET APPLIED

A focused usability pass on the already-live Dispatches/Board/sharing foundation — not a redesign, not
a new architecture. Application changes are live now; the schema changes below are prepared but NOT
executed (`docs/sql/2026-09-09-board-usability.sql` / `-verify.sql`).

**Home presentation.** The narrow 2-per-row grid tile is gone. `app/home/board-shelf-card.tsx` (same
file/component, rewritten in place — no duplicate component created) is now a WIDE horizontal card;
`app/home/page.tsx` stacks up to 3 of them vertically (`space-y-3`), never a carousel — no swipe, no
drag, no arrows, no auto-advance. `lib/dispatches.ts`'s `getHomeBoardDispatches(supabase, viewerId)`
replaces the old viewer-blind `getRecentDispatchesForShelf`: it draws the same pool `getPublishedDispatches`
would and runs it through the Board's own `sortBoardDispatches` (unseen-kept, then unseen-others, then
previously seen), sliced to 3. Opening a Dispatch marks it seen through the existing `dispatch_views`
state (no new Home-only "dismissed" table), so the next Home fetch naturally surfaces a different unseen
one — no code needed for "rotation" beyond reusing the existing viewed-state architecture correctly.

**Keep wording.** The unselected label is now `Keep <pseudonym>` (e.g. "Keep Evening Quill"), never a
bare "Keep" that could be misread as saving the Dispatch itself. Selected label, the locked "Keep in
Mind" concept name, and the bookmark-ribbon icon are all unchanged. `KeepButton` takes a new required
`keptPseudonym` prop; both call sites (`app/board/page.tsx`, `app/board/[dispatchId]/page.tsx`) pass it.

**Sharing — broadened to any authenticated member.** Previously author-only; now any authenticated
member reading a published Dispatch may generate/reuse its external share link. `share_dispatch`'s SQL
body drops its `author_id = auth.uid()` check (published-only remains); `revoke_dispatch_share` is
UNCHANGED — revoking remains author-only. `ShareDispatchButton` (`app/board/share-dispatch-button.tsx`)
was simplified to match: it no longer takes `initialShareToken`/tracks a "currently shared" state at all
(that persistent knowledge, and the ability to revoke, moved to the author-only menu below) — it is now
a stateless action: tap → `share_dispatch` → native share sheet or copy-link. No per-sharer attribution,
no share counts, anywhere.

**Author controls — one restrained menu, not four buttons.** `app/board/[dispatchId]/author-actions-menu.tsx`
(new) — a single icon-only trigger opening a bottom sheet (the same grammar as the composer's own
photo-source picker, deliberately reused rather than inventing a dropdown/click-outside pattern):
Edit Dispatch, Stop sharing externally (shown only when a share is currently live), Pin to profile /
Unpin from profile, and Delete Dispatch with an inline confirm swap (the same established pattern as
`app/letters/remove-from-letterbox.tsx` — never a native `window.confirm`). Rendered only for the
Dispatch's own author; Share now renders for everyone, Keep only for a non-author viewer.

**Author identity navigation.** Already correct before this checkpoint (confirmed by inspection, no
change needed): the writer's Mindform + pseudonym in the authenticated reader has always been one
`<Link>` to their public Mind profile, for both the author viewing their own Dispatch and any other
member. The external, signed-out `/d/[shareToken]` reader's identity block remains deliberately
non-clickable — also unchanged, confirmed by its own existing test.

**Edit** (`update_dispatch`, author-scoped `SECURITY DEFINER` RPC, same validation as `publish_dispatch`)
preserves the Dispatch's id, `published_at`, and `status`, wholesale-replaces topics/Moments, and never
touches `dispatch_shares` — an active external link keeps working and reflects the edited content on
its next read. `/board/[dispatchId]/edit` reuses `DispatchComposer` in `mode="edit"` rather than a
second composer. Reloading existing writing into the editor uses a NEW `dispatchBodyToDoc` (`lib/
letter-editor-doc.ts`) — deliberately a thin wrapper around the ALREADY-EXISTING `markupBodyToLetterDoc`
(previously used only for restoring the first-contact-reply draft) for all text/mark/hardBreak
reconstruction, adding only still-image-Moment reattachment on top. (First implementation pass wrote a
second, ~65-line reimplementation of that same decoding logic before this reuse opportunity was found
during self-review; corrected before landing — recorded here as the kind of duplication this codebase's
own conventions exist to prevent.) A failed edit leaves the existing row completely untouched (the RPC
validates before writing anything).

**Delete** (`delete_dispatch`, author-scoped `SECURITY DEFINER` RPC) removes the Dispatch; existing FK
cascades (topics, Moments metadata, views, share row) clean up automatically, and a nullable
`pinned_dispatch_id` FK (`ON DELETE SET NULL`) means a deleted-while-pinned Dispatch un-pins itself with
no extra code. Storage cleanup is real, not assumed: a new narrow `dispatch_photos_delete` storage
policy (scoped exactly like the existing INSERT policy — an author's own folder only) lets
`author-actions-menu.tsx` remove that Dispatch's own image objects after the RPC succeeds, using paths
captured by the reader page BEFORE deletion (the `dispatch_moments` rows naming them are gone the
instant the RPC returns). **Known, explicitly recorded gap**: editing away a Moment (not deleting the
whole Dispatch) does not clean up that image's storage object — only full deletion does. Confirmation
uses the same inline-swap pattern as `RemoveFromLetterbox`, never `window.confirm`.

**Pin to profile** — at most one per member, via a single nullable `profiles.pinned_dispatch_id` column
(not a relationship table; "at most one" is trivial by construction) plus `pin_dispatch`/`unpin_dispatch`
(author-scoped `SECURITY DEFINER` RPCs — chosen over exposing raw column UPDATE precisely so ownership/
published-status validation stays centralized and this never needs to know or touch `profiles`' own,
largely untracked-in-this-repo RLS state). Pinning a different Dispatch is a single UPDATE, so it
atomically replaces whatever was pinned before. No pin count anywhere; never a Board ranking signal —
the pin affects only that author's own public profile.

**Public profile hierarchy**, now: Question answers (unchanged, still foundational) → Pinned Dispatch
(shown only if one exists) → up to 3 recent Dispatches, newest first, excluding the pinned one so it's
never shown twice → "See all Dispatches" (new `/minds/[userId]/dispatches` route, reusing `DispatchCard`,
newest-first, no ranking). No follower/Keep/view/share counts anywhere on the profile, matching the
existing rule.

**Private letters.** Untouched by this entire checkpoint. The existing regression guards
(`lib/__tests__/privateLettersNoSharing.test.ts`'s source scan of `app/letters`/`app/write`, and
`letter-body.test.tsx`'s rendering-level guard) were re-run and remain green.

**Visual rule — locked (2026-09-09 follow-up): Dispatches read/write on the same TEMPA paper as private
letters.** The private-letter reader's darker inner writing surface is `bg-surface-shell`
(`app/globals.css`: `color-mix(in srgb, var(--background) 90%, var(--foreground) 6%)`), applied by
`letter-body.tsx` around its paragraphs. Every Dispatch writing surface reuses this EXACT same class —
never a new/invented colour, never a duplicated definition:

-   `app/board/[dispatchId]/page.tsx` — already correct since the original foundation checkpoint: only
    the `<DispatchReader>` wrapper carries `bg-surface-shell`; identity, title, topics, Keep, Share, and
    the author-actions menu all stay on the ordinary page background.
-   `app/d/[shareToken]/shared-dispatch-view.tsx` — **fixed this pass**: the external reader had no
    paper wrapper around `<DispatchBody>` at all. Now wrapped identically to the authenticated reader,
    so both readers feel like the same surface; the TEMPA mark, identity, title, topics, and Join CTA
    remain on the page background.
-   `app/board/dispatch-composer.tsx` — **fixed this pass**: the editor's own surface was
    `bg-transparent`. Now `bg-surface-shell`, so writing a Dispatch (create or edit) already feels like
    the paper it will be read on. The private-letter composer (`moments-composer.tsx`) deliberately keeps
    `bg-transparent` — this rule applies to Dispatches only and must never be back-ported onto private
    correspondence without a separate, explicit decision.

**Do not** flatten this distinction in a future visual pass: the surrounding Dispatch page/composer
chrome must stay on the light background; only the actual written piece — reading or composing — sits
on `bg-surface-shell`. Test coverage: `shared-dispatch-view.test.tsx` asserts exactly one
`bg-surface-shell` occurrence, wrapping the body only. The composer's own editor surface is not unit-
testable this way — `EditorContent` mounts nothing until the client-side editor instance exists
(`immediatelyRender: false`), so `editorProps.attributes.class` never appears in SSR output. Verified
instead by direct code inspection (the class string is static, and the same `bg-surface-shell` utility
is already proven live elsewhere on the authenticated Dispatch reader) rather than a live authenticated
browser session, which this pass did not have access to — an authenticated live-test pass should still
confirm it visually before this is treated as fully closed.

**Rule expanded (2026-09-09, second follow-up) — every surface showing a member's actual writing, not
just Dispatches.** The rule above generalizes: any surface displaying words a member actually wrote uses
`bg-surface-shell` around exactly that writing — never the surrounding identity/date/topics/buttons,
never a whole page, never a second colour token for the same purpose. An inspection pass across every
`FormattedText`/raw-body render site in the app found these ALREADY correct (no change needed):
`letter-body.tsx` (private letter reader), `profile-answer.tsx` and `discovery-results.tsx` and
`question-workspace.tsx`'s `AnsweredQuestionRow` (Question answers), and the Dispatch readers already
covered above. Genuine gaps found and fixed:

-   `app/question/question-answer.tsx` — the single-answer page's own **view mode** rendered the
    published answer directly on the page background; every other place the same answer appears
    (profile, Minds/Explore, the "My answers" list) already used the paper surface. Now wrapped to match.
-   `app/board/dispatch-card.tsx` (Board listing, profile's Dispatches section, "See all Dispatches") and
    `app/home/board-shelf-card.tsx` (Home previews) — excerpts previously sat directly on the card
    background.
-   `app/home/page.tsx` — the Arrivals single-letter-waiting excerpt.
-   `app/letters/with/[userId]/archive-list.tsx` and `app/letters/people-grid.tsx` — Letterbox's own
    compact letter-excerpt cards.

**Board post separation (2026-09-09).** `DispatchCard` is now its own bordered, rounded card (`border
border-foreground/10`, generous padding) rather than a flush row separated only by a `divide-y` hairline
— every caller (`app/board/page.tsx`, the profile's Dispatches section, "See all Dispatches") stacks
these with plain `space-y-4`, never `divide-y`, so cards read as distinct pieces of writing rather than
a continuous feed. Restrained on purpose: no shadow, no gradient, no gloss — spacing + a subtle border +
the existing paper surface around the excerpt is the entire treatment. `BoardShelfCard` on Home already
had this separation (its own bordered card, stacked with `space-y-3`) from the original wide-card pass —
confirmed unchanged, not a gap.

**Compact country flag (2026-09-09).** "Pseudonym [flag] · Date" beside Board/Dispatch identity —
Board listing, Home previews, and the full authenticated Dispatch reader. Reuses existing data/utilities
entirely, adding nothing new to the schema: `public_profiles.country` (already live, already shown as
plain text elsewhere — Recommended Minds, the public profile's demographics line) and
`findCountryIsoCode` (`app/profile/data.ts`, pre-existing, built on the already-installed
`country-state-city` package) for the name→ISO lookup. The one narrowly-scoped read change:
`lib/dispatches.ts`'s `attachTopicsAndAuthors` now also selects `public_profiles.country` and exposes it
as `DispatchListItem.authorCountry`. The flag itself (`app/country-flag.tsx`) is a pure Unicode Regional-
Indicator composition (`isoCodeToFlagEmoji`) — no image asset, no new package. Fails gracefully to
nothing (no reserved space, no placeholder) when `country` is null or doesn't resolve to a known ISO
code. Disclosure reuses the existing `Tooltip` primitive (`app/profile/tooltip.tsx`, already used by
every other icon-only control) rather than a bare HTML `title` — hover/focus on desktop, tap-toggle on
mobile, dismiss on outside click. The flag's own `aria-label` ("Country: France") carries the full name
unconditionally, independent of whether the visual tooltip is open, which is what actually satisfies the
accessible-name requirement. `Tooltip` itself gained two small, backward-compatible fixes needed for
this: `preventDefault()` in its toggle handler (so a flag nested inside an identity `<Link>` — Board/
Home cards, the Dispatch reader's own author link — doesn't also trigger navigation; harmless for every
existing plain-`<button>` caller) and Escape-to-dismiss. The external, signed-out `/d/[shareToken]`
reader deliberately does NOT get a flag: `get_shared_dispatch` never returns the author's user id or any
extra identity field to an anonymous caller by design, and adding one would mean changing that already-
live, already-verified RPC's contract — out of scope for a visual-only pass. Never exposes city, region,
coordinates, or anything auth-provider-derived — country name only, exactly what was already public.

------------------------------------------------------------------------
# 21. MAIL CALL / PAPER TIME — CORE LIVE, RETURN LOOP INCOMPLETE

Delayed delivery is now structurally live.

### Current live rules

-   `deliver_at` uses server time.
-   Letter 1 (first contact) arrives immediately.
-   Letter 2 and later letters use geography-based delay.
-   Body is inaccessible to recipient before delivery across the protected read/search/action boundaries.
-   Sender retains immediate access to their own outgoing letter.
-   Same-direction sends are clamped to preserve order.
-   `Mail on the way` exposes existence only, not hidden content or exact arrival time.
-   Viewer-local rendering occurs after arrival.
-   No countdown.

Authenticated test: Lvis (United States) → Evening Quill (South Africa) Letter 1 arrived immediately;
Evening Quill's Letter 2 was scheduled roughly 23h later, consistent with the intercontinental band.
The discovered `country_code` persistence gap was fixed for future profiles and Lvis was repaired to `US`.

### Remaining delivery work

-   email/Resend arrival notification and return links;
-   final visual treatment matching the approved postal mockup;
-   broader real-device / multi-region cohort testing.

Do not let TEMPA become instant messaging merely because the correspondence UI works.

------------------------------------------------------------------------

# 22. MONETIZATION

> **Monetize preservation, not access to humans.**

Promising directions: - printed correspondence; - physical postcards; -
keepsakes; - premium paper/presentation; - tasteful regional themes; -
later gift experiences.

Do not sell boosts, visibility or access to strangers.

Validate printing with a fake door/waitlist before building fulfillment.

Long-term physical-mail sequence: 1. prove digital correspondence; 2.
validate preservation demand; 3. postcard pilot; 4. solve address
privacy/consent; 5. physical letters; 6. cautious country expansion.

Never promise digital images are impossible to copy; screenshots cannot
be prevented.

Printing constraint, decided: a member may only print the specific
image already sent to them inside a letter --- never an arbitrary
upload; enforce by tying the print action to that Moment's image ID in
the database. Postcard/gift-shop currency should stay inside the
postal metaphor (a working name like "Post" or "Fare" rather than
generic "coins") --- not locked, recorded for whenever a shop is
designed. Physical letters (not just postcard-style prints) are a
distinctly later step than postcard printing --- real mailing-address
collection is a materially bigger privacy/consent step than anything
else in the product; sequence it after postcard fulfillment has
proven the operational model, starting with one or two pilot
countries.

------------------------------------------------------------------------

# 23. DELIBERATELY DEFERRED

Not now: - voice notes; - calls; - dating
mechanics; - swipe discovery; - followers; - likes/public counts; -
streaks; - crypto; - large physical gift marketplace; - Tempa Kids; -
full international physical-mail fulfillment; - runtime AI-generated
Mindforms; - complex popularity algorithms.

------------------------------------------------------------------------

# 24. BUILD ORDER FROM HERE — RECONCILED 5 SEPTEMBER 2026

Work in tested checkpoints, but finish the product in deliberate passes rather than endlessly polishing
one screen.

## A — Home consolidation **IMPLEMENTED 2026-09-05 — PENDING LIVE-TEST CONFIRMATION**

-   Home hierarchy established: Arrivals → Mail on the way → small discovery invitation → quiet Question reminder (§15);
-   hidden-correspondence activity leaking back into Home — fixed, no SQL required or written (§7, §9, §15);
-   discovery → public-profile navigation — audited, already correct, no change needed;
-   mobile + desktop structure — audited, no fixed-width overflow found in any touched file; narrow centered column preserved at both sizes, no dashboard grid introduced;
-   Open Letters compatibility preserved without building a feed, placeholder, or fake data.

`tsc`/Vitest/ESLint all pass (see §25). **Do not begin §24-B until Home has actually been exercised
with a real authenticated session** — nothing above has been confirmed against live data yet.

## B — Writing/composer essentials **IMPLEMENTED 2026-09-05 — PENDING LIVE-TEST CONFIRMATION**

-   double-click/multi-word selection fix — DecorationSet memoization in the Moment affordance
    plugin, unit-tested; needs a live browser to confirm the actual browser symptom is gone (§16);
-   Bold + Italic — shared Tiptap schema, no schema/SQL change (§16);
-   restrained Unicode emoji picker — shared component, used by every letter composer and the
    Question editor (§16);
-   cursor/draft integrity — preserved; an existing plain-text first-contact-reply draft still loads
    correctly under the new editor (§16);
-   consistent writing surfaces — first contact, the first-contact reply, and Write Anytime now share
    one editor technology and one toolbar; the Question editor stays intentionally plain-text (§16).

See §16 for the full architecture, storage-format, and paste-policy detail. `tsc`/Vitest/ESLint all
pass. **Do not begin §24-C until this has actually been exercised with a real authenticated session.**

## C — Moments/composer real-device pass

-   paragraph insertion;
-   Photo/library/camera;
-   Postcards;
-   autosave;
-   mobile full-screen reply;
-   View last letter / Return to draft;
-   HEIC/large/orientation cases;
-   tutorial visuals updated to the real inline grammar.

## D — Core visual-system pass

Use the approved Letterbox mockup as a **target**, not loose inspiration. Apply the warm paper system,
editorial hierarchy, restrained natural accent, terracotta system-notice family, soft paper cards, responsive
desktop/mobile composition and clear human-vs-system voice across Auth, Home, Minds, profile, Letterbox, reader,
composer, Questions and You. This is where Home's and Letterbox's `SystemMessage` instances actually gain the
terracotta/peach treatment — not before. Resolve the §31 personal identity direction before final avatar/Mark
production.

## E — Safety/account fundamentals

-   Block;
-   Report + moderation queue;
-   rate limits;
-   scam/off-platform-money warnings;
-   account deletion/export semantics;
-   image moderation;
-   minimum admin safety console + privileged-content access audit log;
-   later network-location mismatch caution.

## F — Notification + return loop

-   Resend email on meaningful arrival;
-   correct deep links;
-   restrained notification copy;
-   PWA installability after core loop is stable.

## G — Small real-user cohort

Recruit a deliberately small external cohort and measure: answer/discovery → first letter → reply → third letter →
later return → correspondence survival. Do not hide weak retention by adding more features.

## H — Differentiation expansion, only after cohort evidence

-   ~~Open Letters~~ — superseded by the canonical "Dispatches and The Board" specification;
    the first vertical slice (Dispatch/Board/Keep-in-Mind/viewed-resume-state) was pulled forward and
    implemented 2026-09-06/07 by explicit, dated product decision, ahead of cohort evidence (see
    §20.A); swipe-based reading was explicitly rejected outright, not merely deferred (§20.B); Notes
    and larger ranking refinements remain here, still gated on cohort evidence (§20.C);
-   researched conversation-territory redesign;
-   larger Question library;
-   very short silent Video Moments;
-   richer profile/preservation surfaces;
-   printing/physical preservation validation.

------------------------------------------------------------------------

# 25. CURRENT PROGRESS — 5 SEPTEMBER 2026

### Substantially implemented

-   development/deployment pipeline;
-   Supabase + RLS foundations;
-   email auth + Google OAuth;
-   pseudonymous onboarding/canonical uniqueness;
-   standardized country + ISO `country_code`;
-   Questions, history/current answer and non-blocking participation;
-   Minds discovery, deterministic six-more and filters;
-   canonical public profile + identity entry-point routing;
-   first-contact state machine;
-   Letterbox All/New/Sent;
-   compact two-line letter previews;
-   viewer-local Remove from my Letterbox UI;
-   Mail Call first-contact-immediate + delayed ongoing delivery;
-   recipient delivery/privacy enforcement;
-   Mail-on-the-way transit existence indicator;
-   Moments qualification after establishing reply delivery;
-   dedicated reply composer + inline Moment architecture;
-   private photo architecture, Postcards and first-photo consent;
-   Minds/Moments tutorials;
-   durable guide completion;
-   shared SystemMessage semantic primitive (variants `quiet`/`notice`/`warning`, plus an `action` slot);
-   Home hierarchy — Arrivals → Mail on the way → discovery preview → non-blocking Question reminder;
-   Home hidden-correspondence exclusion (Arrivals + Mail-on-the-way), reusing the existing `correspondence_hidden_for_user` mechanism with no SQL/schema change;
-   focused automated regression suite (latest reported: 365 passing);
-   Letterbox archive: compact "Mail on the way" scoped to the open correspondent, compact icon-only Remove-from-Letterbox control, compact back navigation (implemented 2026-09-05, no SQL);
-   writing/composer essentials — Bold, Italic, restrained emoji picker, unified Tiptap schema across all three letter composers, double-click/selection DecorationSet fix, no schema/SQL change (implemented 2026-09-05, see §16);
-   established-correspondence send-eligibility/length-policy fixes (2026-09-05/06) — Tiptap reactivity fix applied to all three letter composers, stuck-`sending`-state robustness fix (try/finally) applied to all three submit handlers, the established-correspondence/Letter-2 product length cap removed entirely (canonical Question-answer cap reused for Letter 1 only), no schema/SQL change beyond the already-applied `letters_body_max_length` ceiling raise;
-   `write_letter`'s ambiguous-alias repair (`column reference "m" is ambiguous"`, same class of bug already fixed in `reply_to_letter`) — repair SQL prepared 2026-09-06, not yet confirmed executed (see the narrow-repair checkpoint transcript; this Guide does not track live SQL-execution status on its own — confirm against the database before treating it as live);
-   ~~Open Letters~~ superseded 2026-09-07 by the canonical Dispatches/The Board specification —
    Dispatch create/publish/browse/read, title, topics, search, Keep in Mind, automatic viewed/resume
    state, a Home shelf, still-image Moments in Dispatches (own table/bucket, never the private-letter
    consent model), and a restored Postcard entry point in the Write Anytime composer, all reusing the
    existing letter-editor/Tiptap architecture with no second formatting system; SQL prepared, NOT
    executed (see §20.A).

### Confirmed in authenticated testing

-   first-contact Letter 1 immediate;
-   intercontinental Letter 2 delayed as scheduled;
-   hidden incoming body not visible before delivery;
-   Mail on the way appears on Home and Letterbox;
-   public-profile navigation from Recommended Mind;
-   Question prompt hidden behind info control on profile;
-   long profile answer uses Read more;
-   All/New/Sent filters exercised successfully;
-   long Letterbox body no longer intended to dominate card after clamp fix (final live visual retest recommended);
-   Minds/Moments tutorials remain completed;
-   **Moments end-to-end (2026-09-05 night live test) — reported successful**: composing/sending an
    established-correspondence letter, including a deliberately very long one, no longer sticks on a
    disabled Send button; the length-policy and Tiptap-reactivity fixes above are what that test
    exercised. Treat this as the live-test confirmation this Guide had been recording as outstanding
    for the writing/composer-essentials and Moments/composer work — it is no longer open.

Note: the Home consolidation work, the Letterbox archive compact-header pass, and writing/composer
essentials (hierarchy, hidden-correspondence fix, Bold/Italic/Emoji, the double-click fix) are NOT yet
on this confirmed-in-authenticated-testing list — each has only been verified via `tsc`/Vitest/ESLint
and static analysis so far. Do not treat any of them as authenticated-confirmed until they actually
have been.

### Incomplete / active

-   Home — authenticated live-test confirmation still needed (structurally implemented 2026-09-05, see §15/§24-A);
-   Writing/composer essentials — authenticated live-test confirmation still needed, including whether
    the double-click word-selection symptom is actually gone in a real browser (structurally
    implemented 2026-09-05, see §16/§24-B);
-   full visual-system implementation to match approved mockup, including the terracotta/peach system-notice finish and the custom TEMPA icon family;
-   interest collapse live discrepancy / future conversation-territory redesign;
-   mobile Question-info popup viewport positioning;
-   final real-device Moments pass/tutorial visuals;
-   email arrival notifications;
-   safety/account/admin layer;
-   final personal Mark vs Mindform identity decision;
-   PWA;
-   external beta cohort;
-   Dispatches and The Board — SQL not yet executed (`docs/sql/2026-09-07-dispatches-and-board.sql`);
    once applied, needs its own authenticated live-test pass (see §20.A's live-test procedure).

### Historical issue to retain until deliberately re-verified

The earlier sender/recipient-direction anomaly remains a historical correctness item. Recent work has not reproduced a
new systemic reversal, but do not silently delete the issue from history until the affected data / live writer invariants
have been deliberately re-verified.

------------------------------------------------------------------------

# 26. COMPLETION ESTIMATE

A single percentage hides the real situation. These remain judgment estimates, not engineering measurements.

### Core product mechanics: **~75–80%**

Most of the private correspondence loop now exists structurally, including Mail Call and consolidated Letterbox behavior.
Remaining work is increasingly Home/composer completeness, visual consistency, notifications, real-device testing and hardening.

### V0 ready for a small controlled cohort: **~70%**

The emotional loop is testable, but Home, writing polish, real-device Moments reliability, notification return paths and
a coherent visual pass still matter before deliberately inviting outsiders.

### Stranger-safe public product: **~45–50%**

Block/report, moderation, rate limits, deletion/export semantics, image safeguards, admin safety tooling and operational
hardening remain substantial.

------------------------------------------------------------------------

# 27. PRODUCT ASSESSMENT

## Are we on the right path?

**Yes --- because the features increasingly reinforce one coherent
proposition.**

-   Questions give people a reason to encounter a mind.
-   Minds makes thought the discovery object.
-   Pseudonyms delay superficial identity.
-   Letters create deliberate private interaction.
-   Moments let the physical world enter the story without becoming a
    gallery.
-   Photo consent makes intimacy progressive.
-   Delayed delivery can make the exchange structurally different from
    messaging.
-   Preservation offers monetization without corrupting discovery.

That coherence is Tempa's strongest asset.

## Biggest risks

### 1. Building the cathedral before proving demand

The next proof is not another feature:

> Do real people who are not helping build Tempa form correspondences
> and voluntarily return to write again?

Translation, Open Letters, Mindforms, printing and themes remain
hypotheses until that happens.

### 2. Reliability can destroy the emotional proposition

Wrong sender identity, lost drafts, trapped tutorials, inaccessible
letters or leaked photos are disproportionately damaging in a product
built on intimate writing.

**Correctness is part of the brand.**

### 3. Becoming a slower social network

Recommended Minds, Open Letters, avatars, emoji, media and profiles are
individually reasonable. Together they can pull Tempa toward
conventional social-product behavior.

Every feature should answer: \> Does this make correspondence deeper,
safer or more memorable --- or merely make the app busier?

### 4. Delayed delivery cannot remain theoretical

"Paper time" is one of the clearest differentiators. If everything
ultimately arrives instantly, the positioning becomes more aesthetic
than structural.

### 5. Safety must precede strangers

A warm product does not remove scam, harassment or identity risk; it may
increase trust. Safety cannot be a cosmetic post-launch patch.

------------------------------------------------------------------------

# 28. DO NOT DELAY FIRST COHORT FOR THESE

Record them, design for them cheaply, but do not hold beta for: -
translation; - face detection; - full Mindform creator; - Open
Letters; - printing; - gift shop; - video; - premium regional themes; -
elaborate recommendations.

------------------------------------------------------------------------

# 29. THE NEXT REAL PROOF

Tempa's next meaningful milestone is:

> **A small group of real people discover strangers through Minds,
> exchange several letters over multiple days, and return because they
> care whether another letter has arrived.**

Measure: - answer → first letter; - first letter → reply; - reply →
third letter; - third letter → later return; - correspondence survival
over days/weeks.

If people answer but rarely write, discovery works but correspondence
does not. If first letters rarely receive replies, matching/first
contact is weak. If two letters happen but nobody returns, ongoing
rhythm is weak. If people return without prompting, the core is working.

------------------------------------------------------------------------

# 30. WORKING DISCIPLINE

For each checkpoint: 1. State one observable problem. 2. Inspect the
real system. 3. Fix the smallest correct layer. 4. Add regression tests
where practical. 5. Run TypeScript/tests/lint. 6. Deploy. 7. Test with
authenticated accounts. 8. Do not close the issue until the original
failure scenario passes. 9. Then move on.

Fixture tests prove code paths. They do not overrule live evidence.

------------------------------------------------------------------------

# 31. IDENTITY MARKS --- UNRESOLVED CONFLICT WITH §14, FLAGGED NOT DECIDED

**This section exists specifically to flag a real conflict, not to
silently pick a winner.** §14 above (approved 2 September) describes
Mindforms as *composable creature/species characters* --- base,
hair/headwear, glasses, clothing, accessories, drawn from a designed
Tempa species. A later product conversation (after the 2 September
rebuild) independently worked through the same underlying problem ---
how to represent a member visually without a face --- and arrived at a
different concrete direction: a **non-figurative, deterministically
generated abstract mark**, explicitly NOT any of: ordinary human
avatars, animals, a fixed creature/species system, or another
platform's avatar system. That later conversation did not have §14 in
view when it ran, so the two directions were never reconciled against
each other. Do not build either one further as the final identity
system until this is deliberately resolved by comparing them
side-by-side.

### The later-conversation direction, for comparison

**Phase A (cheap, buildable now, zero legal exposure):** a
deterministic abstract mark generated purely from a hash of the
member's pseudonym --- same name always produces the same mark, using
a small curated palette and simple non-figurative shape primitives
(arcs, overlapping circles). Recommended as the immediate replacement
for the current gray-silhouette placeholder avatar, independent of
which direction ultimately wins.

**Phase B (future, gated on legal review):** an optional photo of the
member's own physical space (never a face, never voice --- both
considered and rejected specifically for real biometric-law exposure
under laws like Illinois' BIPA and GDPR's special-category rules),
transformed via client-side neural style transfer (e.g. Google
Magenta's arbitrary-image-stylization TFJS model, running entirely
in-browser) into a unique abstract pattern. Original photo never
transmitted or retained anywhere.

### What needs deciding, deliberately, before more identity-system work

Which direction Tempa actually wants: a designed creature/species
system (§14's Mindforms, closer to Slowly's own avatar system in
spirit though visually distinct) or the abstract generative-mark
system above (explicitly rejects any figurative/creature avatar,
including Tempa's own species). These are not compatible as a single
per-member identity system --- pick one. Note §14's *platform mascot*
("Tempa" itself as a guide character, "the Mind that links minds") is
a separate question from *per-member identity representation* and can
coexist with either direction; the conflict is specifically between
Mindforms-as-personal-identity and the abstract-mark system.

---

# 32. ADMIN LAYER --- DESIGN RECORDED, NOT BUILT

Several V1 safety requirements already listed under §17 (Block, Report
+ admin review, rate limits, scam warnings, image moderation) imply an
admin surface that was never designed as one coherent system. Full
design recorded separately; summary:

Six modules: (1) moderation & safety queue --- reports, scam-notice
review, image moderation queue, account suspend/ban, and critically an
**audit log** of every privileged read of private letter content, so
staff access to content only ever happens for a logged reason, never
as a standing capability; (2) user & account management --- lookup,
metadata-only default view, manual test-account overrides; (3) content
& product ops --- Question rotation, Postcard asset curation, catalog
management; (4) platform health dashboard --- headline metric should
be the "second meaningful exchange" rate (answer → first letter → 
reply → third letter → later return), not vanity numbers; (5)
financial/revenue admin, once paid features exist; (6) system/infra ---
feature flags, email delivery visibility, error visibility.

Technical approach: dedicated `/admin` route tree, role column (not a
boolean) on profile, gated by server-side middleware. `service_role`
key usable here ONLY in server-side API routes/server actions, never
client-bundled --- a narrow, deliberate exception to the "only
anon/publishable key in the client" rule, scoped entirely to the admin
backend.

Sequencing: nothing extra needed now (direct Supabase table access is
a legitimate stand-in at current scale). Required at V1/stranger-safe
scale (§17, §24-H): reports queue, scam review, image moderation,
suspend/ban, the audit log, basic lookup. Everything else (dashboard,
content ops UI, feature flags, financial admin) waits for real
operational need post-launch.

---

# 33. PWA --- INSTALLABLE WEB APP, NOT A STORE LISTING

Not yet built; not mentioned elsewhere in this guide. Recommended once
the core loop (§24 build order) is stable, before or alongside
stranger-safe hardening.

Tempa remains the same live web application, addable to a phone home
screen (iOS Safari "Add to Home Screen," Android Chrome install
prompt) and launched full-screen with no browser chrome. Does **not**
create an Apple App Store or Google Play listing and needs no review.
Do not require installation during onboarding --- Tempa must work
fully in-browser regardless; offer installation later, contextually,
after the member has already experienced value. User-facing copy:
**"Add Tempa to your Home Screen,"** never "Download Tempa."

Be deliberate about offline caching: UI shell may cache; actual letter
content, delivery timing, and Letterbox state must always come from
the server, never a stale cache.

Recorded future path: web app → installable PWA → prove retention →
consider Google Play → consider iOS App Store. Native/store
distribution is a distinctly later phase; if pursued, Android
(Google's official Trusted Web Activity pattern) is far lower-friction
than iOS, where Apple's Guideline 4.2 ("Minimum Functionality")
routinely rejects bare website wrappers without genuine native
elements added.

---

# 34. VISUAL & COPY SYSTEM — APPROVED DIRECTION, FULL PASS NOT YET DONE

The approved Letterbox mockup is now the canonical visual reference for TEMPA's eventual finished interface — not merely
inspiration. The live product does **not yet** match it closely enough; that is a known scope/status fact, not a capability limit.

### Locked direction

-   warm paper/cream surfaces;
-   strong editorial/serif hierarchy for identity/headings and human writing where appropriate;
-   smaller muted sans-serif metadata;
-   one restrained natural UI accent (sage/ink family);
-   muted terracotta/red reserved as the recognizable non-destructive **system-notice** family;
-   pale warm terracotta/peach notice backgrounds;
-   soft low-opacity paper-like cards/shadows;
-   postal objects may use restrained ochre/gold where appropriate;
-   no gradients, gloss, neon or generic Material-alert styling;
-   deliberate desktop composition, not stretched mobile;
-   responsive mobile layout with comfortable tap targets.

### Canonical system-notice reference

`Mail on the way` in the approved mockup defines the treatment: terracotta envelope/motion mark, terracotta title, warm pale
background, smaller supporting copy, visibly distinct from the correspondent's serif writing. Use the same family later for
`A photo is waiting`, Question reminders, privacy/safety notes and the network-location caution — with stronger warning/error
variants only when severity warrants it.

**Current status (2026-09-05):** the shared `SystemMessage` component (`app/system-message.tsx`) already establishes the
correct semantic shape for this — `quiet`/`notice`/`warning` variants, an icon slot, a title, optional supporting text, and
(added during the Home consolidation checkpoint) an optional `action` slot for a CTA/dismiss row. It is used for Mail on the
way (Home and Letterbox) and the Question reminder (Minds and Home). None of these instances yet carry the terracotta/peach
palette — they render in a restrained neutral-sans interim style. Bringing them to the approved finish is scoped entirely to
§24-D and should not be done piecemeal per-surface.

### Future TEMPA iconography system (recorded 2026-09-05, not built)

TEMPA should eventually have its own restrained iconography/graphic language rather than indefinitely
reusing generic stroke-icon shapes:

-   familiar actions keep familiar semantic silhouettes (a back chevron still reads as "back," an
    envelope still reads as "mail") — uniqueness should never come at the cost of legibility;
-   distinctiveness instead comes through common stroke weight/proportions, rounded/ink-like detailing,
    and recurring postal motifs, applied consistently across the whole icon set;
-   signature graphics should eventually cover: Mail Call/travelling mail, Moments, Postcards/postmarks,
    removal from Letterbox, system notices, and selected empty states;
-   do not turn every ordinary UI control into decorative artwork — restraint applies to icons as much
    as to color;
-   the approved Letterbox visual reference remains the benchmark for what "restrained but distinctive"
    looks like.

**Interim state (2026-09-05):** current icons (`MailInTransitIcon`, `QuestionInfoIcon`, the archive
header's back chevron and `RemoveFromLetterboxIcon`, the letter menu's overflow dots) are plain,
generic stroke glyphs — functionally correct and consistent with each other (24×24 viewBox, 1.5
strokeWidth, round caps/joins, currentColor) but not yet the custom TEMPA icon family described above.
Do not build the full custom icon set piecemeal; it belongs to §24-D alongside the terracotta
system-notice finish.

### Identity placeholder

The generic grey silhouette still reads as an incomplete profile and must ultimately disappear. Resolve §31 first, or use only
a deliberate interim abstraction.

### Companion reference artifact

Keep the approved Letterbox desktop/mobile mockup attached alongside implementation instructions during the full visual-system
pass so code changes are evaluated against a concrete target rather than prose alone.

------------------------------------------------------------------------

# 35. HOME DESKTOP COMPOSITION — DEFERRED DESIGN PASS (recorded 2026-09-27, not built)

Not a redesign — a scoped observation from the Board Personalization
checkpoint (§20; Board ranking now relationship- and interest-aware) to
revisit once a Home visual pass is actually scheduled. Do not act on this
piecemeal alongside ranking/backend work.

-   desktop Home content currently reads as centered/floating within the
    post-sidebar canvas, rather than composed against it;
-   investigate left-anchoring the main Home content after a deliberate
    sidebar gutter, instead of large mirrored empty margins on both
    sides — this is a composition problem, not a "too much whitespace"
    problem; Tempa's generous whitespace (§2, §34) should be preserved,
    not reduced;
-   review the Home hierarchy as one system rather than patching
    individual sections in isolation: Arrivals, From the Board,
    announcements, section headings (and whether a page-level heading is
    warranted), and the remaining Home sections;
-   review Board-card presentation specifically as used on Home: media
    geometry, avatar treatment, country-mark rendering, and typography/
    hierarchy should be made consistent across cards;
-   Arrivals should NOT become loud or dashboard-like in the course of
    this — Tempa's calm editorial character (§2) is a constraint on the
    solution, not something this pass trades away;
-   Tempa Kids is out of scope here and remains listed under §23
    (Deliberately Deferred) — if it is ever pursued as a real product
    surface, it needs its own product/safety/legal architecture review
    before any implementation, separate from this composition pass.

------------------------------------------------------------------------

# CURRENT NEXT ACTION — UPDATED 2026-09-09

**Review and, if approved, execute `docs/sql/2026-09-09-board-usability.sql` (then
`-verify.sql`), then run its live-test procedure — that is the only thing between this checkpoint
and being fully live.**

Writing/composer essentials (§16, §24-B) and the Moments/composer send-eligibility work are confirmed
via the 2026-09-05 night live test (§25's "Confirmed in authenticated testing") — the double-click/
selection fix, Bold/Italic/Emoji across every composer, and the established-correspondence length-
policy removal are no longer open live-test items. `write_letter`'s alias repair is prepared but its
live-execution status should be double-checked against the database before relying on it.

Home consolidation (§15, §24-A) and the Letterbox archive compact-header pass remain unchanged from
before — still pending their own dedicated live-test pass if that has not happened separately.

**Dispatches/Board/sharing foundation: LIVE and VERIFIED**
(`docs/sql/2026-09-07-dispatches-and-board.sql` + `-verify.sql`, both executed and passed). Publishing,
the external `/d/[shareToken]` reader, and the original author-only Share control (§20.A/§20's "Dispatch
sharing" section) are confirmed working in real authenticated testing.

**Board usability / author control (§20.F): application layer BUILT (2026-09-09), database layer
PREPARED and NOT YET EXECUTED.** `docs/sql/2026-09-09-board-usability.sql` broadens `share_dispatch` to
any authenticated member, adds `update_dispatch`/`delete_dispatch`/`pin_dispatch`/`unpin_dispatch`, a
narrow `dispatch_photos_delete` storage policy, and `profiles.pinned_dispatch_id`. Until this migration
runs, the new Edit/Delete/Pin/Stop-sharing actions and the broadened Share will all fail live (the RPCs
they call do not exist yet) — the Home wide-card layout, Keep's new wording, and the profile hierarchy
changes do NOT depend on this migration and are already fully live. `tsc`/`vitest`/`eslint` are all
clean (see §25 for exact counts) — application-level validation is complete; only the live-test pass
after the SQL is applied remains.

Do not begin Dispatch Moments' redaction tool, Notes, video, the premium Postcard redesign, complex
ranking, admin work, or the final visual-system pass until the above is confirmed.

Also still outstanding from the prior checkpoint: live-test Home consolidation and the Letterbox
archive compact-header pass (§15, §24-A) if not already done. The terracotta/peach system-notice
visual treatment and the custom TEMPA icon family (§2, §34) remain recorded and un-implemented — do
not perform that pass piecemeal while doing any of the above.

------------------------------------------------------------------------

# FINAL NORTH STAR

Tempa succeeds if it makes someone think:

> **I wonder if they wrote back.**

Not: \> How many followers did I gain?

Not: \> How many people liked this?

Not: \> Who is hottest nearby?

The product should make distance, thought, anticipation, trust and
memory feel valuable again.

**That is the thing being built.**
