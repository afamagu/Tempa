import { permanentRedirect } from 'next/navigation'

/**
 * The former You → Reading language page. Reading language now lives
 * inside You → Language (as "Translation language"), so old bookmarks and
 * links land there. The underlying data functions are unchanged
 * (lib/reading-language-data.ts, app/reading-language-actions.ts).
 */
export default function ReadingLanguageRedirect() {
  permanentRedirect('/you/language')
}
