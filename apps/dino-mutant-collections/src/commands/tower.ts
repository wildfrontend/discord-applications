import { defineCommand } from '@dc/core'
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { renderTowerSummary } from '../towers/service.js'
import { towerStore } from '../towers/store.js'

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('tower')
    .setNameLocalizations({ 'zh-TW': '增益塔' })
    .setDescription('辨識增益塔截圖，追蹤佔領部落與可佔領時間')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('setup')
        .setNameLocalizations({ 'zh-TW': '設定' })
        .setDescription('將頻道綁定到指定遊戲伺服器（需要管理頻道權限）')
        .addIntegerOption((option) =>
          option
            .setName('server')
            .setNameLocalizations({ 'zh-TW': '伺服器' })
            .setDescription('遊戲伺服器編號，例如 27')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(999999),
        )
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setNameLocalizations({ 'zh-TW': '頻道' })
            .setDescription('接收截圖的文字頻道；留空使用目前頻道')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setNameLocalizations({ 'zh-TW': '列表' })
        .setDescription('查看目前頻道的八座增益塔與日本時間'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('disable')
        .setNameLocalizations({ 'zh-TW': '停用' })
        .setDescription('停止目前頻道的圖片偵測並清除紀錄（需要管理頻道權限）'),
    )
    .toJSON(),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: '請在伺服器文字頻道使用此指令。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    const action = interaction.options.getSubcommand()
    const channelId =
      action === 'setup'
        ? (interaction.options.getChannel('channel')?.id ??
          interaction.channelId)
        : interaction.channelId
    const channel = await interaction.guild.channels.fetch(channelId)
    if (channel?.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: '請選擇一般文字頻道。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (
      action !== 'list' &&
      !channel
        .permissionsFor(interaction.member)
        ?.has(PermissionFlagsBits.ManageChannels)
    ) {
      await interaction.reply({
        content: '需要該頻道的「管理頻道」權限才能設定增益塔追蹤。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    const me = interaction.guild.members.me
    if (
      action === 'setup' &&
      (!me ||
        !channel
          .permissionsFor(me)
          ?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ]))
    ) {
      await interaction.reply({
        content:
          'Bot 需要該頻道的「檢視頻道」、「傳送訊息」與「讀取訊息歷史」權限。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    await interaction.deferReply(
      action === 'list' ? {} : { flags: MessageFlags.Ephemeral },
    )
    if (action === 'setup') {
      const serverNumber = interaction.options.getInteger('server', true)
      await towerStore.bind(
        interaction.guildId,
        channel.id,
        serverNumber,
        interaction.user.id,
      )
      const warning =
        process.env.TOWER_TRACKING_ENABLED !== 'true'
          ? '\n尚未啟用圖片偵測：請設定 TOWER_TRACKING_ENABLED=true，啟用 Discord Message Content Intent 並重啟 Bot。'
          : !process.env.AI_API_KEY?.trim()
            ? '\n尚未設定 AI_API_KEY；設定後重啟 Bot 才能辨識圖片。'
            : ''
      await interaction.editReply({
        content: `已設定 <#${channel.id}> 只記錄 ${serverNumber} 服的 7、8、9、12、14、17、18、19 區。\n請上傳增益塔截圖；可佔領時間以圖片上傳時間＋護盾倒數計算，顯示日本時間 (UTC+9)。切換伺服器會清除原有紀錄。${warning}`,
        allowedMentions: { parse: [] },
      })
      return
    }
    if (action === 'disable') {
      await towerStore.disable(interaction.guildId, channel.id)
      await interaction.editReply('已停止此頻道的增益塔圖片偵測並清除紀錄。')
      return
    }
    const binding = await towerStore.getBinding(interaction.guildId, channel.id)
    await interaction.editReply({
      content: binding
        ? renderTowerSummary(
            binding.serverNumber,
            await towerStore.list(binding),
          )
        : '此頻道尚未設定增益塔追蹤，請管理員使用 /tower setup server:27。',
      allowedMentions: { parse: [] },
    })
  },
})
