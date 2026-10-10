import { defineCommand } from '@dc/core'
import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import {
  isTranslationLanguage,
  languageChoices,
  languageNames,
} from '../translation/languages.js'
import { translationBindingStore } from '../translation/store.js'

function bindingLabel(languageA: string, languageB: string): string {
  if (!isTranslationLanguage(languageA) || !isTranslationLanguage(languageB)) {
    return `${languageA} ↔ ${languageB}`
  }
  return `${languageNames[languageA]} ↔ ${languageNames[languageB]}`
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('translate')
    .setDescription('設定目前頻道的雙向自動翻譯')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('bind')
        .setDescription('綁定目前頻道的兩種翻譯語言')
        .addStringOption((option) =>
          option
            .setName('language-a')
            .setDescription('第一種語言')
            .setRequired(true)
            .addChoices(...languageChoices),
        )
        .addStringOption((option) =>
          option
            .setName('language-b')
            .setDescription('第二種語言')
            .setRequired(true)
            .addChoices(...languageChoices),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('查看目前頻道的語言綁定'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('unbind').setDescription('停止目前頻道的自動翻譯'),
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
      const binding = await translationBindingStore.get(interaction.channelId)
      const automatic = process.env.TRANSLATION_AUTO_ENABLED === 'true'
      await interaction.reply({
        content: binding
          ? `這個頻道已綁定：**${bindingLabel(binding.languageA, binding.languageB)}**。自動翻譯目前${automatic ? '已啟用' : '尚未啟用（右鍵翻譯仍可使用）'}。`
          : '這個頻道尚未設定自動翻譯。',
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

    if (subcommand === 'unbind') {
      const removed = await translationBindingStore.remove(
        interaction.guildId,
        interaction.channelId,
      )
      await interaction.reply({
        content: removed
          ? '已停止這個頻道的自動翻譯。右鍵手動翻譯仍可使用。'
          : '這個頻道原本就沒有自動翻譯設定。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const languageAValue = interaction.options.getString('language-a', true)
    const languageBValue = interaction.options.getString('language-b', true)
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

    await translationBindingStore.set(
      interaction.guildId,
      interaction.channelId,
      languageAValue,
      languageBValue,
      interaction.user.id,
    )
    const automatic = process.env.TRANSLATION_AUTO_ENABLED === 'true'
    await interaction.reply({
      content: automatic
        ? `已將這個頻道綁定為 **${bindingLabel(languageAValue, languageBValue)}**。兩種語言會自動互譯。`
        : `已保存 **${bindingLabel(languageAValue, languageBValue)}** 綁定。右鍵翻譯可直接使用；頻道自動翻譯需先開啟 Message Content Intent，並設定 \`TRANSLATION_AUTO_ENABLED=true\`。`,
      flags: MessageFlags.Ephemeral,
    })
  },
})
