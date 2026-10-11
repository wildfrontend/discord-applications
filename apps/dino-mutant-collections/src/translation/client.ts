import type { TranslationLanguage } from './languages.js'

export interface DetectionResult {
  confidence: number
  language: TranslationLanguage | null
}

export interface TranslationResult {
  text: string
  detectedLanguage: TranslationLanguage | null
}

export interface BatchTranslationResult {
  translations: Partial<Record<TranslationLanguage, string>>
  detectedLanguage: TranslationLanguage | null
}

export interface TranslationClient {
  readonly name: string
  detect(text: string): Promise<DetectionResult>
  translate(
    text: string,
    target: TranslationLanguage,
    source?: TranslationLanguage | 'auto',
  ): Promise<TranslationResult>
}

export interface BatchTranslationClient extends TranslationClient {
  translateMany(
    text: string,
    targets: readonly TranslationLanguage[],
    source?: TranslationLanguage | 'auto',
  ): Promise<BatchTranslationResult>
}
