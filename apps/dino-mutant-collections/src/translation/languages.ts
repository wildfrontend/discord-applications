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
  { english: string; japanese: string; korean: string }
> = {
  zt: {
    english: 'Traditional Chinese',
    japanese: '繁体字中国語',
    korean: '중국어(번체)',
  },
  en: { english: 'English', japanese: '英語', korean: '영어' },
  ja: { english: 'Japanese', japanese: '日本語', korean: '일본어' },
  ko: { english: 'Korean', japanese: '韓国語', korean: '한국어' },
}

export const languageChoices = supportedLanguages.map((value) => ({
  name: languageChoiceNames[value].english,
  name_localizations: {
    'zh-TW': languageNames[value],
    ja: languageChoiceNames[value].japanese,
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
