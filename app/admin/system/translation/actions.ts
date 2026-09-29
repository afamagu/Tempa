'use server'

import { createClient } from '@/lib/supabase/server'
import { isStaff } from '@/lib/admin'
import { runTranslationDiagnostic, type TranslationDiagnosticResult } from '@/lib/translation/diagnostic'

export type TranslationConnectionTestResult = TranslationDiagnosticResult | { status: 'forbidden' }

/**
 * The only way the Translation diagnostic spends characters. Takes NO
 * arguments — the test sentence and languages are fixed server-side in
 * lib/translation/diagnostic.ts — and re-checks admin itself, because a
 * Server Action is a public POST endpoint regardless of which page
 * renders its button (app/admin/layout.tsx gates rendering, not this).
 */
export async function runTranslationConnectionTest(): Promise<TranslationConnectionTestResult> {
  const supabase = await createClient()
  if (!(await isStaff(supabase, 'admin'))) return { status: 'forbidden' }
  return runTranslationDiagnostic()
}
