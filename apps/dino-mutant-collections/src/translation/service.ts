import { aiTranslationClient as translationClient } from './ai-client.js'
import { languageNames, type TranslationLanguage } from './languages.js'
import type { TranslationBinding } from './store.js'

export interface CompletedTranslation {
  source: TranslationLanguage | null
  target: TranslationLanguage
  text: string
}

const hangulPattern = /\p{Script=Hangul}/u
const kanaPattern = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const hanPattern = /\p{Script=Han}/u
const latinPattern = /\p{Script=Latin}/u

function bindingHas(
  binding: TranslationBinding,
  language: TranslationLanguage,
): boolean {
  return binding.languageA === language || binding.languageB === language
}

function detectByScript(
  text: string,
  binding: TranslationBinding,
): TranslationLanguage | null {
  if (bindingHas(binding, 'ko') && hangulPattern.test(text)) return 'ko'
  if (bindingHas(binding, 'ja') && kanaPattern.test(text)) return 'ja'
  if (
    bindingHas(binding, 'en') &&
    latinPattern.test(text) &&
    !hanPattern.test(text) &&
    !hangulPattern.test(text) &&
    !kanaPattern.test(text)
  ) {
    return 'en'
  }
  return null
}

export async function detectMessageLanguage(
  text: string,
): Promise<TranslationLanguage | null> {
  // Pure Han text is ambiguous between Chinese and Japanese. Kana and Hangul
  // are unambiguous, while Han-only text defaults to Traditional Chinese;
  // normal Japanese sentences usually contain kana.
  if (hangulPattern.test(text)) return 'ko'
  if (kanaPattern.test(text)) return 'ja'
  if (hanPattern.test(text)) return 'zt'
  if (latinPattern.test(text)) return 'en'

  const detected = await translationClient.detect(text)
  return detected.language
}

export async function detectBindingLanguage(
  text: string,
  binding: TranslationBinding,
): Promise<TranslationLanguage | null> {
  const scriptLanguage = detectByScript(text, binding)
  if (scriptLanguage) return scriptLanguage

  const detected = await translationClient.detect(text)
  if (detected.language && bindingHas(binding, detected.language)) {
    return detected.language
  }

  // 短句或專有名詞可能只含漢字；若綁定含繁中，優先當作繁中。
  if (bindingHas(binding, 'zt') && hanPattern.test(text)) return 'zt'
  return null
}

export async function translateAcrossBinding(
  text: string,
  binding: TranslationBinding,
): Promise<CompletedTranslation | null> {
  const source = await detectBindingLanguage(text, binding)
  if (!source) return null
  const target =
    source === binding.languageA ? binding.languageB : binding.languageA
  const translated = await translationClient.translate(text, target, source)
  return { source, target, text: translated.text }
}

export async function translateToLanguage(
  text: string,
  target: TranslationLanguage,
  sourceLanguage: TranslationLanguage | 'auto' = 'auto',
): Promise<CompletedTranslation> {
  const source =
    sourceLanguage === 'auto'
      ? await detectMessageLanguage(text)
      : sourceLanguage
  if (source === target) {
    return { source: target, target, text }
  }
  const translated = await translationClient.translate(
    text,
    target,
    source ?? 'auto',
  )
  return {
    source: source ?? translated.detectedLanguage,
    target,
    text: translated.text,
  }
}

export async function translateToLanguages(
  text: string,
  targets: readonly TranslationLanguage[],
): Promise<CompletedTranslation[]> {
  const source = await detectMessageLanguage(text)
  const uniqueTargets = [...new Set(targets)]
  const targetsToTranslate = uniqueTargets.filter((target) => target !== source)
  const result = await translationClient.translateMany(
    text,
    targetsToTranslate,
    source ?? 'auto',
  )

  return uniqueTargets.map((target) => {
    const translatedText =
      target === source ? text : result.translations[target]
    if (translatedText === undefined) {
      throw new Error(`缺少${languageNames[target]}翻譯結果。`)
    }
    return {
      source: source ?? result.detectedLanguage,
      target,
      text: translatedText,
    }
  })
}

export function shouldTranslateMessage(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('/') || !/\p{L}/u.test(trimmed)) {
    return false
  }
  if (/^https?:\/\/\S+$/i.test(trimmed)) return false
  if (/^```[\s\S]*```$/.test(trimmed) || /^`[^`]+`$/.test(trimmed)) return false
  return true
}

export function translationContent(result: CompletedTranslation): string {
  const sourceLabel = result.source ? languageNames[result.source] : '自動偵測'
  const header = `**${sourceLabel} → ${languageNames[result.target]}**\n`
  const available = 2000 - header.length
  const text =
    result.text.length <= available
      ? result.text
      : `${result.text.slice(0, Math.max(0, available - 1))}…`
  return `${header}${text}`
}
