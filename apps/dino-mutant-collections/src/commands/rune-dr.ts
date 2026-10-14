import { defineCommand } from '@dc/core'
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import {
  consultationConfig,
  consultationDay,
  consultationLimits,
} from '../consultation/config.js'
import {
  consultationChannelStore,
  consultationUsageStore,
} from '../consultation/store.js'

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('rune-dr')
    .setDescription('dr.大暴龍: configure your rune diagnosis clinic')
    .setDescriptionLocalizations({
      'zh-TW': 'dr.大暴龍的符文診間：設定只有 @Bot 時才回答的諮詢頻道',
    })
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub
        .setName('open')
        .setNameLocalizations({ 'zh-TW': '開診' })
        .setDescription('Enable AI consultation in a channel')
        .setDescriptionLocalizations({ 'zh-TW': '啟用指定頻道的 AI 諮詢' })
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setNameLocalizations({ 'zh-TW': '頻道' })
            .setDescription('Consultation channel; defaults to this channel')
            .setDescriptionLocalizations({
              'zh-TW': '諮詢頻道；未選擇時使用目前頻道',
            })
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setNameLocalizations({ 'zh-TW': '休診' })
        .setDescription('Disable consultation in a channel')
        .setDescriptionLocalizations({ 'zh-TW': '停用指定頻道的 AI 諮詢' })
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel; defaults to this channel')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setNameLocalizations({ 'zh-TW': '診間狀態' })
        .setDescription('Check consultation settings for a channel')
        .setDescriptionLocalizations({ 'zh-TW': '查看指定頻道的 AI 諮詢設定' })
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel; defaults to this channel')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .toJSON(),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: '這個指令只能在伺服器內使用。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)
    ) {
      await interaction.reply({
        content: '需要「管理頻道」權限才能設定諮詢。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    const channel =
      interaction.options.getChannel('channel') ?? interaction.channel
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: '請選擇一般文字頻道。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    const config = consultationConfig()
    const limits = consultationLimits()
    const subcommand = interaction.options.getSubcommand()
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    if (subcommand === 'open') {
      if (!config.enabled || !config.apiKey) {
        await interaction.editReply(
          '請先設定 `CONSULTATION_ENABLED=true` 與 AI API key，並重新啟動 Bot。',
        )
        return
      }
      const target = await interaction.guild.channels.fetch(channel.id)
      const bot = interaction.guild.members.me
      if (
        !target ||
        !bot ||
        !target
          .permissionsFor(bot)
          ?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ])
      ) {
        await interaction.editReply(
          'Bot 在這個頻道需要「查看頻道」、「傳送訊息」與「讀取訊息歷史」權限。',
        )
        return
      }
      await consultationChannelStore.set(
        interaction.guildId,
        channel.id,
        interaction.user.id,
      )
      await interaction.editReply(
        `🩺 dr.大暴龍在 <#${channel.id}> 開診了！成員在此頻道 @Bot 並輸入問題或附上圖片時，Bot 才會回答。每人每 ${limits.cooldownSeconds} 秒 1 題、每天 ${limits.userDaily} 題；全 Bot 每天 ${limits.botDaily} 題。問題與圖片會送至 AI 服務，Wiki 查詢會送至設定的 MCP 服務，請先告知頻道成員。`,
      )
      return
    }
    if (subcommand === 'close') {
      const removed = await consultationChannelStore.remove(
        interaction.guildId,
        channel.id,
      )
      await interaction.editReply(
        removed
          ? `🩺 dr.大暴龍在 <#${channel.id}> 休診了。`
          : '這個頻道尚未開診。',
      )
      return
    }
    const enabled = await consultationChannelStore.has(
      interaction.guildId,
      channel.id,
    )
    const usage = await consultationUsageStore.get(
      consultationDay(),
      interaction.user.id,
    )
    await interaction.editReply(
      `頻道：<#${channel.id}>\n諮詢：${enabled ? '已設定' : '未設定'}\n功能：${config.enabled ? '已啟用' : '尚未啟用'}\nAI 金鑰：${config.apiKey ? '已設定' : '未設定'}\n模型：${config.model}\n回覆方式：只有 @Bot 時回答\n冷卻：${limits.cooldownSeconds} 秒；同時處理 ${limits.concurrency} 題\n你的今日額度：${usage.user}/${limits.userDaily}\n全 Bot 今日額度：${usage.bot}/${limits.botDaily}\n額度於台灣時間午夜重設`,
    )
  },
})
