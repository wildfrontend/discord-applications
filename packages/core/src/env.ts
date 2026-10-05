/**
 * 讀取必要的環境變數，缺少時直接拋錯，避免 bot 帶著錯誤設定啟動。
 */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}
