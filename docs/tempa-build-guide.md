# TEMPA — BUILD GUIDE

Canonical project record. No version of this file existed locally before
2026-08-30 — it's assembled here from every decision agreed in conversation
to date, consolidated and de-duplicated. Superseded decisions have been
removed rather than left alongside their replacement; where something in an
earlier round wasn't touched by a later one, it's carried forward unchanged.
No decision below was invented for this document — each traces to something
explicitly agreed.

## 1. Current build status

Working:
- Supabase connected.
- Email/magic-link authentication works.
- Custom SMTP through Resend is configured and successfully tested, using
  the verified `jointempa.com` domain. Sender identity: `Tempa` /
  `noreply@jointempa.com`.
- Onboarding/profile saving works; Home displays the Tempa pseudonym.
- The Question answer flow works.
- Discovery infrastructure/page has been built.
- Root `/` redirects signed-out users to `/sign-in` and authenticated users
  to `/home`.
- 2026-08-30 onboarding/Question/discovery schema migration applied
  ([docs/sql/2026-08-30-questions-and-pseudonym.sql](sql/2026-08-30-questions-and-pseudonym.sql)):
  canonical pseudonym uniqueness, three live Questions, one current
  answer per member, 2,000-character cap, and gender/age_range exposed
  through `public_profiles` are all live in the database, matching the
  code in this build.

Not yet complete:
- Google OAuth UI exists, but Google provider configuration is not
  finished. Do not mark Google sign-in complete until it has been tested
  successfully end-to-end.
- Two-user discovery test (the next product test once real data exists).

## 2. Locked brand-language hierarchy

Four lines, four different jobs. Do not collapse them into one universal
tagline.

- **Login / product invitation:** `Find someone worth writing to.`
- **Brand thesis:** `People are more interesting than profiles.`
- **Campaign / ads / waitlist:** `Somewhere in the world, someone thinks the
  way you do. You just haven't met them yet.`
- **Secondary brand / onboarding line:** `Meet the mind before the person.`
  Not used on the auth screen. Reserved for a later onboarding, Question,
  or brand context.

## 3. Authentication — copy and identity rule

Screen copy (locked):

```
Welcome to Tempa
Find someone worth writing to.

Continue with Google
or
Continue with email
```

- Do not use "Sign up," "Sign in," or "Send magic link" as the primary
  entry actions. The user continues; the app decides new vs. returning.
- "Magic link" may remain an internal technical term. User-facing
  confirmation copy should read something like: "Check your email. We
  sent you a secure sign-in link."
- Email is a genuine alternative to Google, not a hidden fallback.
- Google/email are authentication mechanisms only. Google real name,
  avatar, email, or other provider metadata must never automatically
  become the public Tempa identity and must never appear in discovery.
  Public identity stays pseudonym-first.
- Sign in with Apple is a future consideration for the native iOS stage —
  not a current build task.

Known gap: [app/sign-in/page.tsx](../app/sign-in/page.tsx) still reads
"Sign in" / "Send magic link" and has not yet been brought in line with
this section — noted, not yet actioned (out of scope for the 2026-08-30
onboarding/Question/discovery change).

## 4. Mobile-first product standard

Most usage is expected to be on phones. Mobile is the primary target, not
a desktop layout adapted afterward:
- Design first for narrow phone widths.
- Comfortable touch targets, readable typography.
- No hover-dependent controls — nothing should require hover to be
  discoverable or usable.
- Preserve state and scroll position during reading/navigation.
- Use modern mobile interaction patterns (e.g. a bottom sheet for reading,
  not a small desktop-style popup).
- Desktop/tablet adapt cleanly from the same system rather than being
  designed separately.

Applied so far to the full-answer discovery reading surface (full-screen
sheet on mobile, centered panel on larger screens) and the discovery
filters (stacked on mobile, three columns on larger screens).

## 5. Onboarding

After authentication, onboarding must not look like an anonymous generic
form — it should still read as Tempa.

- A restrained Tempa wordmark sits above the heading on onboarding screens.
- Onboarding is not overloaded with marketing copy.
- First step hierarchy:
  ```
  Tempa
  Choose your name
  This is the name other minds will know you by.
  ```
- The login tagline ("Find someone worth writing to.") is not repeated on
  every onboarding step.
- Keep the existing warm, concise onboarding style otherwise.

Implemented in [app/profile/profile-form.tsx](../app/profile/profile-form.tsx).

## 6. Pseudonym rules and canonical uniqueness

