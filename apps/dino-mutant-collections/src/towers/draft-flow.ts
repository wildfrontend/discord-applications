import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type Client,
  type Message,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js'
import type { TranslationLanguage } from '../translation/languages.js'
import {
  mergeTowerObservations,
  type TowerDraft,
  towerDraftStore,
} from './drafts.js'
import { towerLanguage, towerText } from './i18n.js'
import { withTowerChannelLock } from './queue.js'
import { renderTowerSummary, towerReportingPeriodMs } from './service.js'
import {
  type TowerBinding,
  type TowerReportingPeriod,
  towerStore,
} from './store.js'
import {
  currentReportingPeriod,
  type TowerSummarySource,
  updateTowerSummary,
} from './summary.js'

function suggestedTarget(
  draft: TowerDraft,
  periods: TowerReportingPeriod[],
): string {
  const [current, previous] = periods
  if (!current) return 'new'
  const latest = [...draft.observations].sort(
    (a, b) => b.uploadedAt - a.uploadedAt,
  )[0]
  if (
    previous &&
    latest?.clock?.isUtc &&
    latest.observedAt < current.startedAt &&
    latest.observedAt >= previous.startedAt
  )
    return previous.id
  return draft.updatedAt >= current.endsAt ? 'new' : current.id
}

function newPeriodStart(
  draft: TowerDraft,
  current?: TowerReportingPeriod,
): number {
  if (!current) return draft.createdAt
  const boundary =
    draft.updatedAt >= current.endsAt ? current.endsAt : current.startedAt + 1
  return Math.min(
    ...draft.observations
      .filter((item) => item.uploadedAt >= boundary)
      .map((item) => item.uploadedAt),
    draft.updatedAt,
  )
}

export async function towerDraftPreview(
  source: TowerSummarySource,
  binding: TowerBinding,
  draft: TowerDraft,
  language: TranslationLanguage,
  selected?: string,
) {
  await currentReportingPeriod(source, binding)
  const periods = await towerStore.listReportingPeriods(binding)
  const suggested = suggestedTarget(draft, periods)
  const target =
    selected &&
    (selected === 'new' || periods.some((period) => period.id === selected))
      ? selected
      : suggested
  const chosen = periods.find((period) => period.id === target)
  const start = newPeriodStart(draft, periods[0])
  const window = chosen ?? {
    startedAt: start,
    endsAt: start + towerReportingPeriodMs,
  }
  const base = chosen
    ? await towerStore.listPeriodObservations(binding, chosen)
    : await towerStore.list(binding)
  const merged = mergeTowerObservations(base, draft.observations)
  const labels = [
    towerText(language, 'publishCurrent'),
    towerText(language, 'publishPrevious'),
  ]
  const options = periods.map((period, index) => ({
    label: labels[index],
    value: period.id,
    default: period.id === target,
  }))
  options.push({
    label: towerText(language, 'publishNew'),
    value: 'new',
    default: target === 'new',
  })
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`tower-target:${draft.id}:${draft.revision}`)
    .setPlaceholder(towerText(language, 'selectPeriod'))
    .addOptions(options)
  const publish = new ButtonBuilder()
    .setCustomId(`tower-publish:${draft.id}:${draft.revision}:${target}`)
    .setLabel(towerText(language, 'publishDraft'))
    .setStyle(ButtonStyle.Success)
    .setDisabled(draft.observations.length === 0)
  const cancel = new ButtonBuilder()
    .setCustomId(`tower-cancel:${draft.id}:${draft.revision}`)
    .setLabel(towerText(language, 'cancelDraft'))
    .setStyle(ButtonStyle.Secondary)
  const suggestedLabel =
    suggested === 'new'
      ? towerText(language, 'publishNew')
      : labels[periods.findIndex((period) => period.id === suggested)]
  const notices = draft.notices.map((notice) =>
    towerText(language, notice.key, {
      count: notice.count,
      server: binding.serverNumber,
    }),
  )
  return {
    content: [
      towerText(language, 'privateDraft', { channel: binding.channelId }),
      renderTowerSummary(binding.serverNumber, merged, language, window),
      ...notices,
      target === 'new' && periods[0] && start < periods[0].endsAt
        ? towerText(language, 'draftNewEarly')
        : '',
      towerText(language, 'draftAdvice', { target: suggestedLabel }),
    ]
      .filter(Boolean)
      .join('\n\n'),
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(publish, cancel),
    ],
  }
}

export async function deliverTowerDraft(
  source: Message<true>,
  binding: TowerBinding,
  draft: TowerDraft,
  language: TranslationLanguage,
): Promise<{ message: Message; content: string }> {
  const preview = await towerDraftPreview(source, binding, draft, language)
  try {
    const message = await source.author.send({
      ...preview,
      allowedMentions: { parse: [] },
    })
    return { message, content: preview.content }
  } catch {
    // Do not disclose tower data publicly if server DMs are disabled. Drafts persist
    // and can be resumed with the private /tower draft command in the source channel.
    const content = towerText(language, 'dmUnavailable')
    const message = await source.channel.send({
      content,
      allowedMentions: { parse: [] },
    })
    return { message, content }
  }
}

