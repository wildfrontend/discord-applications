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
  translationGroupStore,
  translationPreferenceStore,
} from '../translation/store.js'

const askEveryTimeValue = 'ask'

function bindingLabel(languageA: string, languageB: string): string {
  if (!isTranslationLanguage(languageA) || !isTranslationLanguage(languageB)) {
    return `${languageA} ↔ ${languageB}`
  }
  return `${languageNames[languageA]} ↔ ${languageNames[languageB]}`
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('translate')
    .setDescription('設定多語言頻道之間的自動翻譯')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('config')
        .setDescription('設定右鍵手動翻譯的個人目標語言')
        .addStringOption((option) =>
          option
            .setName('language')
            .setDescription('預設翻譯語言；也可以恢復為每次手動選擇')
            .setRequired(true)
            .addChoices(...languageChoices, {
              name: '每次手動選擇',
              value: askEveryTimeValue,
            }),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('group')
        .setDescription('將同一分類中的多個語言頻道設為同步翻譯群組')
        .addChannelOption((option) =>
          option
            .setName('category')
            .setDescription('要設定多語言同步的分類')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('chinese-channel')
            .setDescription('繁體中文頻道')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((option) =>
          option
            .setName('english-channel')
            .setDescription('英文頻道')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((option) =>
          option
            .setName('japanese-channel')
            .setDescription('日文頻道')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((option) =>
          option
            .setName('korean-channel')
            .setDescription('韓文頻道')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
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
      subcommand.setName('unlink').setDescription('移除目前頻道的雙向翻譯連結'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('ungroup')
        .setDescription('移除目前分類的多語言翻譯群組'),
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
    if (subcommand === 'config') {
      const language = interaction.options.getString('language', true)
      if (language === askEveryTimeValue) {
        await translationPreferenceStore.remove(interaction.user.id)
        await interaction.reply({
          content: '已改為每次手動選擇翻譯語言。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }
      if (!isTranslationLanguage(language)) {
        await interaction.reply({
          content: '不支援選擇的語言。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }
      await translationPreferenceStore.set(interaction.user.id, language)
      await interaction.reply({
        content: `個人翻譯語言已設定為 **${languageNames[language]}**；之後右鍵翻譯會直接使用這個語言。`,
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    if (subcommand === 'status') {
      const preference = await translationPreferenceStore.get(
        interaction.user.id,
      )
      const groupMember = await translationGroupStore.getMember(
        interaction.channelId,
      )
      const groupMembers = groupMember
        ? await translationGroupStore.list(groupMember.categoryId)
        : []
      const link = groupMember
        ? null
        : await translationChannelLinkStore.get(interaction.channelId)
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
      const channelStatus = groupMember
        ? `這個分類已設定多語言同步：\n${groupMembers
            .map(
              (member) =>
                `• <#${member.channelId}>：**${languageNames[member.language]}**`,
            )
            .join('\n')}\n自動翻譯目前${automatic ? '已啟用' : '尚未啟用'}。`
        : link && currentLanguage && linkedLanguage && linkedChannelId
          ? `這個頻道使用 **${languageNames[currentLanguage]}**，已和 <#${linkedChannelId}>（**${languageNames[linkedLanguage]}**）雙向連結。自動翻譯目前${automatic ? '已啟用' : '尚未啟用'}。`
          : legacyBinding
            ? `這個頻道仍有舊版 **${bindingLabel(legacyBinding.languageA, legacyBinding.languageB)}** 設定，可使用右鍵翻譯；尚未連結另一個頻道。`
            : '這個頻道尚未設定雙向翻譯連結。'
      const preferenceStatus = preference
        ? `你的右鍵翻譯預設為 **${languageNames[preference.language]}**。`
        : '你的右鍵翻譯目前會每次詢問目標語言。'
      await interaction.reply({
        content: `${channelStatus}\n${preferenceStatus}`,
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

    if (subcommand === 'ungroup') {
      const member = await translationGroupStore.getMember(
        interaction.channelId,
      )
      const removed = member
        ? await translationGroupStore.remove(
            interaction.guildId,
            member.categoryId,
          )
        : false
      await interaction.reply({
        content: removed
          ? '已移除這個分類的多語言同步翻譯設定。'
          : '目前頻道不屬於多語言翻譯群組。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    if (subcommand === 'group') {
      const category = interaction.options.getChannel('category', true)
      if (
        category.type !== ChannelType.GuildCategory ||
        category.guildId !== interaction.guildId
      ) {
        await interaction.reply({
          content: '請選擇這個伺服器內的分類。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      const selectedChannels = [
        {
          language: 'zt' as const,
          channel: interaction.options.getChannel('chinese-channel'),
        },
        {
          language: 'en' as const,
          channel: interaction.options.getChannel('english-channel'),
        },
        {
          language: 'ja' as const,
          channel: interaction.options.getChannel('japanese-channel'),
        },
        {
          language: 'ko' as const,
          channel: interaction.options.getChannel('korean-channel'),
        },
      ].flatMap((entry) =>
        entry.channel
          ? [{ language: entry.language, channel: entry.channel }]
          : [],
      )

      if (selectedChannels.length < 2) {
        await interaction.reply({
          content: '請至少選擇兩個不同語言的頻道。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }
      if (
        selectedChannels.some(
          (entry) =>
            entry.channel.type !== ChannelType.GuildText ||
            entry.channel.guildId !== interaction.guildId,
        )
      ) {
        await interaction.reply({
          content: '所有頻道都必須是同一個伺服器內的文字頻道。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      const channelIds = selectedChannels.map((entry) => entry.channel.id)
      if (new Set(channelIds).size !== channelIds.length) {
        await interaction.reply({
          content: '每種語言必須選擇不同的頻道。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (
        selectedChannels.some((entry) => entry.channel.parentId !== category.id)
      ) {
        await interaction.reply({
          content: `所有語言頻道都必須位於「${category.name}」分類中。`,
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      const botMember = interaction.guild.members.me
      const inaccessibleChannel = botMember
        ? selectedChannels.find(
            (entry) =>
              !entry.channel
                .permissionsFor(botMember)
                .has([
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                ]),
          )
        : selectedChannels[0]
      if (inaccessibleChannel) {
        await interaction.reply({
          content: `Bot 在 ${inaccessibleChannel.channel} 缺少「查看頻道」或「傳送訊息」權限。`,
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      const members = await translationGroupStore.replace(
        interaction.guildId,
        category.id,
        selectedChannels.map((entry) => ({
          channelId: entry.channel.id,
          language: entry.language,
        })),
        interaction.user.id,
      )
      await Promise.all(
        members.map((member) =>
          translationChannelLinkStore.remove(
            interaction.guildId,
            member.channelId,
          ),
        ),
      )
      const automatic = process.env.TRANSLATION_AUTO_ENABLED === 'true'
      await interaction.reply({
        content: `已建立「${category.name}」多語言同步群組：\n${members
          .map(
            (member) =>
              `• <#${member.channelId}>：**${languageNames[member.language]}**`,
          )
          .join(
            '\n',
          )}\n自動翻譯目前${automatic ? '已啟用' : '尚未啟用；請設定 `TRANSLATION_AUTO_ENABLED=true` 並重新啟動 Bot'}。`,
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
        .has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
        ])
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
