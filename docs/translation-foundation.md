# Tempa translation foundation

Status: foundation prepared; no production SQL has been executed and no Azure secret is committed.

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
8. **Translated reading text is plain in v1.** Tempa's stored Bold/Italic encoding is stripped with `bodyTextForTranslation` before provider submission. The original keeps its formatting. Do not send the storage delimiters to the provider and hope they survive.

## Cost and cache model

`reserve_translation_characters` runs before every outbound provider call. It uses a row lock, so concurrent requests cannot both spend the same remaining allowance. Reservations are intentionally not refunded if the provider call fails. This slightly under-uses the free allowance in a failure-heavy month, but prevents retries from creating an untracked overrun.

Public translations are cached by:

- canonical content type + id + field;
- caller-supplied content version;
- SHA-256 fingerprint of the exact visible source text;
- source-language mode (`auto` or explicit language);
- target language;
- provider + provider version.

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

After review, run in the Supabase SQL editor in this order:

1. `docs/sql/2026-09-29-translation-foundation.sql`
2. `docs/sql/2026-09-29-translation-foundation-verify.sql`

The first script is the schema change. The verification script checks RLS/grants and exercises the atomic reservation path inside a transaction that ends with `ROLLBACK`.

## Integration sequence

The foundation intentionally does not change the live reader yet. Integrate surfaces in this order so cost/privacy behaviour is testable before broad automatic translation exists:

1. member language preference / reading-language model;
2. one public Dispatch translation path using durable cache;
3. translated public discovery previews and public profile/Question-response surfaces;
4. explicit Translate / View original for private Letters;
5. explicit private Postcard-back / Reveal-Line translation;
6. connect the existing safety analysis boundary to a translated representation only after the translation product path is stable. Safety must continue to analyse the original and must never treat translation failure as safe.

## Operational rule

If the monthly guard is exhausted, translation fails closed for the remainder of the month; originals remain readable and unchanged. Do not silently fall back to another paid provider.
