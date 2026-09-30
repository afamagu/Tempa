'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { saveMyReadingLanguage, type SaveReadingLanguageResult } from '@/lib/reading-language-data'

/**
 * Save the signed-in member's Reading language. Used by You → Reading
 * language, and (next) by the "Read in…" choice on a reading surface.
 *
 * Takes only a language code. Identity comes from the session, never the
 * caller; the code is checked against Tempa's registry before the RPC, and
 * the RPC is itself keyed on auth.uid().
 */
export async function saveReadingLanguage(code: string): Promise<SaveReadingLanguageResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'failed' }

  const result = await saveMyReadingLanguage(supabase, code)
  if (result.ok) revalidatePath('/you')
  return result
}