Visible rules (unchanged):
- 3–24 display characters.
- Letters, numbers, spaces, and hyphens.
- Displayed exactly as entered, after trimming.

Canonical uniqueness (new): near-identical names must conflict. Canonical
key = trim, lowercase, remove spaces, remove hyphens. So `Evening Quill`,
`evening quill`, `EVENING QUILL`, `EveningQuill`, and `Evening-Quill` all
collide.

- Enforced in the database via a generated `pseudonym_key` column and a
  unique index on it — not only in the frontend — so concurrent signups
  can't race past it.
- `is_pseudonym_available` and taken-name suggestions are checked against
  the same canonical key, not the raw string.
- Migration applied 2026-08-30: [docs/sql/2026-08-30-questions-and-pseudonym.sql](sql/2026-08-30-questions-and-pseudonym.sql).
  `pseudonym_key` exists, is unique-indexed, and the old `profiles_pseudonym_unique`
  (which only compared `lower(pseudonym)`) has been dropped.

## 7. The Question — architecture

- The database/app supports multiple live Questions; the initial Tempa
  experience exposes **three** live Questions at once, not one.
- A member chooses whichever of the three gives them the best chance to
  express themselves.
- A member has exactly **one current discovery answer** at a time,
  associated with whichever Question they chose (`question_answers.is_current`,
  enforced unique per user at the database level).
- When a Question rotates out of `is_active`, its answers remain stored
  (historical retention) but no longer appear in ordinary discovery.
- No weekly cadence is encoded. Operational cadence is flexible — roughly
  every 2–4 weeks initially, decided manually.
- The Question is optional — a member can read other answers without
  ever publishing one, and can always reach it again later without
  hitting a navigation dead end (`/question` acts as a hub: it redirects
  straight to a member's current answer if they have one, otherwise shows
  the three live Questions to choose from).

Current three live Questions (all `is_active`, confirmed live in the
database as of the 2026-08-30 migration):
1. `What is something you understand differently now than you did five years ago?`
2. `What is something ordinary that means more to you than most people would expect?`
3. `If you could spend one completely ordinary day anywhere in the world, where would you spend it—and what would you do?`

## 8. Question answer length

- No minimum beyond non-whitespace content — short, thoughtful answers are
  valid.
- Hard maximum: **2,000 characters** (not words).
- No visible word-count pressure; the character counter stays hidden
  until the writer approaches the limit.
- Enforced on both the client and the database — the existing
  `question_answers_body_max_length` constraint now reads
  `char_length(body) <= 2000` (migrated 2026-08-30, was 4,000).
