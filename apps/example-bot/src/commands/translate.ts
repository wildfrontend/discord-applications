import { defineCommand } from '@dc/core'
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import {
  isTranslationLanguage,
  languageChoices,
  languageNames,
} from '../translation/languages.js'
import {
  translationBindingStore,
  translationChannelLinkStore,
} from '../translation/store.js'

function bindingLabel(languageA: string, languageB: string): string {
  if (!isTranslationLanguage(languageA) || !isTranslationLanguage(languageB)) {
    return `${languageA} ↔ ${languageB}`
  }
  return `${languageNames[languageA]} ↔ ${languageNames[languageB]}`
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('translate')
    .setDescription('設定兩個頻道之間的雙向自動翻譯')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('link')
        .setDescription('將目前頻道與另一個語言頻道雙向連結')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('要連結的另一個文字頻道')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('current-language')
            .setDescription('目前頻道使用的語言')
            .setRequired(true)
            .addChoices(...languageChoices),
        )
        .addStringOption((option) =>
          option
            .setName('linked-language')
            .setDescription('另一個頻道使用的語言')
            .setRequired(true)
            .addChoices(...languageChoices),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('查看目前頻道的語言綁定'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('unlink')
        .setDescription('移除目前頻道的雙向翻譯連結'),
    )
    .toJSON(),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: '這個指令只能在伺服器頻道內使用。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const subcommand = interaction.options.getSubcommand()
    if (subcommand === 'status') {
      const link = await translationChannelLinkStore.get(interaction.channelId)
      const legacyBinding = link
        ? null
        : await translationBindingStore.get(interaction.channelId)
      const automatic = process.env.TRANSLATION_AUTO_ENABLED === 'true'
      const currentIsA = link?.channelAId === interaction.channelId
      const currentLanguage = link
        ? currentIsA
          ? link.languageA
          : link.languageB
        : null
      const linkedLanguage = link
        ? currentIsA
          ? link.languageB
          : link.languageA
        : null
      const linkedChannelId = link
        ? currentIsA
          ? link.channelBId
          : link.channelAId
        : null
      await interaction.reply({
        content:
          link && currentLanguage && linkedLanguage && linkedChannelId
            ? `這個頻道使用 **${languageNames[currentLanguage]}**，已和 <#${linkedChannelId}>（**${languageNames[linkedLanguage]}**）雙向連結。自動翻譯目前${automatic ? '已啟用' : '尚未啟用'}。`
            : legacyBinding
              ? `這個頻道仍有舊版 **${bindingLabel(legacyBinding.languageA, legacyBinding.languageB)}** 設定，可使用右鍵翻譯；尚未連結另一個頻道。`
              : '這個頻道尚未設定雙向翻譯連結。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)
    ) {
      await interaction.reply({
        content: '你需要「管理頻道」權限才能修改翻譯設定。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    if (subcommand === 'unlink') {
      const removed = await translationChannelLinkStore.remove(
        interaction.guildId,
        interaction.channelId,
      )
      await interaction.reply({
        content: removed
          ? '已移除兩個頻道之間的雙向翻譯連結。'
          : '這個頻道原本就沒有雙向翻譯連結。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const linkedChannel = interaction.options.getChannel('channel', true)
    const languageAValue = interaction.options.getString(
      'current-language',
      true,
    )
    const languageBValue = interaction.options.getString(
      'linked-language',
      true,
    )
    if (
      !isTranslationLanguage(languageAValue) ||
      !isTranslationLanguage(languageBValue)
    ) {
      await interaction.reply({
        content: '不支援選擇的語言。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (languageAValue === languageBValue) {
      await interaction.reply({
        content: '請選擇兩種不同的語言。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (
      linkedChannel.type !== ChannelType.GuildText ||
      linkedChannel.guildId !== interaction.guildId
    ) {
      await interaction.reply({
        content: '請選擇同一個伺服器內的文字頻道。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (linkedChannel.id === interaction.channelId) {
      await interaction.reply({
        content: '目前頻道不能和自己連結。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    const botMember = interaction.guild.members.me
    if (
      !botMember ||
      !linkedChannel
        .permissionsFor(botMember)
        .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
    ) {
      await interaction.reply({
        content: `Bot 在 ${linkedChannel} 缺少「查看頻道」或「傳送訊息」權限。`,
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    await translationChannelLinkStore.set(
      interaction.guildId,
      interaction.channelId,
      languageAValue,
      linkedChannel.id,
      languageBValue,
      interaction.user.id,
    )
    const automatic = process.env.TRANSLATION_AUTO_ENABLED === 'true'
    await interaction.reply({
      content: automatic
        ? `已建立雙向連結：<#${interaction.channelId}>（**${languageNames[languageAValue]}**）↔ ${linkedChannel}（**${languageNames[languageBValue]}**）。`
        : `已保存雙向連結，但自動翻譯尚未啟用；請設定 \`TRANSLATION_AUTO_ENABLED=true\` 並重新啟動 Bot。`,
      flags: MessageFlags.Ephemeral,
    })
  },
})
