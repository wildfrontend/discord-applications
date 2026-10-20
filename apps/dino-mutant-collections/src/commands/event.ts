import { defineCommand } from '@dc/core'
import {
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventStatus,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import {
  MAX_REMINDER_TEMPLATE_LENGTH,
  renderReminderMessage,
  validateReminderTemplate,
} from '../recurring-events/message-template.js'
import { createRecurringSchedule } from '../recurring-events/service.js'
import {
  type EventNotificationSettings,
  eventNotificationStore,
  eventReminderStore,
  nativeEventId,
  nativeScheduleId,
  recurringEventStore,
} from '../recurring-events/store.js'
import type { RecurrenceUnit } from '../recurring-events/types.js'

const unitLabels: Record<RecurrenceUnit, string> = {
  seconds: '秒',
  minutes: '分鐘',
  hours: '小時',
  days: '天',
  weeks: '週',
}

function relativeStartLabel(timestamp: number | null): string {
  if (timestamp === null) return '時間未設定'
  const hours = Math.round((timestamp - Date.now()) / (60 * 60 * 1000))
  if (Math.abs(hours) < 48)
    return new Intl.RelativeTimeFormat('zh-TW').format(hours, 'hour')
  return new Intl.RelativeTimeFormat('zh-TW').format(
    Math.round(hours / 24),
    'day',
  )
}

function durationLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`
  if (minutes % 60 === 0) return `${minutes / 60} 小時`
  return `${minutes} 分鐘`
}

function timingLabel(
  settings: Pick<
    EventNotificationSettings,
    'remindBeforeMinutes' | 'remindBeforeEndMinutes' | 'repeatEveryMinutes'
  >,
): string {
  return [
    settings.remindBeforeMinutes > 0 &&
      `開始前 ${durationLabel(settings.remindBeforeMinutes)}`,
    settings.repeatEveryMinutes &&
      `進行中每 ${durationLabel(settings.repeatEveryMinutes)}`,
    settings.remindBeforeEndMinutes &&
      `結束前 ${durationLabel(settings.remindBeforeEndMinutes)}`,
  ]
    .filter(Boolean)
    .join('、')
}

function notificationLabel(settings: EventNotificationSettings | null): string {
  if (!settings?.enabled) return '關閉'
  return `<#${settings.channelId}>，${timingLabel(settings)}${settings.roleId ? `，標註 <@&${settings.roleId}>` : '，不標註身分組'}，${settings.messageTemplate ? '自訂訊息樣板' : '預設訊息樣板'}`
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('擴充 Discord 原生活動')
    .setDefaultMemberPermissions(PermissionFlagsBits.CreateEvents)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('repeat')
        .setDescription('替既有活動設定自訂重複頻率')
        .addStringOption((option) =>
          option
            .setName('activity')
            .setDescription('要重複的 Discord 活動')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('every')
            .setDescription('每隔多少單位重複（分鐘最少 15）')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(365),
        )
        .addStringOption((option) =>
          option
            .setName('unit')
            .setDescription('重複單位')
            .setRequired(true)
            .addChoices(
              { name: '分鐘（最少 15 分鐘）', value: 'minutes' },
              { name: '小時', value: 'hours' },
              { name: '天', value: 'days' },
              { name: '週', value: 'weeks' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('list').setDescription('查看自訂重複活動'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('notify')
        .setDescription(
          '設定活動提醒的頻道、身分組與時間（開始前、進行中、結束前）',
        )
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('活動開始前要發送提醒的頻道')
            .setRequired(true)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
            ),
        )
        .addStringOption((option) =>
          option
            .setName('schedule')
            .setDescription(
              '指定重複活動（自訂或 Discord 原生）；留空則設定伺服器共用提醒',
            )
            .setAutocomplete(true),
        )
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('提醒時要 @ 的身分組；留空則不標註'),
        )
        .addIntegerOption((option) =>
          option
            .setName('before')
            .setDescription(
              '開始前幾分鐘提醒；0 為不提醒，未設定任何時間時預設 30',
            )
            .setMinValue(0)
            .setMaxValue(10080),
        )
        .addIntegerOption((option) =>
          option
            .setName('end_before')
            .setDescription('結束前幾分鐘提醒（活動需有結束時間）')
            .setMinValue(1)
            .setMaxValue(10080),
        )
        .addIntegerOption((option) =>
          option
            .setName('every')
            .setDescription('活動進行中每隔幾分鐘提醒一次，例：240 = 每 4 小時')
            .setMinValue(15)
            .setMaxValue(10080),
        )
        .addStringOption((option) =>
          option
            .setName('message')
            .setDescription(
              '樣板：{name} {status} {time} {relative} {end} {end_relative} {url} {role}；\\n 換行，留空用預設',
            )
            .setMaxLength(MAX_REMINDER_TEMPLATE_LENGTH),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('notify-disable')
        .setDescription('關閉活動提醒')
        .addStringOption((option) =>
          option
            .setName('schedule')
            .setDescription(
              '指定重複活動（自訂或 Discord 原生）；留空則關閉共用提醒',
            )
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('notify-default')
        .setDescription('讓指定活動恢復使用伺服器共用提醒')
        .addStringOption((option) =>
          option
            .setName('schedule')
            .setDescription('要恢復共用提醒的重複活動')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('停止自訂重複活動（不刪除已建立的活動）')
        .addStringOption((option) =>
          option
            .setName('schedule')
            .setDescription('要停止的排程')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .toJSON(),

  async autocomplete(interaction) {
    if (!interaction.guildId) return interaction.respond([])

    const focused = interaction.options.getFocused(true)
    const query = String(focused.value).toLocaleLowerCase()

    if (focused.name === 'activity') {
      const guild = interaction.client.guilds.cache.get(interaction.guildId)
      if (!guild) {
        await interaction.respond([])
        return
      }
      const events = await guild.scheduledEvents.fetch().catch((error) => {
        const details = error instanceof Error ? error.message : String(error)
        console.error(
          `[events] Failed to fetch scheduled events for autocomplete in guild ${interaction.guildId}: ${details}`,
        )
        return null
      })
      if (!events) {
        await interaction.respond([])
        return
      }
      const canManageAll = interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageEvents,
      )
      const choices = events
        .filter(
          (event) =>
            event.status === GuildScheduledEventStatus.Scheduled &&
            event.entityType !== GuildScheduledEventEntityType.StageInstance &&
            !event.recurrenceRule &&
            (canManageAll || event.creatorId === interaction.user.id) &&
            event.name.toLocaleLowerCase().includes(query),
        )
        .sort(
          (left, right) =>
            (left.scheduledStartTimestamp ?? 0) -
            (right.scheduledStartTimestamp ?? 0),
        )
        .first(25)
        .map((event) => ({
          name: `${event.name}｜${relativeStartLabel(event.scheduledStartTimestamp)}`.slice(
            0,
            100,
          ),
          value: event.id,
        }))
      await interaction.respond(choices)
      return
    }

    if (focused.name === 'schedule') {
      const canManageAll = interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageEvents,
      )
      const schedules = (
        await recurringEventStore.list(interaction.guildId)
      ).filter(
        (schedule) =>
          canManageAll || schedule.createdBy === interaction.user.id,
      )
      const choices = schedules
        .filter((schedule) =>
          schedule.template.name.toLocaleLowerCase().includes(query),
        )
        .map((schedule) => ({
          name: `${schedule.template.name}｜每 ${schedule.interval} ${unitLabels[schedule.unit]}`.slice(
            0,
            100,
          ),
          value: schedule.id,
        }))
      // 提醒設定也可以選 Discord 原生重複活動。
      const subcommand = interaction.options.getSubcommand()
      if (canManageAll && ['notify', 'notify-disable'].includes(subcommand)) {
        const events = await interaction.client.guilds.cache
          .get(interaction.guildId)
          ?.scheduledEvents.fetch()
          .catch(() => null)
        for (const event of events?.values() ?? []) {
          if (
            event.recurrenceRule &&
            event.status === GuildScheduledEventStatus.Scheduled &&
            event.name.toLocaleLowerCase().includes(query)
          ) {
            choices.push({
              name: `${event.name}｜Discord 重複活動`.slice(0, 100),
              value: nativeScheduleId(event.id),
            })
          }
        }
      }
      await interaction.respond(choices.slice(0, 25))
      return
    }

    await interaction.respond([])
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: '這個指令只能在伺服器內使用。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const subcommand = interaction.options.getSubcommand()

    if (['notify', 'notify-disable', 'notify-default'].includes(subcommand)) {
      if (
        !interaction.memberPermissions.has(PermissionFlagsBits.ManageEvents)
      ) {
        await interaction.reply({
          content: '你需要「管理活動」權限才能修改活動提醒。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
      const scheduleId = interaction.options.getString('schedule') ?? undefined
      const nativeId = scheduleId ? nativeEventId(scheduleId) : null
      const nativeEvent = nativeId
        ? await interaction.guild.scheduledEvents
            .fetch(nativeId)
            .catch(() => null)
        : null
      const schedule =
        scheduleId && !nativeId
          ? (await recurringEventStore.list(interaction.guildId)).find(
              (item) => item.id === scheduleId,
            )
          : undefined
      const targetName = nativeEvent?.name ?? schedule?.template.name
      if (subcommand === 'notify-disable' && nativeId) {
        // 活動已被刪除時仍允許清除設定。
        await eventNotificationStore.remove(interaction.guildId, scheduleId)
        await interaction.editReply(
          `已關閉「${targetName ?? '已刪除的活動'}」的活動提醒。`,
        )
        return
      }
      if (nativeId && !nativeEvent?.recurrenceRule) {
        await interaction.editReply(
          '找不到這個 Discord 重複活動，請從 schedule 選單選擇活動。',
        )
        return
      }
      if (scheduleId && !nativeId && !schedule) {
        await interaction.editReply(
          '找不到這個重複排程，請從 schedule 選單選擇活動。',
        )
        return
      }

      if (subcommand === 'notify-default') {
        if (!scheduleId) {
          await interaction.editReply('請指定要恢復共用提醒的活動。')
          return
        }
        if (nativeId) {
          await interaction.editReply(
            'Discord 原生重複活動不使用共用提醒；要停止提醒請使用 /event notify-disable。',
          )
          return
        }
        await eventNotificationStore.remove(interaction.guildId, scheduleId)
        await interaction.editReply(
          `「${schedule?.template.name}」已恢復使用伺服器共用提醒。`,
        )
        return
      }

      if (subcommand === 'notify-disable') {
        if (scheduleId) {
          await eventNotificationStore.set(
            interaction.guildId,
            '',
            interaction.user.id,
            { scheduleId, enabled: false },
          )
        } else {
          await eventNotificationStore.remove(interaction.guildId)
        }
        await interaction.editReply(
          targetName
            ? `已關閉「${targetName}」的活動提醒。`
            : '已關閉伺服器共用提醒；活動個別設定的提醒仍會生效。',
        )
        return
      }

      const channel = interaction.options.getChannel('channel', true)
      if (
        (channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement) ||
        channel.guildId !== interaction.guildId
      ) {
        await interaction.editReply('請選擇這個伺服器內的文字或公告頻道。')
        return
      }
      const botMember =
        interaction.guild.members.me ??
        (await interaction.guild.members.fetchMe())
      if (
        !botMember ||
        !channel
          .permissionsFor(botMember)
          .has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
          ])
      ) {
        await interaction.editReply(
          `Bot 在 ${channel} 缺少「查看頻道」或「傳送訊息」權限。`,
        )
        return
      }

      const selectedRole = interaction.options.getRole('role')
      const role = selectedRole
        ? await interaction.guild.roles.fetch(selectedRole.id)
        : null
      if (selectedRole && (!role || role.id === interaction.guildId)) {
        await interaction.editReply(
          '請選擇這個伺服器內的身分組（不支援 @everyone）。',
        )
        return
      }
      if (
        role &&
        !role.mentionable &&
        !channel
          .permissionsFor(botMember)
          .has(PermissionFlagsBits.MentionEveryone)
      ) {
        await interaction.editReply(
          `Bot 無法標註 ${role}；請開啟該身分組的「允許任何人提及」，或授予 Bot 在 ${channel} 的「提及 @everyone、@here 和所有身分組」權限。`,
        )
        return
      }

      const endBefore = interaction.options.getInteger('end_before')
      const every = interaction.options.getInteger('every')
      // 只設定結束前或進行中提醒時，不再自動加上開始前提醒。
      const before =
        interaction.options.getInteger('before') ??
        (endBefore === null && every === null ? 30 : 0)
      if (
        before < 0 ||
        before > 10080 ||
        (endBefore !== null && (endBefore < 1 || endBefore > 10080)) ||
        (every !== null && (every < 15 || every > 10080))
      ) {
        await interaction.editReply(
          '提醒時間：開始前 0–10080 分鐘、結束前 1–10080 分鐘、進行中每 15–10080 分鐘。',
        )
        return
      }
      if (before === 0 && endBefore === null && every === null) {
        await interaction.editReply(
          '請至少設定一種提醒：before、end_before 或 every。',
        )
        return
      }
      const timing = {
        remindBeforeMinutes: before,
        remindBeforeEndMinutes: endBefore,
        repeatEveryMinutes: every,
      }

      const messageTemplate = interaction.options.getString('message')
      if (messageTemplate !== null) {
        try {
          validateReminderTemplate(messageTemplate, role?.id ?? null)
        } catch (error) {
          await interaction.editReply(
            error instanceof Error ? error.message : '提醒訊息樣板格式錯誤。',
          )
          return
        }
      }

      await eventNotificationStore.set(
        interaction.guildId,
        channel.id,
        interaction.user.id,
        {
          scheduleId,
          roleId: role?.id,
          ...timing,
          messageTemplate,
        },
      )
      if (
        nativeEvent?.scheduledStartTimestamp &&
        nativeEvent.scheduledStartTimestamp > Date.now()
      ) {
        await eventReminderStore.trackOccurrence(
          nativeScheduleId(nativeEvent.id),
          nativeEvent.id,
          nativeEvent.scheduledStartTimestamp,
          nativeEvent.scheduledEndTimestamp,
        )
      }
      await interaction.editReply(
        `${targetName ? `「${targetName}」` : '伺服器共用'}提醒已設定：${timingLabel(timing)}，發送到 ${channel}${role ? `，標註 ${role}` : '，不標註身分組'}。${messageTemplate !== null ? '\n以下為訊息樣板預覽：' : ''}`,
      )
      if (messageTemplate !== null) {
        const sourceEvent =
          nativeEvent ??
          (schedule
            ? await interaction.guild.scheduledEvents
                .fetch(schedule.latestEventId)
                .catch(() => null)
            : null)
        const preview = renderReminderMessage(
          {
            name: sourceEvent?.name ?? targetName ?? '活動名稱',
            url:
              sourceEvent?.url ??
              `https://discord.com/events/${interaction.guildId}/活動ID`,
            scheduledStartTimestamp:
              sourceEvent?.scheduledStartTimestamp ??
              Date.now() + before * 60_000,
            scheduledEndTimestamp: sourceEvent?.scheduledEndTimestamp,
          },
          role?.id ?? null,
          messageTemplate,
          before > 0 ? 'start' : every !== null ? 'during' : 'end',
        )
        await interaction.followUp({
          content: preview,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        })
      }
      return
    }

    if (subcommand === 'repeat') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
      const eventId = interaction.options.getString('activity', true)
      const interval = interaction.options.getInteger('every', true)
      const unit = interaction.options.getString('unit', true) as RecurrenceUnit

      if (unit === 'seconds') {
        await interaction.editReply(
          '秒級排程已停用，請重新執行指令並選擇分鐘以上的單位。',
        )
        return
      }
      if (unit === 'minutes' && interval < 15) {
        await interaction.editReply(
          'Discord 活動的分鐘週期最少為 15 分鐘，請將 every 設為 15 以上。',
        )
        return
      }

      const events = await interaction.guild.scheduledEvents.fetch()
      const exactNameMatches = events.filter(
        (candidate) =>
          candidate.name.toLocaleLowerCase() === eventId.toLocaleLowerCase(),
      )

      if (!/^\d{17,20}$/.test(eventId) && exactNameMatches.size > 1) {
        await interaction.editReply(
          '有多個同名活動。請重新執行指令，並從 activity 選單選擇正確的活動。',
        )
        return
      }

      const event = /^\d{17,20}$/.test(eventId)
        ? events.get(eventId)
        : exactNameMatches.first()

      if (!event) {
        await interaction.editReply(
          '找不到這個活動。請重新執行指令，並從 activity 選單選擇活動。',
        )
        return
      }

      const canManageAll = interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageEvents,
      )
      if (!canManageAll && event.creatorId !== interaction.user.id) {
        await interaction.editReply('你只能替自己建立的活動設定週期。')
        return
      }

      if (event.entityType === GuildScheduledEventEntityType.StageInstance) {
        await interaction.editReply(
          '第一版暫不支援 Stage 活動，請使用語音頻道或「其他地方」。',
        )
        return
      }

      if (event.recurrenceRule) {
        await interaction.editReply('這個活動已經使用 Discord 原生重複規則。')
        return
      }

      const schedule = await createRecurringSchedule(
        interaction.client,
        event,
        interaction.user.id,
        interval,
        unit,
      )
      const nextTimestamp = Math.floor(Date.parse(schedule.nextStartAt) / 1000)
      await interaction.editReply(
        `已替「${event.name}」設定每 ${interval} ${unitLabels[unit]}重複。下一場活動已建立；再下一場的時間是 <t:${nextTimestamp}:F>。`,
      )
      return
    }

    if (subcommand === 'list') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
      const notification = await eventNotificationStore.get(interaction.guildId)
      const canManageAll = interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageEvents,
      )
      const schedules = (
        await recurringEventStore.list(interaction.guildId)
      ).filter(
        (schedule) =>
          canManageAll || schedule.createdBy === interaction.user.id,
      )
      const nativeSettings = canManageAll
        ? await eventNotificationStore.listNative(interaction.guildId)
        : []
      if (schedules.length === 0 && nativeSettings.length === 0) {
        await interaction.editReply(
          `目前沒有自訂重複活動。\n共用提醒：${notificationLabel(notification)}`,
        )
        return
      }

      const nativeLines = await Promise.all(
        nativeSettings.map(async (settings) => {
          const event = await interaction.guild.scheduledEvents
            .fetch(settings.eventId)
            .catch(() => null)
          const start = event?.scheduledStartTimestamp
          return `• ${event?.name ?? '（活動已刪除）'}：Discord 重複活動${start ? `，下一場 <t:${Math.floor(start / 1000)}:F>` : ''}\n  提醒：${notificationLabel(settings)}`
        }),
      )
      const content = [
        ...(await Promise.all(
          schedules.map(async (schedule) => {
            const timestamp = Math.floor(
              Date.parse(schedule.nextStartAt) / 1000,
            )
            const override = await eventNotificationStore.get(
              interaction.guildId,
              schedule.id,
            )
            return `• ${schedule.template.name}：每 ${schedule.interval} ${unitLabels[schedule.unit]}，下一個尚未建立的場次 <t:${timestamp}:F>\n  提醒：${notificationLabel(override ?? notification)}${override ? '' : '（共用設定）'}`
          }),
        )),
        ...nativeLines,
      ].join('\n')
      // 多個活動分段回覆，避免超過 Discord 的單則訊息限制。
      const chunks: string[] = []
      let chunk = ''
      for (const line of `${content}\n共用提醒：${notificationLabel(notification)}`.split(
        '\n',
      )) {
        if (chunk.length + line.length + 1 > 1900) {
          chunks.push(chunk)
          chunk = ''
        }
        chunk += `${chunk ? '\n' : ''}${line}`
      }
      if (chunk) chunks.push(chunk)
      await interaction.editReply(chunks[0])
      for (const content of chunks.slice(1)) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral })
      }
      return
    }

    const scheduleId = interaction.options.getString('schedule', true)
    const schedule = (await recurringEventStore.list(interaction.guildId)).find(
      (candidate) => candidate.id === scheduleId,
    )
    const canManageAll = interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageEvents,
    )
    if (
      schedule &&
      !canManageAll &&
      schedule.createdBy !== interaction.user.id
    ) {
      await interaction.reply({
        content: '你只能停止自己建立的重複排程。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    const removed = await recurringEventStore.remove(
      interaction.guildId,
      scheduleId,
    )
    await interaction.reply({
      content: removed
        ? '已停止自訂重複；已經建立的 Discord 活動不會被刪除。'
        : '找不到這個重複排程。',
      flags: MessageFlags.Ephemeral,
    })
  },
})