const actionPattern =
  /^tower-(target|publish|cancel):([0-9a-f-]{36}):(\d+)(?::([0-9a-f-]{36}|new))?$/

export async function handleTowerDraftInteraction(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<boolean> {
  const action = actionPattern.exec(interaction.customId)
  if (!action) return false
  const language = towerLanguage(interaction.locale)
  const draft = await towerDraftStore.get(action[2])
  if (!draft || draft.userId !== interaction.user.id) {
    await interaction.reply({
      content: towerText(language, draft ? 'draftOwner' : 'draftGone'),
      flags: MessageFlags.Ephemeral,
    })
    return true
  }
  await interaction.deferUpdate()
  await withTowerChannelLock(draft.channelId, async () => {
    const latest = await towerDraftStore.get(draft.id)
    if (
      latest &&
      action[1] === 'cancel' &&
      latest.revision === Number(action[3])
    ) {
      await towerDraftStore.remove(latest.id, latest.revision)
      await interaction.editReply({
        content: towerText(language, 'draftCancelled'),
        components: [],
      })
      return
    }
    const binding = await towerStore.getBinding(draft.guildId, draft.channelId)
    if (!latest || !binding || binding.id !== latest.bindingId) {
      await interaction.editReply({
        content: towerText(language, 'draftGone'),
        components: [],
      })
      return
    }
    const channel = await interaction.client.channels.fetch(draft.channelId)
    if (channel?.type !== ChannelType.GuildText)
      throw new Error('Tower channel unavailable')
    const member = await channel.guild.members
      .fetch(interaction.user.id)
      .catch(() => null)
    if (
      !member ||
      !channel
        .permissionsFor(member)
        ?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
        ])
    ) {
      await interaction.editReply({
        content: towerText(language, 'publishNoAccess'),
        components: [],
      })
      return
    }
    const source: TowerSummarySource = {
      channel,
      client: { user: { id: interaction.client.user.id } },
      createdTimestamp: latest.updatedAt,
    }
    if (latest.revision !== Number(action[3])) {
      const preview = await towerDraftPreview(source, binding, latest, language)
      await interaction.editReply({
        ...preview,
        content: `${towerText(language, 'draftStale')}\n\n${preview.content}`,
      })
      return
    }
    if (action[1] === 'target') {
      const target = interaction.isStringSelectMenu()
        ? interaction.values[0]
        : undefined
      await interaction.editReply(
        await towerDraftPreview(source, binding, latest, language, target),
      )
      return
    }
    if (!latest.observations.length) {
      await interaction.editReply(
        await towerDraftPreview(source, binding, latest, language),
      )
      return
    }
    try {
      const periods = await towerStore.listReportingPeriods(binding)
      const targetId = action[4]
      let target: TowerReportingPeriod | undefined
      if (targetId === 'new') {
        const startedAt = newPeriodStart(latest, periods[0])
        if (periods[0] && startedAt <= periods[0].startedAt)
          throw new Error('Reporting period changed')
        if (periods[0] && startedAt < periods[0].endsAt) {
          const closed = await towerStore.closeReportingPeriod(
            binding,
            periods[0],
            startedAt,
          )
          if (closed.messageId)
            await updateTowerSummary(source, binding, language, [], closed)
        }
        target = await towerStore.createReportingPeriod(binding, startedAt)
      } else {
        target =
          (await towerStore.getReportingPeriodById(binding, targetId ?? '')) ??
          undefined
      }
      if (!target) throw new Error('Reporting period unavailable')
      for (const item of latest.observations) {
        await towerStore.savePeriodObservation(binding, target, item)
        await towerStore.save(binding, item)
      }
      const published = await updateTowerSummary(
        source,
        binding,
        language,
        [],
        target,
      )
      await towerDraftStore.remove(latest.id, latest.revision)
      await interaction.editReply({
        content: towerText(language, 'publishDone', {
          url: published.message.url,
        }),
        components: [],
      })
    } catch {
      const preview = await towerDraftPreview(source, binding, latest, language)
      await interaction.editReply({
        ...preview,
        content: `${towerText(language, 'publishFailed')}\n\n${preview.content}`,
      })
    }
  })
  return true
}

export function startTowerDraftInteractions(client: Client): void {
  client.on('interactionCreate', (interaction) => {
    if (
      (!interaction.isButton() && !interaction.isStringSelectMenu()) ||
      !/^tower-(target|publish|cancel):/.test(interaction.customId)
    )
      return
    void handleTowerDraftInteraction(interaction).catch(() => {
      console.warn('[towers] Private draft interaction failed')
    })
  })
}
