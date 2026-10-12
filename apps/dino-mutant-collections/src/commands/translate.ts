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
  type TranslationLanguage,
} from '../translation/languages.js'
import { translateToLanguage } from '../translation/service.js'
import {
  translationBindingStore,
  translationChannelLinkStore,
  translationGroupStore,
  translationPreferenceStore,
} from '../translation/store.js'
import { sendTranslationWebhook } from '../translation/webhook.js'

const askEveryTimeValue = 'ask'
const autoDetectValue = 'auto'

function localizations(chinese: string, korean: string) {
  return { 'zh-TW': chinese, ko: korean }
}

function selectedLanguage(value: string | null): TranslationLanguage | null {
  return value && isTranslationLanguage(value) ? value : null
}

function bindingLabel(languageA: string, languageB: string): string {
  if (!isTranslationLanguage(languageA) || !isTranslationLanguage(languageB)) {
    return `${languageA} ↔ ${languageB}`
  }
  return `${languageNames[languageA]} ↔ ${languageNames[languageB]}`
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('translate')
    .setNameLocalizations(localizations('翻譯', '번역'))
    .setDescription('Translate messages or configure channel translation')
    .setDescriptionLocalizations(
      localizations(
        '翻譯訊息，或設定多語言頻道的自動翻譯',
        '메시지를 번역하거나 채널 번역을 설정합니다',
      ),
    )
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('send')
        .setNameLocalizations(localizations('發送', '전송'))
        .setDescription('Translate your text and send it to this channel')
        .setDescriptionLocalizations(
          localizations(
            '將輸入內容翻譯後公開傳送到目前頻道',
            '입력한 내용을 번역하여 현재 채널에 전송합니다',
          ),
        )
        .addStringOption((option) =>
          option
            .setName('message')
            .setNameLocalizations(localizations('訊息', '메시지'))
            .setDescription('Text to translate and send')
            .setDescriptionLocalizations(
              localizations('要翻譯並送出的內容', '번역하여 보낼 내용'),
            )
            .setRequired(true)
            .setMaxLength(4_000),
        )
        .addStringOption((option) =>
          option
            .setName('input-language')
            .setNameLocalizations(localizations('輸入語言', '입력언어'))
            .setDescription('Source language; defaults to your setting or auto')
            .setDescriptionLocalizations(
              localizations(
                '原文語言；未選擇時使用個人預設或自動偵測',
                '원문 언어. 생략하면 개인 기본값 또는 자동 감지를 사용합니다',
              ),
            )
            .addChoices(
              {
                name: 'Auto-detect',
                name_localizations: localizations('自動偵測', '자동 감지'),
                value: autoDetectValue,
              },
              ...languageChoices,
            ),
        )
        .addStringOption((option) =>
          option
            .setName('output-language')
            .setNameLocalizations(localizations('輸出語言', '출력언어'))
            .setDescription('Target language; defaults to your setting')
            .setDescriptionLocalizations(
              localizations(
                '譯文語言；未選擇時使用個人預設',
                '번역 언어. 생략하면 개인 기본값을 사용합니다',
              ),
            )
            .addChoices(...languageChoices),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('config')
        .setNameLocalizations(localizations('設定', '설정'))
        .setDescription('Set your default source and target languages')
        .setDescriptionLocalizations(
          localizations(
            '設定個人的預設輸入與輸出語言',
            '개인 기본 입력 및 출력 언어를 설정합니다',
          ),
        )
        .addStringOption((option) =>
          option
            .setName('input-language')
            .setNameLocalizations(localizations('輸入語言', '입력언어'))
            .setDescription('Your default source language')
            .setDescriptionLocalizations(
              localizations('你的預設輸入語言', '기본 입력 언어'),
            )
            .setRequired(true)
            .addChoices(
              {
                name: 'Auto-detect',
                name_localizations: localizations('自動偵測', '자동 감지'),
                value: autoDetectValue,
              },
              ...languageChoices,
            ),
        )
        .addStringOption((option) =>
          option
            .setName('output-language')
            .setNameLocalizations(localizations('輸出語言', '출력언어'))
            .setDescription('Your default target language')
            .setDescriptionLocalizations(
              localizations(
                '你的預設輸出語言；也可恢復為每次選擇',
                '기본 출력 언어. 매번 선택하도록 변경할 수도 있습니다',
              ),
            )
            .setRequired(true)
            .addChoices(...languageChoices, {
              name: 'Choose every time',
              name_localizations: localizations('每次手動選擇', '매번 선택'),
              value: askEveryTimeValue,
            }),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('group')
        .setNameLocalizations(localizations('群組', '그룹'))
        .setDescription('Create a translation group from category channels')
        .setDescriptionLocalizations(
          localizations(
            '將同一分類中的多個語言頻道設為同步翻譯群組',
            '같은 카테고리의 언어 채널로 번역 그룹을 만듭니다',
          ),
        )
        .addChannelOption((option) =>
          option
            .setName('category')
            .setNameLocalizations(localizations('分類', '카테고리'))
            .setDescription('Category containing the language channels')
            .setDescriptionLocalizations(
              localizations(
                '要設定多語言同步的分類',
                '언어 채널이 포함된 카테고리',
              ),
            )
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('chinese-channel')
            .setNameLocalizations(localizations('中文頻道', '중국어채널'))
            .setDescription('Traditional Chinese channel')
            .setDescriptionLocalizations(
              localizations('繁體中文頻道', '중국어(번체) 채널'),
            )
            .addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((option) =>
          option
            .setName('english-channel')
            .setNameLocalizations(localizations('英文頻道', '영어채널'))
            .setDescription('English channel')
            .setDescriptionLocalizations(localizations('英文頻道', '영어 채널'))
            .addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((option) =>
          option
            .setName('japanese-channel')
            .setNameLocalizations(localizations('日文頻道', '일본어채널'))
            .setDescription('Japanese channel')
            .setDescriptionLocalizations(
              localizations('日文頻道', '일본어 채널'),
            )
            .addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((option) =>
          option
            .setName('korean-channel')
            .setNameLocalizations(localizations('韓文頻道', '한국어채널'))
            .setDescription('Korean channel')
            .setDescriptionLocalizations(
              localizations('韓文頻道', '한국어 채널'),
            )
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('link')
        .setNameLocalizations(localizations('連結', '연결'))
        .setDescription('Link this channel with another language channel')
        .setDescriptionLocalizations(
          localizations(
            '將目前頻道與另一個語言頻道雙向連結',
            '현재 채널을 다른 언어 채널과 양방향으로 연결합니다',
          ),
        )
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setNameLocalizations(localizations('頻道', '채널'))
            .setDescription('The other text channel to link')
            .setDescriptionLocalizations(
              localizations(
                '要連結的另一個文字頻道',
                '연결할 다른 텍스트 채널',
              ),
            )
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('current-language')
            .setNameLocalizations(localizations('目前語言', '현재언어'))
            .setDescription('Language used in the current channel')
            .setDescriptionLocalizations(
              localizations(
                '目前頻道使用的語言',
                '현재 채널에서 사용하는 언어',
              ),
            )
            .setRequired(true)
            .addChoices(...languageChoices),
        )
        .addStringOption((option) =>
          option
            .setName('linked-language')
            .setNameLocalizations(localizations('連結語言', '연결언어'))
            .setDescription('Language used in the linked channel')
            .setDescriptionLocalizations(
              localizations(
                '另一個頻道使用的語言',
                '연결된 채널에서 사용하는 언어',
              ),
            )
            .setRequired(true)
            .addChoices(...languageChoices),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setNameLocalizations(localizations('狀態', '상태'))
        .setDescription('Show channel translation and personal defaults')
        .setDescriptionLocalizations(
          localizations(
            '查看目前頻道的語言綁定與個人預設',
            '채널 번역 설정과 개인 기본값을 표시합니다',
          ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('unlink')
        .setNameLocalizations(localizations('解除連結', '연결해제'))
        .setDescription('Remove the two-way translation link')
        .setDescriptionLocalizations(
          localizations(
            '移除目前頻道的雙向翻譯連結',
            '현재 채널의 양방향 번역 연결을 제거합니다',
          ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('ungroup')
        .setNameLocalizations(localizations('解除群組', '그룹해제'))
        .setDescription('Remove the translation group for this category')
        .setDescriptionLocalizations(
          localizations(
            '移除目前分類的多語言翻譯群組',
            '현재 카테고리의 다국어 번역 그룹을 제거합니다',
          ),
        ),
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
    if (subcommand === 'send') {
      const message = interaction.options.getString('message', true).trim()
      if (!message) {
        await interaction.reply({
          content: '請輸入要翻譯的內容。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      const channel = interaction.channel
      const botMember = interaction.guild.members.me
      if (channel?.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: '翻譯訊息目前只能從一般文字頻道送出。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }
      if (
        !botMember ||
        !channel
          .permissionsFor(botMember)
          .has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageWebhooks,
          ])
      ) {
        await interaction.reply({
          content:
            'Bot 在這個頻道需要「查看頻道」、「傳送訊息」與「管理 Webhook」權限，才能用你的暱稱和頭像送出翻譯。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      const preference = await translationPreferenceStore.get(
        interaction.user.id,
      )
      const inputOption = interaction.options.getString('input-language')
      const outputOption = interaction.options.getString('output-language')
      const source =
        inputOption === autoDetectValue
          ? null
          : (selectedLanguage(inputOption) ??
            preference?.sourceLanguage ??
            null)
      const target = selectedLanguage(outputOption) ?? preference?.language

      if (!target) {
        await interaction.reply({
          content:
            '請在 `output-language` 選擇輸出語言，或先用 `/translate config` 設定個人預設值。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }
      if (source === target) {
        await interaction.reply({
          content: '輸入語言與輸出語言不能相同。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
      try {
        const translated = await translateToLanguage(
          message,
          target,
          source ?? 'auto',
        )
        const content =
          translated.text.length <= 2_000
            ? translated.text
            : `${translated.text.slice(0, 1_999)}…`
        await sendTranslationWebhook(channel, interaction.client.user.id, {
          content,
          username: interaction.member.displayName,
          avatarURL: interaction.member.displayAvatarURL({
            extension: 'png',
            size: 128,
          }),
        })
        await interaction.editReply(
          `已用你的暱稱與頭像送出${languageNames[target]}翻譯。`,
        )
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error)
        await interaction.editReply(
          `翻譯或 Webhook 發送失敗：${details}`.slice(0, 1_900),
        )
      }
      return
    }

    if (subcommand === 'config') {
      const inputLanguage = interaction.options.getString(
        'input-language',
        true,
      )
      const outputLanguage = interaction.options.getString(
        'output-language',
        true,
      )
      if (outputLanguage === askEveryTimeValue) {
        await translationPreferenceStore.remove(interaction.user.id)
        await interaction.reply({
          content: '已清除個人語言預設；之後請在每次翻譯時選擇輸出語言。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }
      const source =
        inputLanguage === autoDetectValue
          ? null
          : selectedLanguage(inputLanguage)
      const target = selectedLanguage(outputLanguage)
      if ((inputLanguage !== autoDetectValue && !source) || !target) {
        await interaction.reply({
          content: '不支援選擇的語言。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }
      if (source === target) {
        await interaction.reply({
          content: '輸入語言與輸出語言不能相同。',
          flags: MessageFlags.Ephemeral,
        })
        return
      }
      await translationPreferenceStore.set(interaction.user.id, target, source)
      const sourceName = source ? languageNames[source] : '自動偵測'
      await interaction.reply({
        content: `個人翻譯預設已設定為 **${sourceName} → ${languageNames[target]}**；使用 \`/translate send\` 時仍可另外選擇語言覆寫。`,
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
        ? `你的個人翻譯預設為 **${preference.sourceLanguage ? languageNames[preference.sourceLanguage] : '自動偵測'} → ${languageNames[preference.language]}**；右鍵翻譯會使用相同的輸出語言。`
        : '你尚未設定個人翻譯預設；右鍵翻譯會每次詢問輸出語言。'
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
                  PermissionFlagsBits.ManageWebhooks,
                ]),
          )
        : selectedChannels[0]
      if (inaccessibleChannel) {
        await interaction.reply({
          content: `Bot 在 ${inaccessibleChannel.channel} 缺少「查看頻道」、「傳送訊息」或「管理 Webhook」權限。`,
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
          PermissionFlagsBits.ManageWebhooks,
        ])
    ) {
      await interaction.reply({
        content: `Bot 在 ${linkedChannel} 缺少「查看頻道」、「傳送訊息」或「管理 Webhook」權限。`,
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
