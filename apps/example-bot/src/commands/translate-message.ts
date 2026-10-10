import { defineMessageCommand } from '@dc/core'
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  MessageFlags,
} from 'discord.js'
import { targetLanguageSelect } from '../translation/components.js'
import {
  type CompletedTranslation,
  translateAcrossBinding,
  translateToLanguage,
  translationContent,
} from '../translation/service.js'
import {
  translationBindingStore,
  translationChannelLinkStore,
} from '../translation/store.js'

export default defineMessageCommand({
  data: new ContextMenuCommandBuilder()
    .setName('翻譯這則訊息')
    .setType(ApplicationCommandType.Message)
    .setDMPermission(false)
    .toJSON(),

  async execute(interaction) {
    const message = interaction.targetMessage
    if (!message.content.trim()) {
      await interaction.reply({
        content: '這則訊息沒有可翻譯的文字。',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const link = await translationChannelLinkStore.get(interaction.channelId)
    const binding = link
      ? null
      : await translationBindingStore.get(interaction.channelId)
    if (!link && !binding) {
      await interaction.reply({
        content: '請選擇目標語言：',
        components: [targetLanguageSelect(interaction.channelId, message.id)],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    let translated: CompletedTranslation | null
    try {
      if (link) {
        const target =
          link.channelAId === interaction.channelId
            ? link.languageB
            : link.languageA
        translated = await translateToLanguage(message.content, target)
      } else {
        translated = await translateAcrossBinding(message.content, binding!)
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error)
      await interaction.editReply(
        `翻譯服務目前無法使用：${details}`.slice(0, 1900),
      )
      return
    }
    if (!translated) {
      await interaction.editReply({
        content: '無法確定原文屬於哪一種綁定語言，請手動選擇目標語言：',
        components: [
          targetLanguageSelect(interaction.channelId, message.id, [
            ...(binding ? [binding.languageA, binding.languageB] : []),
          ]),
        ],
      })
      return
    }

    await interaction.editReply({
      content: translationContent(translated),
      allowedMentions: { parse: [] },
    })
  },
})