- Unicode/international text is supported (counted by code point, not
  UTF-16 unit, so multi-byte characters aren't double-counted).

Principle: `Tempa should encourage thoughtfulness through the environment,
not enforce thoughtfulness through word quotas.`

## 9. Discovery (current, V0)

- Home action: `Read other answers`. Dedicated discovery page at
  `/question/discover`.
- Pulls current (`is_current`), active-Question answers only, across all
  currently live Questions — excludes the current user's own answer and
  any answer whose Question has rotated out of `is_active`.
- Up to 12 answers shown, drawn from a simple randomized/reshuffled
  sample of the pool remaining after filters. No popularity ranking or
  engagement-maximizing feed. Weighting toward underexposed members may be
  tested later, but no such algorithm is built now.
- Three quiet filters: Country, Gender, Age range — each defaults to
  `Any`. Country reuses the same standardized selector as onboarding;
  gender and age reuse the existing onboarding option sets. No filters for
  photos, romance, popularity, follower count, AI preference, or detailed
  interests.
  Principle: `Filters narrow the pool. Writing determines whom you choose.`
- A compact result shows: pseudonym, country, gender, age range, the
  Question answered, and a short excerpt from the start of the answer —
  visually clamped to roughly 4–6 lines on mobile, ending in an ellipsis
  where needed. The stored full answer is never truncated or modified —
  only the on-screen preview is clamped.
- No user-written titles/headlines — the Question itself provides
  context.
- Never shown: photo/avatar, region/city/precise location, languages,
  intentions, AI preference, receiving preference, social links,
  popularity/views/likes/followers/letters-received/ranking. `Prefer not
  to say` is respected, not inferred around.
- Opening a compact result opens the full answer in a focused reading
  surface (full-screen sheet on mobile, centered panel on larger screens)
  while the discovery screen stays mounted underneath — filters, sample,
  and scroll position are preserved. Closing returns exactly to where the
  user was; no stacked modals.
- The action inside the reading surface is exactly: `Write to this mind`.
  It transitions to the first-letter composer at the stable recipient
  route (`/write/[recipientId]`) rather than layering another modal.
- Desk-capacity filtering and Open Letters are both deferred — not
  removed, not promised for the current stage.

## 10. Sealed first exchange

- A reads B's Question answer and clicks `Write to this mind`.
- B is told someone read their answer and wrote to them.
- B does not see A's first letter until B reciprocates.
- B can decline quietly.
- Once B sends their own first letter, both first letters unseal.
- First letters are text-only. No teaser lines.
- This does not claim to eliminate ghosting — it prevents a substantial
  first letter from being read and then ignored without reciprocity.
- The current build only establishes the stable recipient route and the
  `Write to this mind` entry point ([app/write/[recipientId]/page.tsx](../app/write/%5BrecipientId%5D/page.tsx))
  — the full Desk/mailbox and the pending/sealed exchange itself are a
  later build stage. Beginning or opening a first letter should not
  unnecessarily destroy the user's discovery state.

## 11. Navigation terminology

Not every "back" control is `Home` — only the ones that actually go there.
Fixed in this pass:
- Question-writing screen: `Back home` → `Back to Questions` (`/question`).
- Write-to-recipient screen: `Back to other answers` → `Back to discovery`.
- Discovery screen's link to `/home` genuinely is Home, and is now simply
  labeled `Home`.

## 12. PWA

- The PWA is Tempa's first installable application format — the same live
  web application, addable to the Home Screen on supported iOS/Android
  browsers and launchable full-screen.
- It does not create an Apple App Store or Google Play listing on its own.
- Installation is not required during signup/onboarding — Tempa works
  fully in the browser regardless. Installation is offered later,
  contextually, after the user has experienced value.
- User-facing language prefers `Add Tempa to your Home Screen` over
  "Download Tempa," and should make clear this adds an app-style icon
  through the browser — not an unknown external download.
- Native/store distribution is a later phase, after V0/V1 proves
  retention:
  `Web app → installable PWA → prove retention → consider Google Play → consider iOS App Store`

## 13. Email infrastructure (Resend)

Resend is Tempa's production SMTP provider for Supabase authentication
emails, using the verified `jointempa.com` domain — not only a future Mail
Call tool. Mail Call and other transactional notifications can later reuse
the same infrastructure.

## 14. Naming

`Tempa` remains the working product name; `jointempa.com` is the current
working domain. Trademark/name clearance has not been confirmed as
complete — do not state otherwise absent evidence.

## 15. Future phase — Tempa Country Postcards

Not implemented. Recorded for a later, post-core-loop build stage.

- Country-only to start — no region, city, or precise location.
- A member's standardized disclosed country maps to a Tempa-created
  postcard asset: `country_code → postcard asset → reverse-side metadata`.
- Postcards are Tempa-created/curated assets (original illustration,
  commissioned/licensed imagery, or carefully reviewed generated
  artwork) — never user uploads, never scraped landmark photos.
- Imagery evokes place — geography, landscapes, flora, coastlines,
  architecture, skylines — and never infers ethnicity, tribe, race, or
  religion from a country.
- No requirement to cover every country up front — seed from testers'
  and early users' represented countries, expand as needed.
- Postcards never appear in compact discovery previews — writing must
  earn the click. The postcard appears only inside the opened/full
  answer, near the bottom of the reading experience: small and centered,
  tap to enlarge, front shows place artwork, flip/tap shows the reverse
  (country name + restrained postal/Tempa information), flip back or
  dismiss without losing position.

Principle:
```
The Question introduces the mind.
The postcard introduces the place.
The letter introduces the person.
```

## 16. Future — user-image safety (cross-reference: Moments, V1 moderation)

Not implemented. Recorded against the later Moments/image-sharing stage.

Once correspondents can upload their own images, moderation must
eventually cover both the visual content and any readable text embedded
inside images — extracted text should go through the same scam/safety
checks as written correspondence, so payment requests, phone numbers,
links, or other risky content can't bypass review by being placed inside
an image. OCR and automated moderation are not claimed to be perfect.
Continue to require EXIF/location metadata stripping, private
correspondence-scoped storage/access, upload validation, and image safety
moderation. Does not apply to Tempa-curated Country Postcards, since users
can't modify or upload those assets.

## Open items

- Google OAuth end-to-end test still pending (see §1).
- [app/sign-in/page.tsx](../app/sign-in/page.tsx) copy still needs to be
  brought in line with §3.
- Trademark/name clearance for `Tempa` not yet confirmed either way.
