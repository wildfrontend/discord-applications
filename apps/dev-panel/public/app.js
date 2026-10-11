const languageNames = {
  zt: '繁體中文',
  en: '英文',
  ja: '日文',
  ko: '韓文',
}

const unitNames = {
  seconds: '秒',
  minutes: '分鐘',
  hours: '小時',
  days: '天',
  weeks: '週',
}

const elements = {
  botStatus: document.querySelector('#bot-status'),
  refresh: document.querySelector('#refresh-button'),
  error: document.querySelector('#error-banner'),
  scheduleCount: document.querySelector('#schedule-count'),
  groupCount: document.querySelector('#group-count'),
  preferenceCount: document.querySelector('#preference-count'),
  databaseSize: document.querySelector('#database-size'),
  dataDirectory: document.querySelector('#data-directory'),
  scheduleTable: document.querySelector('#schedule-table'),
  scheduleEmpty: document.querySelector('#schedule-empty'),
  eventNotificationMeta: document.querySelector('#event-notification-meta'),
  groupList: document.querySelector('#group-list'),
  groupEmpty: document.querySelector('#group-empty'),
  preferenceList: document.querySelector('#preference-list'),
  preferenceEmpty: document.querySelector('#preference-empty'),
  translationMeta: document.querySelector('#translation-meta'),
  lastUpdated: document.querySelector('#last-updated'),
  settingsForm: document.querySelector('#settings-form'),
  settingsStatus: document.querySelector('#settings-status'),
  saveSettings: document.querySelector('#save-settings'),
  environmentFile: document.querySelector('#environment-file'),
  discordClientId: document.querySelector('#discord-client-id'),
  discordGuildId: document.querySelector('#discord-guild-id'),
  discordToken: document.querySelector('#discord-token'),
  discordTokenStatus: document.querySelector('#discord-token-status'),
  clearDiscordToken: document.querySelector('#clear-discord-token'),
  translationAutoEnabled: document.querySelector('#translation-auto-enabled'),
  aiApiKey: document.querySelector('#ai-api-key'),
  aiApiKeyStatus: document.querySelector('#ai-api-key-status'),
  clearAiApiKey: document.querySelector('#clear-ai-api-key'),
  aiModel: document.querySelector('#ai-model'),
  aiBaseUrl: document.querySelector('#ai-base-url'),
  aiProviderName: document.querySelector('#ai-provider-name'),
  aiRequestInterval: document.querySelector('#ai-request-interval'),
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '尚未建立'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 ** 2).toFixed(1)} MB`
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '時間無效'
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function shortId(value) {
  if (typeof value !== 'string') return '—'
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value
}

function textElement(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  element.textContent = text
  return element
}

function actionButton(action, id, label = '移除') {
  const button = textElement('button', 'button button-inline-danger', label)
  button.type = 'button'
  button.dataset.action = action
  button.dataset.id = id
  return button
}

function setEmpty(list, empty, isEmpty) {
  list.hidden = isEmpty
  empty.hidden = !isEmpty
}

function renderSchedules(schedules) {
  elements.scheduleTable.replaceChildren()
  setEmpty(
    elements.scheduleTable.closest('table'),
    elements.scheduleEmpty,
    schedules.length === 0,
  )
  for (const schedule of schedules) {
    const row = document.createElement('tr')
    const nameCell = document.createElement('td')
    nameCell.append(
      textElement('span', 'primary-value', schedule.name),
      textElement('span', 'secondary-value mono', shortId(schedule.id)),
    )
    const intervalCell = textElement(
      'td',
      '',
      `每 ${schedule.interval} ${unitNames[schedule.unit] || schedule.unit}`,
    )
    const nextCell = textElement('td', '', formatDate(schedule.nextStartAt))
    const creatorCell = textElement('td', 'mono', shortId(schedule.createdBy))
    const actionCell = document.createElement('td')
    actionCell.append(actionButton('remove-schedule', schedule.id))
    row.append(nameCell, intervalCell, nextCell, creatorCell, actionCell)
    elements.scheduleTable.append(row)
  }
}

function renderGroups(groups) {
  elements.groupList.replaceChildren()
  setEmpty(elements.groupList, elements.groupEmpty, groups.length === 0)
  for (const group of groups) {
    const card = document.createElement('article')
    card.className = 'data-card'
    const body = document.createElement('div')
    body.append(
      textElement('p', '', `分類 ${shortId(group.categoryId)}`),
      textElement('div', 'mono', `Guild ${shortId(group.guildId)}`),
    )
    const tags = document.createElement('div')
    tags.className = 'language-tags'
    for (const member of group.members) {
      tags.append(
        textElement(
          'span',
          'language-tag',
          `${languageNames[member.language] || member.language} · ${shortId(member.channelId)}`,
        ),
      )
    }
    body.append(tags)
    card.append(
      body,
      actionButton('remove-group', group.categoryId, '解除群組'),
    )
    elements.groupList.append(card)
  }
}

function renderPreferences(preferences) {
  elements.preferenceList.replaceChildren()
  setEmpty(
    elements.preferenceList,
    elements.preferenceEmpty,
    preferences.length === 0,
  )
  for (const preference of preferences) {
    const card = document.createElement('article')
    card.className = 'data-card'
    const body = document.createElement('div')
    body.append(
      textElement('p', 'mono', shortId(preference.userId)),
      textElement(
        'span',
        'secondary-value',
        `${languageNames[preference.language] || preference.language} · ${formatDate(preference.updatedAt)}`,
      ),
    )
    card.append(
      body,
      actionButton('remove-preference', preference.userId, '重設'),
    )
    elements.preferenceList.append(card)
  }
}

function render(data) {
  const totalDatabaseSize =
    (data.databases.recurringEvents.size || 0) +
    (data.databases.translations.size || 0)
  elements.scheduleCount.textContent = String(data.schedules.length)
  elements.groupCount.textContent = String(data.translation.groups.length)
  elements.preferenceCount.textContent = String(
    data.translation.preferences.length,
  )
  elements.databaseSize.textContent = formatBytes(totalDatabaseSize)
  elements.dataDirectory.textContent = data.panel.dataDirectory
  elements.lastUpdated.textContent = `最後同步 ${formatDate(data.panel.now)}`
  elements.translationMeta.textContent = `${data.translation.channelLinkCount} 組雙向連結 · ${data.translation.legacyBindingCount} 筆舊版綁定`
  elements.eventNotificationMeta.textContent =
    data.eventNotifications.length === 0
      ? '未設定通知頻道 · 刪除排程不會刪除 Discord 活動'
      : `通知頻道 ${data.eventNotifications.map((settings) => shortId(settings.channelId)).join('、')} · 刪除排程不會刪除 Discord 活動`

  elements.botStatus.className = `status-pill ${data.bot?.running ? 'is-online' : 'is-offline'}`
  elements.botStatus.textContent = data.bot?.running
    ? data.bot.source === 'health'
      ? 'Bot 運行中 · Docker'
      : `Bot 運行中 · PID ${data.bot.pid}`
    : 'Bot 未運行'

  renderSchedules(data.schedules)
  renderGroups(data.translation.groups)
  renderPreferences(data.translation.preferences)
}

function showError(message) {
  elements.error.textContent = message
  elements.error.hidden = false
}

function secretStatus(configured) {
  return configured ? '已設定' : '尚未設定'
}

function renderSettings(settings) {
  elements.environmentFile.textContent = settings.file
  elements.discordClientId.value = settings.discordClientId
  elements.discordGuildId.value = settings.discordGuildId
  elements.discordToken.value = ''
  elements.discordTokenStatus.textContent = secretStatus(
    settings.discordTokenConfigured,
  )
  elements.clearDiscordToken.checked = false
  elements.translationAutoEnabled.checked = settings.translationAutoEnabled
  elements.aiApiKey.value = ''
  elements.aiApiKeyStatus.textContent = secretStatus(
    settings.aiApiKeyConfigured,
  )
  elements.clearAiApiKey.checked = false
  elements.aiModel.value = settings.aiModel
  elements.aiBaseUrl.value = settings.aiBaseUrl
  elements.aiProviderName.value = settings.aiProviderName
  elements.aiRequestInterval.value = settings.aiMinRequestIntervalMs
}

async function loadSettings() {
  try {
    const response = await fetch('/api/settings', { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '無法讀取環境設定')
    renderSettings(data)
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error))
  }
}

async function loadDashboard() {
  elements.refresh.disabled = true
  try {
    const response = await fetch('/api/dashboard', { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '無法讀取資料')
    render(data)
    elements.error.hidden = true
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error))
  } finally {
    elements.refresh.disabled = false
  }
}

async function mutate(path, method, body) {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Dev-Panel-Action': '1',
    },
    body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '操作失敗')
  return result
}

async function runAction(button, path, method, confirmValue, message) {
  if (!window.confirm(message)) return
  button.disabled = true
  try {
    await mutate(path, method, { confirm: confirmValue })
    await loadDashboard()
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error))
  } finally {
    button.disabled = false
  }
}

elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!elements.settingsForm.reportValidity()) return
  elements.saveSettings.disabled = true
  elements.settingsStatus.className = ''
  elements.settingsStatus.textContent = '儲存中…'
  try {
    const result = await mutate('/api/settings', 'PUT', {
      discordClientId: elements.discordClientId.value,
      discordGuildId: elements.discordGuildId.value,
      discordToken: elements.discordToken.value,
      clearDiscordToken: elements.clearDiscordToken.checked,
      translationAutoEnabled: elements.translationAutoEnabled.checked,
      aiApiKey: elements.aiApiKey.value,
      clearAiApiKey: elements.clearAiApiKey.checked,
      aiModel: elements.aiModel.value,
      aiBaseUrl: elements.aiBaseUrl.value,
      aiProviderName: elements.aiProviderName.value,
      aiMinRequestIntervalMs: elements.aiRequestInterval.value,
    })
    renderSettings(result.settings)
    elements.settingsStatus.className = 'is-success'
    elements.settingsStatus.textContent =
      '已安全寫入 .env；請重啟 Bot 套用新設定。'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    elements.settingsStatus.className = 'is-error'
    elements.settingsStatus.textContent = message
    showError(message)
  } finally {
    elements.saveSettings.disabled = false
  }
})

document.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest('button')
  if (!(button instanceof HTMLButtonElement)) return

  const { action, id, reset } = button.dataset
  if (action === 'remove-schedule' && id) {
    void runAction(
      button,
      `/api/recurring/${id}`,
      'DELETE',
      id,
      '確定停止這個循環排程？已建立的 Discord 活動會保留。',
    )
  } else if (action === 'remove-group' && id) {
    void runAction(
      button,
      `/api/translation-groups/${id}`,
      'DELETE',
      id,
      '確定解除這個分類的翻譯群組？',
    )
  } else if (action === 'remove-preference' && id) {
    void runAction(
      button,
      `/api/preferences/${id}`,
      'DELETE',
      id,
      '確定重設這位使用者的預設翻譯語言？',
    )
  } else if (reset === 'recurring') {
    void runAction(
      button,
      '/api/reset/recurring',
      'POST',
      'recurring',
      '確定清除全部循環排程？已建立的 Discord 活動會保留。',
    )
  } else if (reset === 'preferences') {
    void runAction(
      button,
      '/api/reset/preferences',
      'POST',
      'preferences',
      '確定清除所有使用者的預設翻譯語言？',
    )
  } else if (reset === 'translations') {
    void runAction(
      button,
      '/api/reset/translations',
      'POST',
      'translations',
      '確定清除全部翻譯設定？分類群組、頻道連結與個人偏好都會被刪除。',
    )
  }
})

elements.refresh.addEventListener('click', () => void loadDashboard())
void loadDashboard()
void loadSettings()
setInterval(() => {
  if (!document.hidden) void loadDashboard()
}, 10_000)
