import { defineCommand } from '@dc/core'
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js'
import { towerDraftPreview } from '../towers/draft-flow.js'
import { towerDraftStore } from '../towers/drafts.js'
import { type TowerTextKey, towerLanguage, towerText } from '../towers/i18n.js'
import { renderTowerSummary } from '../towers/service.js'
import { towerStore } from '../towers/store.js'
import { showTowerUpload } from '../towers/upload-flow.js'
import { towerUploadRow } from '../towers/upload-ui.js'

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('tower')
    .setNameLocalizations({
      'zh-TW': '增益塔',
      ja: 'バフタワー',
      ko: '버프타워',
    })
    .setDescription(
      'Track tower screenshots, occupying tribes, and capture times',
    )
    .setDescriptionLocalizations({
      'zh-TW': '辨識增益塔截圖，追蹤佔領部落與可佔領時間',
      ja: 'バフタワーの画像から占領部族と占領可能時刻を記録',
      ko: '타워 이미지에서 점령 부족과 점령 가능 시각을 기록합니다',
    })
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('upload')
        .setNameLocalizations({
          'zh-TW': '上傳',
          ja: 'アップロード',
          ko: '업로드',
        })
        .setDescription('Open a private screenshot upload window')
        .setDescriptionLocalizations({
          'zh-TW': '開啟私人截圖上傳視窗，確認發布後才更新頻道',
          ja: '非公開の画像アップロード画面を開く',
          ko: '비공개 스크린샷 업로드 창을 엽니다',
        }),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('setup')
        .setNameLocalizations({ 'zh-TW': '設定', ja: '設定', ko: '설정' })
        .setDescription(
          'Bind a channel to a game server (requires Manage Channels)',
        )
        .setDescriptionLocalizations({
          'zh-TW': '將頻道綁定到指定遊戲伺服器（需要管理頻道權限）',
          ja: 'ゲームサーバーを設定（チャンネルの管理権限が必要）',
          ko: '게임 서버를 설정합니다 (채널 관리 권한 필요)',
        })
        .addIntegerOption((option) =>
          option
            .setName('server')
            .setNameLocalizations({
              'zh-TW': '伺服器',
              ja: 'サーバー',
              ko: '서버',
            })
            .setDescription('Game server number, e.g. 27')
            .setDescriptionLocalizations({
              'zh-TW': '遊戲伺服器編號，例如 27',
              ja: 'ゲームサーバー番号（例：27）',
              ko: '게임 서버 번호 (예: 27)',
            })
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(999999),
        )
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setNameLocalizations({
              'zh-TW': '頻道',
              ja: 'チャンネル',
              ko: '채널',
            })
            .setDescription(
              'Screenshot channel; defaults to the current channel',
            )
            .setDescriptionLocalizations({
              'zh-TW': '接收截圖的文字頻道；留空使用目前頻道',
              ja: '画像投稿用チャンネル（省略時は現在のチャンネル）',
              ko: '이미지 채널 (생략하면 현재 채널)',
            })
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setNameLocalizations({ 'zh-TW': '列表', ja: '一覧', ko: '목록' })
        .setDescription('List this channel’s eight towers in Japan time')
        .setDescriptionLocalizations({
          'zh-TW': '查看目前頻道的八座增益塔與日本時間',
          ja: 'このチャンネルの8塔と日本時間を表示',
          ko: '현재 채널의 8개 타워를 일본 시간으로 표시합니다',
        }),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('draft')
        .setNameLocalizations({ 'zh-TW': '草稿', ja: '下書き', ko: '초안' })
        .setDescription(
          'Privately preview your pending tower images and choose where to publish',
        )
        .setDescriptionLocalizations({
          'zh-TW': '私人查看待發布的塔圖片資料，選擇發布期別',
          ja: '非公開の下書きを確認して公開先を選択',
          ko: '비공개 초안을 확인하고 게시할 기간을 선택합니다',
        }),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('disable')
        .setNameLocalizations({ 'zh-TW': '停用', ja: '停止', ko: '중지' })
        .setDescription(
          'Stop tracking and clear records (requires Manage Channels)',
        )
        .setDescriptionLocalizations({
          'zh-TW': '停止目前頻道的圖片偵測並清除紀錄（需要管理頻道權限）',
          ja: '追跡を停止して記録を消去（チャンネルの管理権限が必要）',
          ko: '추적을 중지하고 기록을 지웁니다 (채널 관리 권한 필요)',
        }),
    )
    .toJSON(),

  async execute(interaction) {
    const language = towerLanguage(interaction.locale)
    const text = (
      key: TowerTextKey,
      values: Record<string, string | number> = {},
    ) => towerText(language, key, values)
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: text('guildOnly'),
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
        content: text('textChannelOnly'),
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (
      ['setup', 'disable'].includes(action) &&
      !channel
        .permissionsFor(interaction.member)
        ?.has(PermissionFlagsBits.ManageChannels)
    ) {
      await interaction.reply({
        content: text('manageChannels'),
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
        content: text('botPermissions'),
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (action === 'upload') {
      await showTowerUpload(
        interaction,
        await towerStore.getBinding(interaction.guildId, channel.id),
      )
      return
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    if (action === 'draft') {
      const binding = await towerStore.getBinding(
        interaction.guildId,
        channel.id,
      )
      const draft = binding
        ? await towerDraftStore.getForUser(binding, interaction.user.id)
        : null
      await interaction.editReply(
        binding && draft
          ? await towerDraftPreview(
              {
                channel,
                client: { user: { id: interaction.client.user.id } },
                createdTimestamp: draft.updatedAt,
              },
              binding,
              draft,
              language,
            )
          : {
              content: text(binding ? 'noDraft' : 'notConfigured'),
              components: binding ? [towerUploadRow(binding, language)] : [],
            },
      )
      return
    }
    if (action === 'setup') {
      const serverNumber = interaction.options.getInteger('server', true)
      await towerStore.bind(
        interaction.guildId,
        channel.id,
        serverNumber,
        interaction.user.id,
      )
      const binding = await towerStore.getBinding(
        interaction.guildId,
        channel.id,
      )
      const warning =
        process.env.TOWER_TRACKING_ENABLED !== 'true'
          ? text('trackingDisabled')
          : !process.env.AI_API_KEY?.trim()
            ? text('aiMissing')
            : ''
      await interaction.editReply({
        content: [
          text('setup', { channel: channel.id, server: serverNumber }),
          warning,
        ]
          .filter(Boolean)
          .join('\n'),
        allowedMentions: { parse: [] },
        components: binding ? [towerUploadRow(binding, language)] : [],
      })
      return
    }
    if (action === 'disable') {
      await towerStore.disable(interaction.guildId, channel.id)
      await interaction.editReply(text('disabled'))
      return
    }
    const binding = await towerStore.getBinding(interaction.guildId, channel.id)
    const period = binding ? await towerStore.getReportingPeriod(binding) : null
    const observations = binding
      ? period
        ? await towerStore.listPeriodObservations(binding, period)
        : await towerStore.list(binding)
      : []
    await interaction.editReply({
      content: binding
        ? renderTowerSummary(
            binding.serverNumber,
            observations,
            language,
            period ?? undefined,
          )
        : text('notConfigured'),
      allowedMentions: { parse: [] },
      components: binding ? [towerUploadRow(binding, language)] : [],
    })
  },
})
