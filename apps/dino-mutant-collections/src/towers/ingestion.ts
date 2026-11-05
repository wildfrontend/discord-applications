import type { Attachment } from 'discord.js'
import { type TowerImageClient, towerImageClient } from './ai-client.js'
import { type DraftNotice, towerDraftStore } from './drafts.js'
import { observeTower, type TowerObservation } from './service.js'
import { type TowerBinding, towerStore } from './store.js'

// Both modal uploads and legacy channel uploads stage the same private draft.
export async function stageTowerImages(
  binding: TowerBinding,
  userId: string,
  uploadedAt: number,
  sourceId: string,
  images: Iterable<Attachment>,
  imageClient: TowerImageClient = towerImageClient,
) {
  const observations: TowerObservation[] = []
  let unreadable = 0
  let failed = 0
  let unsupported = 0
  let wrongServer = 0
  for (const image of images) {
    let url: URL
    try {
      url = new URL(image.url)
    } catch {
      unsupported++
      continue
    }
    if (
      image.size > 20 * 1024 * 1024 ||
      !(image.contentType
        ? /^image\/(?:png|jpeg|webp)$/i.test(image.contentType)
        : /\.(?:png|jpe?g|webp)$/i.test(image.name)) ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)
    ) {
      unsupported++
      continue
    }
    try {
      const result = await imageClient.recognize(image.url)
      if (result.kind !== 'tower') {
        unreadable++
        continue
      }
      if (result.reading.serverNumber !== binding.serverNumber) {
        wrongServer++
        continue
      }
      observations.push(
        observeTower(result.reading, uploadedAt, sourceId, image.id),
      )
    } catch {
      failed++
      console.warn(
        `[towers] Image processing failed in channel ${binding.channelId}`,
      )
    }
  }
  if (
    (await towerStore.getBinding(binding.guildId, binding.channelId))?.id !==
    binding.id
  )
    return null
  const notices: DraftNotice[] = []
  if (wrongServer) notices.push({ key: 'wrongServer', count: wrongServer })
  if (unreadable) notices.push({ key: 'unreadable', count: unreadable })
  if (unsupported) notices.push({ key: 'unsupported', count: unsupported })
  if (failed) notices.push({ key: 'failed', count: failed })
  return towerDraftStore.stage(
    binding,
    userId,
    uploadedAt,
    observations,
    notices,
  )
}
