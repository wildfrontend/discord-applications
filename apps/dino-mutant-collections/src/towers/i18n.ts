import type { TranslationLanguage } from '../translation/languages.js'

const japanese = {
  title: 'バフタワー｜日本時間 (UTC+9)｜占領可能時刻の目安',
  empty: '（未報告）',
  timingUtc: 'UTC時計で校正',
  timingMinute: '画像の分から推定',
  timingUpload: '投稿時刻基準',
  minuteNotice:
    '分からの推定は撮影後10分以内の投稿が前提です。時区表示のない古い画像は判別できないため、ゲーム時計のUTC表示を推奨します。',
  estimate:
    '画像の時刻を優先し、不明な場合は投稿時刻から推定。部族は最後の報告時点の情報です。',
  unreadable:
    '{count} 枚の画像を解析できませんでした。記録は変更していません。',
  unsupported:
    '{count} 枚の画像を解析できませんでした。対応形式は 20 MB 以下の PNG・JPEG・WebP です。',
  failed:
    '{count} 枚の画像を解析できませんでした。記録は変更していません。時間をおいて再投稿してください。',
  wrongServer:
    '別サーバーの画像 {count} 枚を除外しました。このチャンネルは {server} サーバー専用です。',
  noUpdate: '新しい記録があるため、既存の情報を維持しました。',
  cleanupMissing:
    '元の画像を削除できません。「メッセージの管理」権限を Bot に付与してください。',
  cleanupFailed:
    '処理は完了しましたが、元の画像を削除できませんでした。「メッセージの管理」権限を確認してください。',
  sourceChanged:
    '処理中に添付ファイルが変更されたため、元のメッセージは残しました。',
  sourceHasFiles:
    '画像以外のファイルも含まれるため、元のメッセージは残しました。',
  guildOnly: 'サーバーのテキストチャンネルで使用してください。',
  textChannelOnly: '通常のテキストチャンネルを選択してください。',
  manageChannels:
    '設定には、このチャンネルの「チャンネルの管理」権限が必要です。',
  botPermissions:
    'Bot に「チャンネルを見る」「メッセージを送信」「メッセージ履歴を読む」権限が必要です。',
  setup:
    '<#{channel}> を {server} サーバー専用に設定しました。対象：7・8・9・12・14・17・18・19 区。\n占領可能時刻＝画像から推定した撮影時刻（不明なら投稿時刻）＋シールド残り時間。表示は日本時間 UTC+9。画像付きの投稿は解析の成否にかかわらず処理後に削除します。サーバーを変更すると、このチャンネルの記録を消去します。',
  trackingDisabled:
    '画像検出は未有効です。TOWER_TRACKING_ENABLED=true と Discord Message Content Intent を有効にして Bot を再起動してください。',
  aiMissing: 'AI_API_KEY が未設定です。設定後に Bot を再起動してください。',
  disabled: 'このチャンネルのバフタワー追跡を停止し、記録を消去しました。',
  notConfigured:
    '追跡が未設定です。管理者が /tower setup server:27 を実行してください。',
}

