import { defineCommand } from '@dc/core'
import { SlashCommandBuilder } from 'discord.js'

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('檢查 bot 是否在線')
    .toJSON(),
  async execute(interaction) {
    await interaction.reply(`Pong! 延遲 ${interaction.client.ws.ping}ms`)
  },
})
