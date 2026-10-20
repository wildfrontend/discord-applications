import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  renderReminderMessage,
  validateReminderTemplate,
} from '../src/recurring-events/message-template.js'

const event = {
  name: 'Raid *night* {url}',
  url: 'https://discord.com/events/111/222',
  scheduledStartTimestamp: 1_800_000_000_000,
}

test('renders multiline templates, replacing only template fields once', () => {
  const template = '{role}\\n🔔 **{name}**\\n{time}（{relative}）\\n{url}'
  validateReminderTemplate(template, '123')
  assert.equal(
    renderReminderMessage(event, '123', template),
    '<@&123>\n🔔 **Raid \\*night\\* {url}**\n<t:1800000000:F>（<t:1800000000:R>）\nhttps://discord.com/events/111/222',
  )
})

test('prepends the selected role if omitted and removes empty role lines', () => {
  assert.equal(
    renderReminderMessage(event, '123', '集合！{name}'),
    '<@&123>\n集合！Raid \\*night\\* {url}',
  )
  assert.equal(renderReminderMessage(event, null, '{role}\n集合！'), '集合！')
  assert.ok(
    renderReminderMessage(event, null, null).startsWith('**活動即將開始｜'),
  )
})

test('uses phase-specific defaults and exposes status and end fields', () => {
  const withEnd = { ...event, scheduledEndTimestamp: 1_800_014_400_000 }
  assert.equal(
    renderReminderMessage(withEnd, null, null, 'during'),
    '**活動進行中｜Raid \\*night\\* {url}**\n結束：<t:1800014400:F>（<t:1800014400:R>）\nhttps://discord.com/events/111/222',
  )
  assert.ok(
    renderReminderMessage(withEnd, null, null, 'end').startsWith(
      '**活動即將結束｜',
    ),
  )
  const template = '{name}{status}，{end_relative}'
  validateReminderTemplate(template, null)
  assert.equal(
    renderReminderMessage(withEnd, null, template, 'end'),
    'Raid \\*night\\* {url}即將結束，<t:1800014400:R>',
  )
  assert.equal(renderReminderMessage(event, null, '{end}', 'during'), '未設定')
})

test('rejects unknown fields, empty output, and oversized expanded messages', () => {
  assert.throws(() => validateReminderTemplate('{activity}', null), /不支援/)
  assert.throws(() => validateReminderTemplate(' ', null), /不可空白/)
  assert.throws(() => validateReminderTemplate('{role}', null), /不可空白/)
  assert.throws(
    () => validateReminderTemplate('a'.repeat(1001), null),
    /最多 1000/,
  )
  assert.throws(
    () => validateReminderTemplate('{name}'.repeat(11), null),
    /2000/,
  )
  assert.throws(
    () =>
      renderReminderMessage(
        { ...event, name: 'a'.repeat(2100) },
        null,
        '{name}',
      ),
    /2000/,
  )
})
