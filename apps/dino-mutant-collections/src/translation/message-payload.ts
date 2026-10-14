import { type Attachment, AttachmentBuilder } from 'discord.js'

export interface TranslationPayload {
  content?: string
  files?: AttachmentBuilder[]
}

export function translationAttachment(
  attachment: Attachment,
): AttachmentBuilder {
  return new AttachmentBuilder(attachment.url, {
    name: attachment.name,
    description: attachment.description ?? undefined,
  }).setSpoiler(attachment.spoiler)
}

// Keep every character, including whitespace, when splitting Discord messages.
function splitContent(content: string): string[] {
  const chunks: string[] = []
  let remaining = content
  while (remaining.length > 2000) {
    let boundary = 2000
    const newline = remaining.lastIndexOf('\n', 1999)
    const space = remaining.lastIndexOf(' ', 1999)
    const naturalBoundary = newline >= 1000 ? newline : space
    if (naturalBoundary >= 1000) boundary = naturalBoundary + 1
    const lastCodeUnit = remaining.charCodeAt(boundary - 1)
    if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) boundary--
    chunks.push(remaining.slice(0, boundary))
    remaining = remaining.slice(boundary)
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

export function translationPayloads(
  text: string,
  files: AttachmentBuilder[] = [],
  sourceUrl?: string,
): TranslationPayload[] {
  const content = sourceUrl
    ? `${text}${text ? '\n' : ''}-# [查看原訊息](${sourceUrl})`
    : text
  const chunks = splitContent(content)
  const count = Math.max(chunks.length, Math.ceil(files.length / 10))
  return Array.from({ length: count }, (_, index) => {
    const payload: TranslationPayload = {}
    if (chunks[index]) payload.content = chunks[index]
    const attachments = files.slice(index * 10, (index + 1) * 10)
    if (attachments.length) payload.files = attachments
    return payload
  })
}
