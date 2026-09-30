# Reading language

> The author owns the original. Tempa helps the reader understand it.

Translation in Tempa is a **reading accommodation**, not a translator feature. A member who meets writing they can't read can ask Tempa to show it in the language they read. The original is never changed, and View original is always one action away.

## The preference

**Reading language** is a private member setting. Members see it as **Translation language**, a secondary choice inside You → Language (`/you/language`; the old `/you/reading-language` redirects there). Choosing a primary Tempa language also sets the reading language to the same code; the Translation language section lets a member pick a different one from the full registry.

- It means one thing: *the language Tempa translates someone else's writing into when I ask.*
- It is **optional**. It is not an onboarding step and is never required at signup. A member who hasn't chosen one is asked on their first Translate action (the "Read in…" choice), and that choice is saved.
- It is **never inferred** from country, location, time zone or IP. The browser's own language list may *highlight* a suggestion in the picker, but it is never saved without the member choosing it.
- It is **private**. It is stored in `public.member_language_preferences`, not on `profiles`, so it never travels through `public_profiles` or any profile RPC. RLS lets a member read only their own row. The only write path is `set_my_reading_language(text)`, which is keyed on `auth.uid()`.
- Account closure removes it automatically (the row cascades from `profiles`).

SQL: `docs/sql/2026-09-30-reading-language.sql` and its verifier have been executed and verified in production.

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

## Tempa language (interface localization)

**Reading language ≠ Tempa language**, technically. A member still makes one choice (You → Language), which sets both.

- **Tempa language** is Tempa's own menus, buttons and system copy. It comes from reviewed **local dictionaries** (`messages/en.json`, `fr.json`, `es.json`, `pt.json`) via `next-intl`. It is never machine-translated and makes no Azure call. It is instant and works before sign-in (a quiet language control on `/sign-in`).
  - Interface languages live in `i18n/config.ts`: English, Français, Español and Português, each with a direction. Adding one is a registry entry plus a reviewed dictionary.
  - Resolution order: an explicit `tempa_locale` cookie (set only by the member's own choice), then a supported `Accept-Language` match used for that render only and never saved, then English. Country or location is never consulted.
  - URLs never carry a locale. There are no `/fr/…` routes and no `[locale]` segments; `proxy.ts` is unchanged.
  - Localized so far: `/sign-in`, the root `<html lang dir>`, the primary navigation, the You → Language row and `/you/language`. Other surfaces are migrated one at a time.
- **Reading language** is the target for translating members' writing through the existing translation service (on demand; the original stays canonical).

There are still no translated or indexable `/es/…` public Dispatch pages. The original public Dispatch remains the canonical page for search.
