import { translationReadiness } from '@/lib/translation/diagnostic'
import TranslationDiagnosticView from './translation-diagnostic-view'

/**
 * Admin → System → Translation. Rendering this page costs ZERO translation
 * characters: it only reports environment readiness as booleans. Azure is
 * reached solely through the "Run connection test" Server Action
 * (./actions.ts), which re-checks admin itself. No auth check here — see
 * app/admin/layout.tsx (the route gate), same pattern as every other admin
 * page (route-structure.test.ts enforces this).
 */
export default function AdminTranslationPage() {
  return <TranslationDiagnosticView readiness={translationReadiness()} />
}
