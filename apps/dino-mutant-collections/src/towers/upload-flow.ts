import {
  type ButtonInteraction,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  Events,
  MessageFlags,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
} from 'discord.js'
import { type TowerImageClient, towerImageClient } from './ai-client.js'
import { towerDraftPreview } from './draft-flow.js'
import { towerLanguage, towerText } from './i18n.js'
import { stageTowerImages } from './ingestion.js'
import { withTowerChannelLock } from './queue.js'
import { type TowerBinding, towerStore } from './store.js'
import { towerUploadModal } from './upload-ui.js'

async function accessibleTowerChannel(
  interaction: { client: Client; user: { id: string } },
  binding: TowerBinding,
) {
  const channel = await interaction.client.channels.fetch(binding.channelId)
  if (
    channel?.type !== ChannelType.GuildText ||
    channel.guild.id !== binding.guildId
  )
    return null
  const member = await channel.guild.members
    .fetch(interaction.user.id)
    .catch(() => null)
  return member &&
    channel
      .permissionsFor(member)
      ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
    ? channel
    : null
}

export async function showTowerUpload(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  binding: TowerBinding | null,
): Promise<void> {
  const language = towerLanguage(interaction.locale)
  if (!binding || process.env.TOWER_TRACKING_ENABLED !== 'true') {
    await interaction.reply({
      content: towerText(
        language,
        binding ? 'trackingDisabled' : 'notConfigured',
      ),
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  if (!(await accessibleTowerChannel(interaction, binding))) {
    await interaction.reply({
      content: towerText(language, 'publishNoAccess'),
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  await interaction.showModal(
    towerUploadModal(binding, interaction.user.id, language),
  )
}

export async function handleTowerUploadInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  imageClient: TowerImageClient = towerImageClient,
): Promise<boolean> {
  const language = towerLanguage(interaction.locale)
  if (interaction.isButton()) {
    const action = /^tower-upload:([0-9a-f-]{36})$/.exec(interaction.customId)
    if (!action) return false
    await showTowerUpload(
      interaction,
      await towerStore.getBindingById(action[1]),
    )
    return true
  }
  const action = /^tower-upload-submit:([0-9a-f-]{36}):([^:]+)$/.exec(
    interaction.customId,
  )
  if (!action) return false
  if (action[2] !== interaction.user.id) {
    await interaction.reply({
      content: towerText(language, 'draftOwner'),
      flags: MessageFlags.Ephemeral,
    })
    return true
  }
  // Acknowledge privately before fetching permissions or waiting for AI.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const binding = await towerStore.getBindingById(action[1])
  if (!binding) {
    await interaction.editReply({
      content: towerText(language, 'draftGone'),
      components: [],
    })
    return true
  }
  await withTowerChannelLock(binding.channelId, async () => {
    const current = await towerStore.getBinding(
      binding.guildId,
      binding.channelId,
    )
    if (current?.id !== binding.id) {
      await interaction.editReply({
        content: towerText(language, 'draftGone'),
        components: [],
      })
      return
    }
    const channel = await accessibleTowerChannel(interaction, binding)
    if (!channel) {
      await interaction.editReply({
        content: towerText(language, 'publishNoAccess'),
        components: [],
      })
      return
    }
    const images = interaction.fields.getUploadedFiles('tower-images', true)
    if (!images.size || images.size > 10) {
      await interaction.editReply({
        content: towerText(language, 'uploadDescription'),
        components: [],
      })
      return
    }
    const draft = await stageTowerImages(
      binding,
      interaction.user.id,
      interaction.createdTimestamp,
      interaction.id,
      images.values(),
      imageClient,
    )
    if (!draft) {
      await interaction.editReply({
        content: towerText(language, 'draftGone'),
        components: [],
      })
      return
    }
    await interaction.editReply({
      ...(await towerDraftPreview(
        {
          channel,
          client: { user: { id: interaction.client.user.id } },
          createdTimestamp: draft.updatedAt,
        },
        binding,
        draft,
        language,
      )),
      allowedMentions: { parse: [] },
    })
  })
  return true
}

export function startTowerUploadInteractions(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (
      (!interaction.isButton() && !interaction.isModalSubmit()) ||
      !/^tower-upload(?:-submit)?:/.test(interaction.customId)
    )
      return
    void handleTowerUploadInteraction(interaction).catch(async () => {
      console.warn('[towers] Private upload interaction failed')
      const content = towerText(
        towerLanguage(interaction.locale),
        'uploadFailed',
      )
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content, components: [] })
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral })
        }
      } catch {
        // Saved drafts can still be resumed through /tower draft.
      }
    })
  })
}
