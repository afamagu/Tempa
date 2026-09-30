# Reading language

> The author owns the original. Tempa helps the reader understand it.

Translation in Tempa is a **reading accommodation**, not a translator feature. A member who meets writing they can't read can ask Tempa to show it in the language they read. The original is never changed, and View original is always one action away.

## The preference

**Reading language** is a private member setting at You → Your presence → Reading language (`/you/reading-language`).

- It means one thing: *the language Tempa translates someone else's writing into when I ask.*
- It is **optional**. It is not an onboarding step and is never required at signup. A member who hasn't chosen one is asked on their first Translate action (the "Read in…" choice), and that choice is saved.
- It is **never inferred** from country, location, time zone or IP. The browser's own language list may *highlight* a suggestion in the picker, but it is never saved without the member choosing it.
- It is **private**. It is stored in `public.member_language_preferences`, not on `profiles`, so it never travels through `public_profiles` or any profile RPC. RLS lets a member read only their own row. The only write path is `set_my_reading_language(text)`, which is keyed on `auth.uid()`.
- Account closure removes it automatically (the row cascades from `profiles`).

SQL (status: **NOT EXECUTED**, review first): `docs/sql/2026-09-30-reading-language.sql`, then `docs/sql/2026-09-30-reading-language-verify.sql` (the verifier ends in `ROLLBACK`).

## The language registry

`lib/reading-languages.ts` is Tempa's single list of Reading languages. Each entry has:

- the provider code;
- an English name;
- the language's native name;
- a direction (`ltr`/`rtl`).

Every code was checked against Azure Translator's live `/languages?scope=translation` list on 2026-09-30. A snapshot is committed and enforced by a test.

- The launch set is a broad curated subset (100+ languages covering the major world languages), not every provider language.
- Adding a language is one registry entry. The database checks only a code's *shape*, so expansion needs no migration.
- A stored code the registry doesn't recognise reads back as "not chosen".
- No flags, no countries: a language is not a country.
- Direction metadata lets an Arabic, Hebrew, Persian or Urdu translation render right-to-left **on the translated reading surface only**. Tempa's interface never flips because one piece of writing is RTL.

## How translated writing looks

- Translated prose uses **Tempa's canonical reading typography**. Translated titles use Tempa's canonical authored heading. An author's Writing Style is their presentation of *their* original, so it never styles a translation (`app/translated-prose.tsx`).
- Bold, italic, paragraphs and line breaks are preserved safely (see `docs/translation-foundation.md`, rule 8).
- Paragraph *i* of a translation is paragraph *i* of the original, so Moments, Postcards and reading-position tracking keep their canonical positions.
- The same reading surface switches in place between original and translation. It does not show two copies one after the other.

## Tempa language (interface localization) is separate — future work

**Reading language ≠ Tempa language.** Tempa's own interface (Home, Send, The Board, Notifications, Account & privacy, Back…) will one day be localized from **local message dictionaries**, never through the per-character translation provider.

That is a separate future project with its own setting (a future *Tempa language*). It is intentionally not built yet:

- no `interface_locale` column;
- no i18n framework installed (a library such as `next-intl` may be evaluated then);
- no locale-prefixed routes, and no translated or indexable `/es/…` public Dispatch pages. The original public Dispatch remains the canonical page for search.