export type TowerTextKey = keyof typeof japanese
const messages: Record<TranslationLanguage, Record<TowerTextKey, string>> = {
  ja: japanese,
  zt: {
    title: '增益塔｜日本時間 (UTC+9)｜預估可佔領時間',
    empty: '（留空）',
    timingUtc: 'UTC 校準',
    timingMinute: '分鐘推估',
    timingUpload: '上傳時間基準',
    minuteNotice:
      '分鐘推估以截圖後 10 分鐘內上傳為前提；沒有時區標示的舊圖無法可靠辨識，建議將遊戲時間切成 UTC。',
    estimate:
      '優先以圖片時間校準，無法判斷時沿用上傳時間；部落為最近截圖回報。',
    unreadable: '{count} 張圖片無法解析，原有紀錄保持不變。',
    unsupported:
      '{count} 張圖片無法解析；支援 20 MB 以內的 PNG、JPEG 或 WebP。',
    failed: '{count} 張圖片無法解析，原有紀錄保持不變；請稍後重新上傳。',
    wrongServer: '已忽略 {count} 張其他伺服器圖片；此頻道只記錄 {server} 服。',
    noUpdate: '已有較新的紀錄，保留原有資訊。',
    cleanupMissing: '無法刪除原圖；請為 Bot 開啟「管理訊息」權限。',
    cleanupFailed:
      '圖片已處理，但無法刪除原圖；請確認 Bot 的「管理訊息」權限。',
    sourceChanged: '處理期間附件已變更，因此保留原始訊息。',
    sourceHasFiles: '訊息包含圖片以外的檔案，因此保留原始訊息。',
    guildOnly: '請在伺服器文字頻道使用此指令。',
    textChannelOnly: '請選擇一般文字頻道。',
    manageChannels: '需要該頻道的「管理頻道」權限才能設定增益塔追蹤。',
    botPermissions:
      'Bot 需要該頻道的「檢視頻道」、「傳送訊息」與「讀取訊息歷史」權限。',
    setup:
      '已設定 <#{channel}> 只記錄 {server} 服的 7、8、9、12、14、17、18、19 區。\n可佔領時間＝圖片推定截圖時間（無法判斷時用上傳時間）＋護盾倒數，統一顯示日本時間 UTC+9。含圖片的訊息不論解析成功或失敗，處理後都會刪除。切換伺服器會清除該頻道的原有紀錄。',
    trackingDisabled:
      '尚未啟用圖片偵測：請設定 TOWER_TRACKING_ENABLED=true，啟用 Discord Message Content Intent 並重啟 Bot。',
    aiMissing: '尚未設定 AI_API_KEY；設定後重啟 Bot 才能辨識圖片。',
    disabled: '已停止此頻道的增益塔圖片偵測並清除紀錄。',
    notConfigured:
      '此頻道尚未設定增益塔追蹤，請管理員使用 /tower setup server:27。',
  },
  en: {
    title: 'Buff towers | Japan time (UTC+9) | Estimated capture time',
    empty: '(Not reported)',
    timingUtc: 'UTC clock',
    timingMinute: 'Minute estimate',
    timingUpload: 'Upload time',
    minuteNotice:
      'Minute estimates assume a fresh screenshot uploaded within 10 minutes. Old images without a timezone cannot be reliably dated; UTC game clocks are recommended.',
    estimate:
      'Uses the image clock when possible, otherwise upload time. Tribes reflect the latest screenshots.',
    unreadable: 'Could not parse {count} image(s). Existing records were kept.',
    unsupported:
      'Could not parse {count} image(s). Use PNG, JPEG, or WebP up to 20 MB.',
    failed:
      'Could not parse {count} image(s). Existing records were kept. Please upload again later.',
    wrongServer:
      'Ignored {count} image(s) from other servers. This channel tracks server {server} only.',
    noUpdate: 'Newer records already exist; existing information was kept.',
    cleanupMissing:
      'Could not remove the original images. Give the bot Manage Messages permission.',
    cleanupFailed:
      'Processing finished, but the original images could not be removed. Check the bot’s Manage Messages permission.',
    sourceChanged:
      'Attachments changed during processing, so the original message was kept.',
    sourceHasFiles:
      'The message contains other files, so the original message was kept.',
    guildOnly: 'Use this command in a server text channel.',
    textChannelOnly: 'Choose a regular text channel.',
    manageChannels:
      'You need Manage Channels permission in this channel to configure tower tracking.',
    botPermissions:
      'The bot needs View Channel, Send Messages, and Read Message History permissions.',
    setup:
      '<#{channel}> now tracks server {server}, areas 7, 8, 9, 12, 14, 17, 18, and 19.\nCapture time = estimated screenshot time (or upload time when unknown) + shield countdown, displayed in Japan time (UTC+9). Image posts are deleted after processing, including failed readings. Switching servers clears this channel’s records.',
    trackingDisabled:
      'Image detection is disabled. Set TOWER_TRACKING_ENABLED=true, enable Discord Message Content Intent, and restart the bot.',
    aiMissing:
      'AI_API_KEY is not configured. Configure it and restart the bot.',
    disabled: 'Tower tracking stopped and this channel’s records were cleared.',
    notConfigured:
      'Tracking is not configured. Ask an administrator to run /tower setup server:27.',
  },
  ko: {
    title: '버프 타워｜일본 시간 (UTC+9)｜예상 점령 가능 시각',
    empty: '（미보고）',
    timingUtc: 'UTC 시각 보정',
    timingMinute: '분 단위 추정',
    timingUpload: '업로드 시각 기준',
    minuteNotice:
      '분 단위 추정은 촬영 후 10분 이내 업로드를 전제로 합니다. 시간대 표시가 없는 오래된 이미지는 판별할 수 없으므로 게임 시계를 UTC로 설정해 주세요.',
    estimate:
      '가능하면 이미지 시각을 사용하고, 알 수 없으면 업로드 시각을 사용합니다. 부족은 마지막 스크린샷 기준입니다.',
    unreadable:
      '이미지 {count}장을 분석할 수 없습니다. 기존 기록은 유지됩니다.',
    unsupported:
      '이미지 {count}장을 분석할 수 없습니다. 20 MB 이하 PNG, JPEG, WebP를 사용해 주세요.',
    failed:
      '이미지 {count}장을 분석할 수 없습니다. 기존 기록은 유지됩니다. 잠시 후 다시 올려 주세요.',
    wrongServer:
      '다른 서버 이미지 {count}장을 제외했습니다. 이 채널은 {server} 서버만 기록합니다.',
    noUpdate: '더 최신 기록이 있어 기존 정보를 유지했습니다.',
    cleanupMissing:
      '원본 이미지를 삭제할 수 없습니다. 봇에 메시지 관리 권한을 부여해 주세요.',
    cleanupFailed:
      '처리는 완료했지만 원본 이미지를 삭제하지 못했습니다. 봇의 메시지 관리 권한을 확인해 주세요.',
    sourceChanged: '처리 중 첨부 파일이 변경되어 원본 메시지를 유지했습니다.',
    sourceHasFiles: '이미지 외의 파일도 포함되어 원본 메시지를 유지했습니다.',
    guildOnly: '서버의 텍스트 채널에서 사용해 주세요.',
    textChannelOnly: '일반 텍스트 채널을 선택해 주세요.',
    manageChannels: '타워 추적 설정에는 이 채널의 채널 관리 권한이 필요합니다.',
    botPermissions:
      '봇에 채널 보기, 메시지 보내기, 메시지 기록 보기 권한이 필요합니다.',
    setup:
      '<#{channel}>에서 {server} 서버의 7, 8, 9, 12, 14, 17, 18, 19구역을 기록합니다.\n점령 가능 시각＝이미지에서 추정한 촬영 시각(알 수 없으면 업로드 시각)＋보호막 남은 시간. 일본 시간 UTC+9로 표시합니다. 이미지 게시물은 분석 성공 여부와 관계없이 처리 후 삭제합니다. 서버를 변경하면 이 채널의 기록이 지워집니다.',
    trackingDisabled:
      '이미지 감지가 꺼져 있습니다. TOWER_TRACKING_ENABLED=true와 Discord Message Content Intent를 활성화한 후 봇을 다시 시작해 주세요.',
    aiMissing:
      'AI_API_KEY가 설정되지 않았습니다. 설정 후 봇을 다시 시작해 주세요.',
    disabled: '이 채널의 타워 추적을 중지하고 기록을 지웠습니다.',
    notConfigured:
      '추적이 설정되지 않았습니다. 관리자에게 /tower setup server:27 실행을 요청해 주세요.',
  },
}

export function towerLanguage(locale?: string | null): TranslationLanguage {
  if (locale?.startsWith('zh')) return 'zt'
  if (locale?.startsWith('en')) return 'en'
  if (locale === 'ko') return 'ko'
  return 'ja'
}

export function towerText(
  language: TranslationLanguage,
  key: TowerTextKey,
  values: Record<string, string | number> = {},
): string {
  return messages[language][key].replace(
    /\{(\w+)\}/g,
    (placeholder, name: string) => String(values[name] ?? placeholder),
  )
}
