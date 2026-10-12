export const supportedLanguages = ['zt', 'en', 'ja', 'ko'] as const

export type TranslationLanguage = (typeof supportedLanguages)[number]

export const languageNames: Record<TranslationLanguage, string> = {
  zt: '繁體中文',
  en: '英文',
  ja: '日文',
  ko: '韓文',
}

const languageChoiceNames: Record<
  TranslationLanguage,
  { english: string; korean: string }
> = {
  zt: { english: 'Traditional Chinese', korean: '중국어(번체)' },
  en: { english: 'English', korean: '영어' },
  ja: { english: 'Japanese', korean: '일본어' },
  ko: { english: 'Korean', korean: '한국어' },
}

export const languageChoices = supportedLanguages.map((value) => ({
  name: languageChoiceNames[value].english,
  name_localizations: {
    'zh-TW': languageNames[value],
    ko: languageChoiceNames[value].korean,
  },
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
