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
 */
export async function translateWithAzure(input: {
  text: string
  targetLanguage: string
  sourceLanguage?: string
}): Promise<AzureTranslationResult> {
  const { key, region, endpoint } = translatorConfig()
  const query = new URLSearchParams({
    'api-version': '3.0',
    to: input.targetLanguage,
  })
  if (input.sourceLanguage) query.set('from', input.sourceLanguage)

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
      body: JSON.stringify([{ Text: input.text }]),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
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

  const first = payload[0]
  const translation = first?.translations?.[0]?.text
  if (typeof translation !== 'string') {
    throw new TranslationProviderError('Azure Translator returned no translation.')
  }

  return {
    translatedText: translation,
    detectedLanguage:
      typeof first?.detectedLanguage?.language === 'string' ? first.detectedLanguage.language : null,
  }
}
