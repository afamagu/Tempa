import 'server-only'

export const AZURE_TRANSLATOR_PROVIDER = 'azure' as const
export const AZURE_TRANSLATOR_VERSION = 'v3.0' as const

export type AzureTranslationResult = {
  translatedText: string
  detectedLanguage: string | null
}

export class TranslationProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'TranslationProviderError'
  }
}

type AzureResponse = Array<{
  detectedLanguage?: { language?: string; score?: number }
  translations?: Array<{ text?: string; to?: string }>
}>

function translatorConfig() {
  const key = process.env.AZURE_TRANSLATOR_KEY?.trim()
  const region = process.env.AZURE_TRANSLATOR_REGION?.trim()
  const endpoint = (process.env.AZURE_TRANSLATOR_ENDPOINT?.trim() || 'https://api.cognitive.microsofttranslator.com').replace(
    /\/+$/,
    ''
  )

  if (!key) {
    throw new TranslationProviderError('Azure Translator is not configured.')
  }

  return { key, region, endpoint }
}

/**
 * Thin server-only Azure Translator adapter. No SDK dependency, no browser key,
 * and no Tempa persistence policy lives here: callers decide whether a result
 * is eligible for the PUBLIC translation cache before invoking this adapter.
 *
 * `texts` is sent verbatim as `[{ Text }, ...]` — the service reserves quota
 * against exactly these strings, so nothing may be added or altered here.
 * `textType: 'html'` is only ever used with Tempa-generated markup
 * (lib/translation/provider-html.ts); the response is still untrusted and is
 * sanitized by the caller.
 */
export async function translateTextsWithAzure(input: {
  texts: readonly string[]
  targetLanguage: string
  sourceLanguage?: string
  textType: 'plain' | 'html'
}): Promise<AzureTranslationResult[]> {
  const { key, region, endpoint } = translatorConfig()
  const query = new URLSearchParams({
    'api-version': '3.0',
    to: input.targetLanguage,
  })
  if (input.sourceLanguage) query.set('from', input.sourceLanguage)
  if (input.textType === 'html') query.set('textType', 'html')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=UTF-8',
    'Ocp-Apim-Subscription-Key': key,
  }
  if (region) headers['Ocp-Apim-Subscription-Region'] = region

  let response: Response
  try {
    response = await fetch(`${endpoint}/translate?${query.toString()}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.texts.map((text) => ({ Text: text }))),
      cache: 'no-store',
      signal: AbortSignal.timeout(input.texts.length > 1 ? 20_000 : 12_000),
    })
  } catch {
    throw new TranslationProviderError('Azure Translator could not be reached.')
  }

  if (!response.ok) {
    // Deliberately do not surface or log the provider response body here. This
    // adapter can carry private correspondence, so errors must never become a
    // back door for writing member text into application logs.
    throw new TranslationProviderError(`Azure Translator request failed (${response.status}).`, response.status)
  }

  let payload: AzureResponse
  try {
    payload = (await response.json()) as AzureResponse
  } catch {
    throw new TranslationProviderError('Azure Translator returned an unreadable response.')
  }

  if (!Array.isArray(payload) || payload.length !== input.texts.length) {
    throw new TranslationProviderError('Azure Translator returned no translation.')
  }

  return payload.map((item) => {
    const translation = item?.translations?.[0]?.text
    if (typeof translation !== 'string') {
      throw new TranslationProviderError('Azure Translator returned no translation.')
    }
    return {
      translatedText: translation,
      detectedLanguage:
        typeof item?.detectedLanguage?.language === 'string' ? item.detectedLanguage.language : null,
    }
  })
}

/** One plain-text string — the original v1 call shape, kept for
 * translatePrivateText / translatePublicText (and so the Admin diagnostic). */
export async function translateWithAzure(input: {
  text: string
  targetLanguage: string
  sourceLanguage?: string
}): Promise<AzureTranslationResult> {
  const [result] = await translateTextsWithAzure({
    texts: [input.text],
    targetLanguage: input.targetLanguage,
    sourceLanguage: input.sourceLanguage,
    textType: 'plain',
  })
  return result
}
