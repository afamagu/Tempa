# Tempa translation foundation

Status: **live in production and verified end-to-end.**

- `docs/sql/2026-09-29-translation-foundation.sql` and its verifier have been executed and verified in production.
- Azure Translator F0 is configured in Vercel (Production and Preview) via server-only environment variables. No secret is committed.
- The Admin → System → Translation connection test has passed in production, proving the full chain: Tempa → Vercel → Supabase quota reservation → Azure → Tempa (the test reserved exactly 43 characters).
- The original is still canonical everywhere. Public/private persistence rules below are unchanged.

Member-facing translation is being added in stages: Reading language plus the structured rendering foundation first, then public Dispatches, then private Letters and Postcards. See `docs/reading-language.md` for the product model.

## Provider decision

Tempa uses Azure Translator as the first machine-translation provider. The provider is behind a server-only adapter (`lib/translation/azure.ts`) so Tempa is not coupled to Azure at call sites and can replace the provider later without rewriting product surfaces.

The initial operating target is Azure's F0 tier. Tempa's own guard defaults to **1,800,000 source characters per UTC month**, below the provider's 2,000,000-character monthly F0 allowance. `TRANSLATION_MONTHLY_CHARACTER_LIMIT` may lower that value but the application refuses a value above 2,000,000.

## Locked product rules

1. **The original is canonical.** Translation never overwrites member writing.
2. **Always allow View original.** A translated reader must make the original one action away.
3. **Country never implies language.** Language comes from member choice and/or source-language detection, never location.
4. **UI localization is separate.** Tempa interface strings belong in local dictionaries. Do not send buttons, navigation, settings copy or system prose through the per-character machine-translation provider.
5. **Public and private writing have different persistence rules.**
   - Public content may use `translatePublicText` and the durable cache.
   - Private Letters, private Postcard backs and Reveal Lines use `translatePrivateText`; their translation is not persisted in `translation_cache`.
6. **Private writing is translated only after an explicit member action.** It must never be pre-translated in the background.
7. **No general translation proxy.** Do not expose a route that accepts arbitrary text just because a member is authenticated. Each product surface must resolve/authorize its canonical Tempa content first and only then call the server-only translation service.
8. **Authored formatting survives through Tempa-generated markup, never member HTML.** Field translation (`translatePrivateFields` / `translatePublicFields`) parses the stored body with the reader's own utilities, escapes every character of member text, and generates only `<strong>`, `<em>` and `<br>`, one provider unit per canonical paragraph (split safely only when a single paragraph exceeds one Azure request; see Cost and cache model) (`lib/translation/provider-html.ts`). Azure is called with `textType=html`. Its output is untrusted: it is parsed with `parse5` (never regex), reduced to plain `{text, bold, italic}` data, and rendered as React text nodes. The v1 single-string APIs (`translatePrivateText`, `translatePublicText`) and `bodyTextForTranslation` remain plain text and unchanged.
9. **Translated prose uses Tempa's canonical reading typography,** never the author's Writing Style (`app/translated-prose.tsx`), with `lang` and `dir` set on the translated surface only.

## Cost and cache model

`reserve_translation_characters` runs before every outbound provider call. It uses a row lock, so concurrent requests cannot both spend the same remaining allowance. Reservations are intentionally not refunded if the provider call fails. This slightly under-uses the free allowance in a failure-heavy month, but prevents retries from creating an untracked overrun.

Every string placed in an Azure request is built first; the reservation is for exactly the sum of those strings (markup included, counted in Unicode code points), and those same strings are sent. Target (and explicit source) languages must be in Tempa's Reading language registry (`lib/reading-languages.ts`), also checked before any reservation.

Public translations are cached by:

- canonical content type + id + field;
- caller-supplied content version;
- SHA-256 fingerprint of the exact source sent (v1: the visible text; field translation: the exact canonical provider representation, so a formatting-only edit can never reuse an old translation);
- source-language mode (`auto` or explicit language);
- target language;
- provider + provider version (field-level rows use `v3.0/tempa-fields-1` and store sanitized structured JSON, one row per field; they never collide with v1 plain-text rows).

**Tempa has no document-size translation ceiling.** Azure's per-request limits (50,000 characters / 1,000 elements) are transport detail. One logical field operation (for example a Dispatch's title, body and Postcard lines) may span several Azure requests:

1. Every exact provider string is built first. Ordinary paragraphs stay whole. Only a single paragraph larger than one request is split, at the segment/text layer before HTML generation: at sentence boundaries, then words, then grapheme clusters. Each piece keeps its bold/italic state and is valid minimal HTML on its own. The translated pieces are reassembled into that one canonical paragraph, so paragraph indexes (Moments, reading position) never drift.
2. The exact total for the whole operation is reserved **once, before the first request**. If the monthly allowance can't cover the whole document, no Azure call is made, so a translation can never stop half-way for lack of allowance.
3. Ordered batches, each within both limits, are sent **sequentially**, and results are reassembled in source order.
4. If any batch fails, the whole operation fails: nothing partial is returned, no cache rows are written, and the reservation is kept (the no-refund rule above).

Batching never changes cache identity: fingerprints come from the canonical, unchunked representation.

Field-level public translation reads every requested field in one cache query. Hits cost zero provider characters; only genuine misses are sent. Fresh rows (one per field) are written only after every batch has succeeded and been sanitized. A cached value is re-validated on read and treated as a miss if its shape is unexpected.

The cache does **not** store the source text itself. The fingerprint is a stale-content backstop: if a caller accidentally reuses an old content version after an edit, different words cannot receive the old translation.

Every public-content integration must add cache deletion/invalidation to the source's existing delete/edit lifecycle. `translation_cache_source_idx` exists specifically to make deletion by `(content_type, content_id)` cheap.

## Azure configuration

Server-only environment variables:

```text
AZURE_TRANSLATOR_KEY=
AZURE_TRANSLATOR_REGION=
AZURE_TRANSLATOR_ENDPOINT=https://api.cognitive.microsofttranslator.com
TRANSLATION_MONTHLY_CHARACTER_LIMIT=1800000
```

For a global single-service Translator resource, the region header may be unnecessary; leave `AZURE_TRANSLATOR_REGION` blank only when Azure's Keys and Endpoint page says the resource is global. Never prefix any Translator secret with `NEXT_PUBLIC_`.

## Database activation

Done. `docs/sql/2026-09-29-translation-foundation.sql` then `docs/sql/2026-09-29-translation-foundation-verify.sql` were run and verified in production. Do not re-run them.

The Reading language preference has its own, separate migration: `docs/sql/2026-09-30-reading-language.sql` plus verifier (see `docs/reading-language.md`).

## Integration sequence

The foundation intentionally does not change the live reader yet. Integrate surfaces in this order so cost/privacy behaviour is testable before broad automatic translation exists:

1. member language preference / reading-language model, plus structured (formatting-preserving) field translation — **in progress**;
2. one public Dispatch translation path using durable cache;
3. translated public discovery previews and public profile/Question-response surfaces;
4. explicit Translate / View original for private Letters;
5. explicit private Postcard-back / Reveal-Line translation;
6. connect the existing safety analysis boundary to a translated representation only after the translation product path is stable. Safety must continue to analyse the original and must never treat translation failure as safe.

## Operational rule

If the monthly guard is exhausted, translation fails closed for the remainder of the month; originals remain readable and unchanged. Do not silently fall back to another paid provider.
