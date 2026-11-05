import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
} from 'discord.js'
import type { TranslationLanguage } from '../translation/languages.js'
import { towerText } from './i18n.js'
import type { TowerBinding } from './store.js'

export function towerUploadButton(
  binding: TowerBinding,
  language: TranslationLanguage,
) {
  return new ButtonBuilder()
    .setCustomId(`tower-upload:${binding.id}`)
    .setLabel(towerText(language, 'uploadImages'))
    .setStyle(ButtonStyle.Primary)
}

export function towerUploadRow(
  binding: TowerBinding,
  language: TranslationLanguage,
) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    towerUploadButton(binding, language),
  )
}

export function towerUploadModal(
  binding: TowerBinding,
  userId: string,
  language: TranslationLanguage,
) {
  return new ModalBuilder()
    .setCustomId(`tower-upload-submit:${binding.id}:${userId}`)
    .setTitle(towerText(language, 'uploadTitle'))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(towerText(language, 'uploadImages'))
        .setDescription(towerText(language, 'uploadDescription'))
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId('tower-images')
            .setMinValues(1)
            .setMaxValues(10)
            .setRequired(true),
        ),
    )
}
