// Safety text-analysis boundary.
//
// Every piece of member-written text is analysed through ONE function so
// that a later, optional, privacy-safe TRANSLATED representation can be
// added without touching the classifier or any composer. Phase 1 has NO
// translation provider: only the original text (normalised by the
// classifier's own pipeline) is analysed.
//
// Two rules this boundary makes structural:
//
//  1. "Translation unavailable" is never "safe". The original text is
//     ALWAYS analysed; a missing or failed translation only records that
//     a second representation was not available (coverage), it can never
//     lower, replace or cancel the original analysis. A caller can see
//     that coverage was partial; nothing here ever reports "clean because
//     we could not read it".
//  2. Private letters are never sent to a general-purpose LLM or any
//     external service. A representation is plain text handed in by the
//     caller (e.g. produced by a future, separately reviewed, on-platform
//     component); this module performs no I/O at all.

import { classifyContent, combineClassifications, type ClassificationResult, type ClassifyOptions } from './classify'

export type TranslationInput =
  /** No translation was requested (Phase 1: always this). */
  | { status: 'not_requested' }
  /** A translation was requested but is not available — must NOT read as safe. */
  | { status: 'unavailable' }
  /** A privacy-safe translated representation of the same text. */
  | { status: 'available'; text: string }

export type AnalysisCoverage = {
  original: 'analyzed'
  translation: 'not_requested' | 'unavailable' | 'analyzed'
}

export type AnalysisResult = {
  classification: ClassificationResult
  coverage: AnalysisCoverage
}

export function analyzeText(
  originalText: string,
  options: ClassifyOptions & { translation?: TranslationInput } = {}
): AnalysisResult {
  const { translation = { status: 'not_requested' } as TranslationInput, ...classifyOptions } = options
  const original = classifyContent(originalText, classifyOptions)

  if (translation.status === 'available') {
    // Each representation is classified separately and combined
    // structurally (most restrictive wins) — a translation can only ADD
    // concern, never remove what the original text already showed.
    const translated = classifyContent(translation.text, classifyOptions)
    return {
      classification: combineClassifications([original, translated]),
      coverage: { original: 'analyzed', translation: 'analyzed' },
    }
  }

  return {
    classification: original,
    coverage: { original: 'analyzed', translation: translation.status },
  }
}
