import {
  normalizeDetectedLanguage,
  type TranslationLanguage,
} from './languages.js'

interface DetectionResponse {
  confidence: number
  language: string
}

interface TranslationResponse {
  translatedText: string
  detectedLanguage?: DetectionResponse
  error?: string
}

export interface DetectionResult {
  confidence: number
  language: TranslationLanguage | null
}

export interface TranslationResult {
  text: string
  detectedLanguage: TranslationLanguage | null
}

const baseUrl = (
  process.env.LIBRETRANSLATE_URL || 'http://127.0.0.1:5000'
).replace(/\/+$/, '')
const apiKey = process.env.LIBRETRANSLATE_API_KEY || undefined

async function post<T>(path: string, payload: object): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiKey ? { ...payload, api_key: apiKey } : payload),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    throw new Error(`無法連線到 LibreTranslate：${details}`)
  }

  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null
  if (!response.ok) {
    throw new Error(
      body?.error || `LibreTranslate 回傳 HTTP ${response.status}`,
    )
  }
  if (!body) throw new Error('LibreTranslate 回傳了無效資料。')
  return body
}

export const libreTranslateClient = {
  async detect(text: string): Promise<DetectionResult> {
    const detections = await post<DetectionResponse[]>('/detect', { q: text })
    const best = detections[0]
    return {
      confidence: best?.confidence ?? 0,
      language: best ? normalizeDetectedLanguage(best.language) : null,
    }
  },

  async translate(
    text: string,
    target: TranslationLanguage,
    source: TranslationLanguage | 'auto' = 'auto',
  ): Promise<TranslationResult> {
    const result = await post<TranslationResponse>('/translate', {
      q: text,
      source,
      target,
      format: 'text',
    })
    if (typeof result.translatedText !== 'string') {
      throw new Error(result.error || 'LibreTranslate 沒有回傳翻譯文字。')
    }
    return {
      text: result.translatedText,
      detectedLanguage: result.detectedLanguage
        ? normalizeDetectedLanguage(result.detectedLanguage.language)
        : source === 'auto'
          ? null
          : source,
    }
  },
}
