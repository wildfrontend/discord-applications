import { defineCommand } from '@dc/core'
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventStatus,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { createRecurringSchedule } from '../recurring-events/service.js'
import { recurringEventStore } from '../recurring-events/store.js'
import type { RecurrenceUnit } from '../recurring-events/types.js'

const unitLabels: Record<RecurrenceUnit, string> = {
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
            .setDescription('每隔多少單位重複')
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
      const guild = await interaction.client.guilds.fetch(interaction.guildId)
      const events = await guild.scheduledEvents.fetch()
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
      await interaction.respond(
        schedules
          .filter((schedule) =>
            schedule.template.name.toLocaleLowerCase().includes(query),
          )
          .slice(0, 25)
          .map((schedule) => ({
            name: `${schedule.template.name}｜每 ${schedule.interval} ${unitLabels[schedule.unit]}`.slice(
              0,
              100,
            ),
            value: schedule.id,
          })),
      )
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

    if (subcommand === 'repeat') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
      const eventId = interaction.options.getString('activity', true)
      const interval = interaction.options.getInteger('every', true)
      const unit = interaction.options.getString('unit', true) as RecurrenceUnit
      const event = await interaction.guild.scheduledEvents.fetch(eventId)

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
      const canManageAll = interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageEvents,
      )
      const schedules = (
        await recurringEventStore.list(interaction.guildId)
      ).filter(
        (schedule) =>
          canManageAll || schedule.createdBy === interaction.user.id,
      )
      if (schedules.length === 0) {
        await interaction.reply({
          content: '目前沒有自訂重複活動。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      const content = schedules
        .map((schedule) => {
          const timestamp = Math.floor(Date.parse(schedule.nextStartAt) / 1000)
          return `• ${schedule.template.name}：每 ${schedule.interval} ${unitLabels[schedule.unit]}，下一個尚未建立的場次 <t:${timestamp}:F>`
        })
        .join('\n')
      await interaction.reply({ content, flags: MessageFlags.Ephemeral })
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
