export const supportedLanguages = ['zt', 'en', 'ja', 'ko'] as const

export type TranslationLanguage = (typeof supportedLanguages)[number]

export const languageNames: Record<TranslationLanguage, string> = {
  zt: '繁體中文',
  en: '英文',
  ja: '日文',
  ko: '韓文',
}

export const languageChoices = supportedLanguages.map((value) => ({
  name: languageNames[value],
  value,
}))

export function isTranslationLanguage(
  value: string,
): value is TranslationLanguage {
  return supportedLanguages.includes(value as TranslationLanguage)
}

export function normalizeDetectedLanguage(
  value: string,
): TranslationLanguage | null {
  if (value === 'zh' || value === 'zh-TW' || value === 'zh-Hant') return 'zt'
  return isTranslationLanguage(value) ? value : null
}
