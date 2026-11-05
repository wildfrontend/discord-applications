import type { TranslationLanguage } from '../translation/languages.js'

const japanese = {
  uploadImages: '画像をアップロード',
  uploadTitle: '非公開のタワー画像アップロード',
  uploadDescription:
    'PNG・JPEG・WebPを1〜10枚、各20 MB以下。確認して公開するまでチャンネルには表示されません。',
  uploadFailed:
    'アップロードを処理できませんでした。再試行するか /tower draft で保存済みの下書きを確認してください。',
  title: 'バフタワー｜日本時間 (UTC+9)｜占領可能時刻の目安',
  empty: '（未報告）',
  draftNewEarly:
    '今はまだ期間内です。新しい期間を公開すると、現在の期間を終了して前回の総表を残します。',
  privateDraft: '非公開の下書き｜<#{channel}>｜まだ公開していません',
  publishCurrent: '今回を更新',
  publishPrevious: '前回を更新',
  publishNew: '新しい期間を作成',
  selectPeriod: '公開先の期間を選択',
  publishDraft: '公開する',
  cancelDraft: '下書きを破棄',
  draftAdvice:
    '推奨：{target}。公開先を選び、プレビューを確認してから「公開する」を押してください。',
  noDraft:
    '下書きはありません。「画像をアップロード」または /tower upload で非公開のアップロード画面を開いてください。',
  draftOwner: 'この下書きは別のユーザーのものです。',
  draftGone:
    '下書きは公開済み、破棄済み、またはチャンネル設定が変更されています。',
  draftStale:
    '画像が追加され、下書きが更新されました。最新の内容を確認してから公開してください。',
  draftCancelled: '下書きを破棄しました。公開済みの記録は変更していません。',
  publishDone: '公開しました：{url}',
  publishFailed:
    '公開できませんでした。下書きは保存されています。公開先を確認して再試行してください。',
  publishNoAccess: 'このチャンネルへの投稿権限がないため公開できません。',
  dmUnavailable:
    'DMを送信できません。ここで /tower draft を実行すると、自分だけが見られる下書きを確認できます。解析結果は公開していません。',
  period: '今回：{start} → {end}',
  previousReport: '前回の報告',
  timingUtc: 'UTC時計で校正',
  timeUncertain: '時刻に誤差の可能性あり',
  timeOld: '撮影から30分超・時刻に誤差の可能性あり',
  timingMinute: '画像の分から推定',
  timingUpload: '投稿時刻基準',
  minuteNotice:
    '時区表示がないため、30分以内の画像か確認できません。分から推定した時刻には誤差が生じる可能性があります。',
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
    '<#{channel}> を {server} サーバー専用に設定しました。対象：7・8・9・12・14・17・18・19 区。\n占領可能時刻＝画像から推定した撮影時刻（不明なら投稿時刻）＋シールド残り時間。表示は日本時間 UTC+9。/tower upload または「画像をアップロード」で非公開のアップロード画面を開いてください。確認して公開するまで総表に反映しません。サーバーを変更すると、このチャンネルの記録を消去します。',
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
    uploadImages: '上傳圖片',
    uploadTitle: '增益塔私人圖片上傳',
    uploadDescription:
      '每次 1–10 張 PNG、JPEG 或 WebP，每張上限 20 MB；確認發布前不會顯示在頻道。',
    uploadFailed:
      '圖片上傳處理失敗，請重試；已保存的草稿可使用 /tower draft 查看。',
    title: '增益塔｜日本時間 (UTC+9)｜預估可佔領時間',
    empty: '（留空）',
    draftNewEarly: '目前仍在本期範圍內；確認另開新期會結束本期，保留原總表。',
    privateDraft: '私人草稿｜<#{channel}>｜尚未發布',
    publishCurrent: '更新本期',
    publishPrevious: '更新前一期',
    publishNew: '另開新一期',
    selectPeriod: '選擇要發布的期別',
    publishDraft: '確認發布',
    cancelDraft: '取消草稿',
    draftAdvice:
      '建議：{target}。先選擇期別並確認預覽，按「確認發布」才會公開。',
    noDraft:
      '目前沒有待發布的草稿。請按「上傳圖片」或使用 /tower upload，開啟私人上傳視窗。',
    draftOwner: '這份草稿屬於其他使用者。',
    draftGone: '草稿已發布、取消，或頻道設定已變更。',
    draftStale: '有新圖片加入，草稿已更新；請確認最新預覽後再發布。',
    draftCancelled: '已取消草稿，公開紀錄保持不變。',
    publishDone: '已發布：{url}',
    publishFailed: '無法發布，草稿仍已保留；請確認期別後重試。',
    publishNoAccess: '你目前沒有此頻道的發送權限，無法發布。',
    dmUnavailable:
      'Bot 無法傳送私訊。請在此頻道使用 /tower draft，只有你能看到草稿；解析結果尚未公開。',
    period: '本期：{start} → {end}',
    previousReport: '前期回報',
    timingUtc: 'UTC 校準',
    timeUncertain: '可能有誤差',
    timeOld: '截圖超過 30 分鐘，可能有誤差',
    timingMinute: '分鐘推估',
    timingUpload: '上傳時間基準',
    minuteNotice:
      '未標時區，無法確認截圖是否在 30 分鐘內；已依分鐘推估，時間可能有誤差。',
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
      '已設定 <#{channel}> 只記錄 {server} 服的 7、8、9、12、14、17、18、19 區。\n可佔領時間＝圖片推定截圖時間（無法判斷時用上傳時間）＋護盾倒數，統一顯示日本時間 UTC+9。使用 /tower upload 或「上傳圖片」開啟私人上傳視窗，確認預覽並發布後才更新頻道總表。切換伺服器會清除該頻道的原有紀錄。',
    trackingDisabled:
      '尚未啟用圖片偵測：請設定 TOWER_TRACKING_ENABLED=true，啟用 Discord Message Content Intent 並重啟 Bot。',
    aiMissing: '尚未設定 AI_API_KEY；設定後重啟 Bot 才能辨識圖片。',
    disabled: '已停止此頻道的增益塔圖片偵測並清除紀錄。',
    notConfigured:
      '此頻道尚未設定增益塔追蹤，請管理員使用 /tower setup server:27。',
  },
  en: {
    uploadImages: 'Upload images',
    uploadTitle: 'Private tower screenshot upload',
    uploadDescription:
      '1–10 PNG, JPEG or WebP images, up to 20 MB each. Posted only after confirmation.',
    uploadFailed:
      'Could not process the upload. Try again, or use /tower draft to review any saved draft.',
    title: 'Buff towers | Japan time (UTC+9) | Estimated capture time',
    empty: '(Not reported)',
    draftNewEarly:
      'The current period is still open. Publishing a new period will close it and preserve its summary.',
    privateDraft: 'Private draft | <#{channel}> | Not published',
    publishCurrent: 'Update current period',
    publishPrevious: 'Update previous period',
    publishNew: 'Start a new period',
    selectPeriod: 'Choose a reporting period',
    publishDraft: 'Publish',
    cancelDraft: 'Discard draft',
    draftAdvice:
      'Suggested: {target}. Choose a period and review the preview before pressing Publish.',
    noDraft:
      'You have no pending draft. Press Upload images or use /tower upload to open a private upload window.',
    draftOwner: 'This draft belongs to another user.',
    draftGone:
      'This draft was published, discarded, or its channel configuration changed.',
    draftStale:
      'New images changed this draft. Review the latest preview before publishing.',
    draftCancelled: 'Draft discarded. Published records were kept.',
    publishDone: 'Published: {url}',
    publishFailed:
      'Publication failed. Your draft is saved; review the target period and try again.',
    publishNoAccess: 'You no longer have permission to post in this channel.',
    dmUnavailable:
      'The bot cannot send you DMs. Use /tower draft in this channel for a private preview. The analysis has not been published.',
    period: 'Period: {start} → {end}',
    previousReport: 'Previous report',
    timingUtc: 'UTC clock',
    timeUncertain: 'Time may be inaccurate',
    timeOld: 'Over 30 minutes old; time may be inaccurate',
    timingMinute: 'Minute estimate',
    timingUpload: 'Upload time',
    minuteNotice:
      'Without a timezone, we cannot confirm whether the screenshot is within 30 minutes of upload. The minute estimate may be inaccurate.',
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
      '<#{channel}> now tracks server {server}, areas 7, 8, 9, 12, 14, 17, 18, and 19.\nCapture time = estimated screenshot time (or upload time when unknown) + shield countdown, displayed in Japan time (UTC+9). Use /tower upload or Upload images for a private upload window. Review the private preview and confirm publication to update the channel summary. Switching servers clears this channel’s records.',
    trackingDisabled:
      'Image detection is disabled. Set TOWER_TRACKING_ENABLED=true, enable Discord Message Content Intent, and restart the bot.',
    aiMissing:
      'AI_API_KEY is not configured. Configure it and restart the bot.',
    disabled: 'Tower tracking stopped and this channel’s records were cleared.',
    notConfigured:
      'Tracking is not configured. Ask an administrator to run /tower setup server:27.',
  },
  ko: {
    uploadImages: '이미지 업로드',
    uploadTitle: '비공개 타워 이미지 업로드',
    uploadDescription:
      'PNG, JPEG, WebP 1~10장, 각 20 MB 이하. 게시를 확인하기 전에는 채널에 표시되지 않습니다.',
    uploadFailed:
      '업로드를 처리하지 못했습니다. 다시 시도하거나 /tower draft로 저장된 초안을 확인해 주세요.',
    title: '버프 타워｜일본 시간 (UTC+9)｜예상 점령 가능 시각',
    empty: '（미보고）',
    draftNewEarly:
      '아직 현재 기간 내입니다. 새 기간을 게시하면 현재 기간을 종료하고 이전 총표를 보관합니다.',
    privateDraft: '비공개 초안｜<#{channel}>｜아직 게시되지 않음',
    publishCurrent: '이번 기간 업데이트',
    publishPrevious: '이전 기간 업데이트',
    publishNew: '새 기간 시작',
    selectPeriod: '게시할 기간 선택',
    publishDraft: '게시 확인',
    cancelDraft: '초안 취소',
    draftAdvice:
      '추천: {target}. 기간을 선택하고 미리보기를 확인한 후 게시해 주세요.',
    noDraft:
      '대기 중인 초안이 없습니다. 이미지 업로드 버튼이나 /tower upload로 비공개 업로드 창을 열어 주세요.',
    draftOwner: '다른 사용자의 초안입니다.',
    draftGone: '초안이 게시 또는 취소되었거나 채널 설정이 변경되었습니다.',
    draftStale:
      '새 이미지로 초안이 변경되었습니다. 최신 미리보기를 확인해 주세요.',
    draftCancelled: '초안을 취소했습니다. 공개 기록은 유지됩니다.',
    publishDone: '게시 완료: {url}',
    publishFailed:
      '게시하지 못했습니다. 초안은 저장되어 있습니다. 기간을 확인하고 다시 시도해 주세요.',
    publishNoAccess: '이 채널에 메시지를 보낼 권한이 없어 게시할 수 없습니다.',
    dmUnavailable:
      '개인 메시지를 보낼 수 없습니다. 이 채널에서 /tower draft를 사용하면 본인만 초안을 볼 수 있습니다. 분석 결과는 공개되지 않았습니다.',
    period: '이번 기간: {start} → {end}',
    previousReport: '이전 보고',
    timingUtc: 'UTC 시각 보정',
    timeUncertain: '시간에 오차가 있을 수 있음',
    timeOld: '촬영 후 30분 초과·시간에 오차가 있을 수 있음',
    timingMinute: '분 단위 추정',
    timingUpload: '업로드 시각 기준',
    minuteNotice:
      '시간대 표시가 없어 촬영 후 30분 이내인지 확인할 수 없습니다. 분 단위 추정에는 오차가 있을 수 있습니다.',
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
      '<#{channel}>에서 {server} 서버의 7, 8, 9, 12, 14, 17, 18, 19구역을 기록합니다.\n점령 가능 시각＝이미지에서 추정한 촬영 시각(알 수 없으면 업로드 시각)＋보호막 남은 시간. 일본 시간 UTC+9로 표시합니다. /tower upload 또는 이미지 업로드 버튼으로 비공개 업로드 창을 열어 주세요. 미리보기를 확인하고 게시한 후에만 채널 총표를 변경합니다. 서버를 변경하면 이 채널의 기록이 지워집니다.',
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
