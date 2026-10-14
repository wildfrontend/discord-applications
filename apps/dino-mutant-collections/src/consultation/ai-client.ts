import { setTimeout as delay } from 'node:timers/promises'
import type { consultationConfig } from './config.js'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content:
    | string
    | null
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >
  tool_calls?: ToolCall[]
  tool_call_id?: string
}
export interface ChatResponse {
  choices?: Array<{ finish_reason?: string; message?: ChatMessage }>
}
export interface AiRequest {
  messages: ChatMessage[]
  max_completion_tokens: number
  tools?: unknown[]
  tool_choice?: 'auto' | 'none'
  response_format?: { type: 'json_object' }
}
export interface AiDependencies {
  request?: typeof fetch
  pause?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  onProgress?: (text: string) => Promise<void>
}
export class ConsultationError extends Error {}

export function createConsultationAiClient(
  config: ReturnType<typeof consultationConfig>,
  signal: AbortSignal,
  dependencies: AiDependencies,
) {
  return async (payload: AiRequest): Promise<ChatResponse> => {
    const options = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({ model: config.model, ...payload }),
    } satisfies RequestInit
    let response: Response | undefined
    for (let retry = 0; retry < 3; retry++) {
      response = await (dependencies.request ?? fetch)(
        `${config.baseUrl}/chat/completions`,
        options,
      )
      if (response.status !== 429) break
      const seconds = Number(response.headers.get('retry-after'))
      if (
        retry === 2 ||
        !Number.isFinite(seconds) ||
        seconds <= 0 ||
        seconds > 60
      )
        break
      await response.arrayBuffer()
      await dependencies
        .onProgress?.(
          `⏳ AI 需要等待約 ${Math.ceil(seconds)} 秒，診斷仍在處理中…`,
        )
        .catch(() => {})
      if (dependencies.pause)
        await dependencies.pause(Math.ceil(seconds * 1000), signal)
      else await delay(Math.ceil(seconds * 1000), undefined, { signal })
    }
    if (!response) throw new Error('AI response missing')
    if (!response.ok) {
      // Record status only; upstream errors can contain signed URLs or request data.
      console.warn(`[consult] AI request failed (HTTP ${response.status})`)
      if (response.status === 413)
        throw new ConsultationError(
          '這次圖片或對話資料超過 AI 的單次容量，請減少圖片或將問題分開詢問。這不是金鑰設定錯誤。',
        )
      if (response.status === 429)
        throw new ConsultationError(
          'Groq 的 AI 請求／token 額度暫時受限，這不代表你已用完每日診斷題數。請稍後再試，或將比較拆成較小的問題。',
        )
      if (response.status === 401 || response.status === 403)
        throw new ConsultationError(
          'AI 金鑰驗證或存取權限失敗，請聯絡管理員檢查諮詢金鑰。',
        )
      if (response.status === 400)
        throw new ConsultationError(
          'AI 無法處理這次的圖片或查詢內容，請換一張圖片或將問題拆開後再試。',
        )
      throw new ConsultationError('AI 服務暫時無法使用，請稍後再試。')
    }
    return (await response.json()) as ChatResponse
  }
}
