# Dino Mutant Collections

A self-hosted Discord bot for recurring scheduled events and multilingual translation. The repository is a pnpm/Turborepo monorepo and also includes a local development panel.

## Features

- Recurring Discord scheduled events with optional channel notifications.
- Personal translation commands that post with the sender's nickname and avatar.
- Message context-menu translation.
- Automatic two-way or multi-channel translation groups.
- Traditional Chinese, English, Japanese, and Korean translation.
- Localized `/translate` command UI in English, Traditional Chinese, Japanese, and Korean.
- SQLite for simple self-hosting or libSQL for remote persistence.

## Quick start with Docker

You need:

- Git, Docker, and Docker Compose v2.
- Your own Discord application and bot token.
- An API key from an OpenAI-compatible AI provider for translation.

The public container image is `ghcr.io/wildfrontend/dino-mutant-collections:latest`. It supports `linux/amd64` and `linux/arm64`; pulling it does not require a GitHub account.

### 1. Create a Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Copy its **Application ID** from **General Information**.
3. Open **Bot**, reset the token, and copy it. Treat the token like a password.
4. Enable **Message Content Intent** only if you plan to use automatic channel translation.

Every installation should use its own Discord bot token and AI API key. Never commit either secret.

### 2. Install and configure

```bash
git clone https://github.com/wildfrontend/discord-applications.git
cd discord-applications
docker compose -f compose.self-host.yaml run --rm setup
docker compose -f compose.self-host.yaml up -d bot
docker compose -f compose.self-host.yaml logs -f bot
```

The setup wizard:

- asks for Discord, AI, translation, and database settings;
- validates the Discord credentials;
- saves secrets to `apps/dino-mutant-collections/.env` with owner-only permissions; and
- prints the URL used to invite the bot to a server.

Open the invite URL, add the bot to a server, and run `/ping`. A `Pong!` response confirms that the bot is ready. The container registers slash commands automatically on startup.

Do not set `DISCORD_GUILD_ID` for a normal public deployment. Leaving it empty registers global commands; Discord may take a short time to display newly registered global commands.

### Update

```bash
git pull --ff-only
docker compose -f compose.self-host.yaml pull bot
docker compose -f compose.self-host.yaml up -d --force-recreate bot
docker compose -f compose.self-host.yaml logs -f bot
```

Configuration and SQLite data survive container replacement in the `bot-data` volume. Do not add `--volumes` to `docker compose down` unless you intentionally want to delete the bot database.

### Change configuration

Run the wizard again, then recreate the bot container:

```bash
docker compose -f compose.self-host.yaml run --rm setup
docker compose -f compose.self-host.yaml up -d --force-recreate bot
```

## Translation

The default example uses a Qwen model hosted by Groq, but any compatible OpenAI chat-completions provider can be configured.

### Personal translation

Save a default source and target language:

```text
/translate config input-language:Traditional Chinese output-language:Japanese
```

Translate your text and post it publicly:

```text
/translate send message:Hello everyone
```

`send` uses the saved defaults unless you override `input-language` or `output-language`. It posts through a webhook with the command user's server nickname and avatar. The bot needs **View Channel**, **Send Messages**, and **Manage Webhooks** permissions in that channel.

Use the optional `attachment` field to include an image or file. Provide `message`, `attachment`, or both. Attachment-only and link-only messages are sent unchanged without calling the AI provider or requiring a target language. Images and files are forwarded as attachments; their contents are not translated.

To translate someone else's message, right-click it and choose **Apps → Translate this message**. This manual action does not require Message Content Intent.

### Automatic channel translation

Place the language channels in one Discord category, then create a group with at least two channels:

```text
/translate group category:translation-channels chinese-channel:#chinese english-channel:#english japanese-channel:#japanese korean-channel:#korean
/translate status
/translate ungroup
```

Use `/translate link` for a simpler two-channel link. Automatic translation requires:

- `TRANSLATION_AUTO_ENABLED=true`;
- Message Content Intent in Discord Developer Portal;
- a configured AI API key; and
- **Manage Webhooks** permission in the target channels.

Tell server members before enabling automatic translation because their messages are sent to the configured third-party AI provider.

Automatic translation also forwards images and other attachments, preserving filenames, descriptions, and spoiler markings. Link-only and attachment-only messages are forwarded without calling AI. Messages containing text and attachments translate only the message text and forward the files unchanged. Long outgoing messages are split to fit Discord's 2000-character limit instead of being truncated. Link previews are generated by Discord from the forwarded URLs.

If webhook delivery is unavailable, the bot's fallback messages also include the attachments. Grant the bot **Attach Files** permission for this fallback. Discord's upload size limits still apply to forwarded files.

## Rune diagnosis — dr.大暴龍

`dr.大暴龍` answers rune questions and examines screenshots using an image-capable AI model and the [Dino Mutant Wiki MCP](https://dino-mutant-wiki.vercel.app/mcp). It can search runes, retrieve level-specific effects and costs, look up Titan damage, and simulate loadouts from the member's supplied stats. Answers cite Wiki sources and identify incomplete or uncertain data.

The AI is instructed to use a full diagnosis template: **診斷結論**, **目前配置**, **效果比較**, **升級成本與停點**, **缺少資料**, and **資料來源**. Each heading remains present; missing or irrelevant inputs are marked as such instead of assuming ownership, base stats, upgrade costs or a target level.

Enable the feature in `.env`, then restart the bot:

```env
CONSULTATION_ENABLED=true
CONSULTATION_MCP_URL=https://dino-mutant-wiki.vercel.app/mcp
AI_WIKI_KEY=your-groq-api-key
```

The key priority is `CONSULTATION_AI_API_KEY`, then `AI_WIKI_KEY`, then the existing `AI_API_KEY`. The model and API base URL default to `AI_MODEL` and `AI_BASE_URL`. To use a separate provider or model, set `CONSULTATION_AI_MODEL`, `CONSULTATION_AI_BASE_URL`, and `CONSULTATION_AI_API_KEY`. The default Groq model, `qwen/qwen3.8-27b`, supports both images and tool calling. Changes to these environment settings require a bot restart.

Administrators with **Manage Channels** can open the clinic in a normal text channel:

```text
/rune-dr open channel:#rune-clinic
/rune-dr status
/rune-dr close
```

Omit `channel` to use the current channel. In Traditional Chinese Discord, the subcommands are displayed as **開診**, **診間狀態**, and **休診**. Channel settings persist across restarts. The bot needs **View Channel**, **Send Messages**, and **Read Message History** in the selected channel.

Members must explicitly **@mention the bot** in an enabled channel. A question, supported image attachment, or both can follow the mention. Regular messages, replies without an explicit mention, bots, webhooks, and other channels do not trigger consultation. Up to three PNG, JPEG, or WebP images are supported per question, with a combined size of 20 MB. Answers are sent by the bot under a **dr.大暴龍｜符文診斷** heading and split when they exceed Discord's message limit.

Each member can submit one question at a time, with a 60-second minimum interval and 10 questions per day across all channels and servers. The entire bot has a 100-question daily budget and processes one consultation at a time. Daily usage persists across restarts and resets at midnight in Asia/Taipei. A question counts when AI processing starts, including attempts that later fail; invalid inputs, cooldown rejections and busy replies do not consume quota. Administrators can inspect usage with `/rune-dr status`. Configure these limits through `CONSULTATION_COOLDOWN_SECONDS`, `CONSULTATION_USER_DAILY_LIMIT`, `CONSULTATION_BOT_DAILY_LIMIT`, and `CONSULTATION_MAX_CONCURRENT` (1–3). Short Groq rate limits are retried according to the provider's `Retry-After` header, within an overall two-minute request timeout. These are question limits, rather than provider token or request budgets; a question may require several AI requests.

Questions and images are sent to the configured AI provider; query arguments are sent to the Wiki MCP. Tell members before enabling the feature. Follow-up context is kept separately for each member in each channel, limited to four exchanges, and expires after 20 minutes or a bot restart. The bot does not retrieve other members' chat history. The AI may ask for base stats, rune levels, ownership, or activation conditions before calculating a recommendation. Only the Wiki's four inspected query/calculation tools are available.

This mention-only feature uses the standard Guild Messages intent and does not itself require Message Content Intent. Automatic channel translation still requires Message Content Intent.

## Recurring events

Create the first event with Discord's native scheduled-event interface, then configure recurrence:

```text
/event repeat
```

Choose the event and set the interval. The bot keeps one future occurrence scheduled. Other commands:

- `/event list` — list recurring schedules.
- `/event remove` — stop a schedule without deleting existing events.
- `/event notify channel:#event-notifications before:30 role:@members` — configure shared reminders before an event starts. `before` is in minutes (1–10080, default 30); omit `role` to send without a mention.
- `/event notify schedule:Activity-A channel:#activity-a before:60 role:@activity-a-members` — set a separate reminder channel, lead time, and role for a recurring schedule selected from autocomplete. Schedules without individual settings inherit the shared configuration.
- `/event notify-disable schedule:Activity-A` — disable only that schedule's reminders. Omit `schedule` to disable shared reminders; individually configured reminders remain enabled.
- `/event notify-default schedule:Activity-A` — restore a schedule to the shared configuration.

Reminders cover both the original selected event and subsequent occurrences. The bot checks approximately every 30 seconds and sends the event's start time and link when it enters the reminder window, rather than announcing an event when it is created. If the bot resumes or reminders are configured during that window, it sends on the next check; events that have already started are skipped. Delivery records persist across normal restarts. Changing reminder settings does not resend an already delivered reminder.

Configuring reminders requires **Manage Events**. The bot needs **View Channel** and **Send Messages** in the selected channel. To ping a role, either make it mentionable or grant the bot **Mention Everyone** in that channel. Only the explicitly selected role is allowed to be mentioned.

Use the optional `message` field on `/event notify` to customize the reminder text for a schedule or the shared configuration. The bot previews the saved message privately without pinging anyone. Omit `message` to restore the default text when saving notification settings. Templates support Markdown and literal `\n` for line breaks, with these fields:

| Field | Value |
| --- | --- |
| `{name}` | Event name (escaped for Markdown). |
| `{time}` | Event start time, displayed in each reader's local timezone. |
| `{relative}` | Relative start time, such as “in 30 minutes”. |
| `{url}` | Discord event link. |
| `{role}` | The role selected with `role`, or empty when no role is selected. |

For example, paste this into the `message` field:

```text
{role}\n🔔 **{name} 即將開始！**\n📅 時間：{time}（{relative}）\n👉 活動連結：{url}\n請大家準備集合！
```

If a role is selected but `{role}` is omitted from the template, the bot prepends the role mention. Templates can contain up to 1000 characters, and are checked for unsupported fields and expansion beyond Discord's 2000-character message limit. Mentions of other roles, users, `@everyone`, and `@here` in custom text do not ping anyone.

The bot needs **Create Events** and **Manage Events** permissions. Regular members can manage schedules they created; members with **Manage Events** can manage all schedules.

## Configuration reference

The setup wizard is recommended. For manual configuration, copy `apps/dino-mutant-collections/.env.example` to `.env`. Important variables include:

| Variable | Purpose |
| --- | --- |
| `DISCORD_CLIENT_ID` | Discord Application ID. |
| `DISCORD_TOKEN` | Discord bot token. |
| `DISCORD_GUILD_ID` | Optional development-only guild registration. |
| `AI_API_KEY` | Translation provider API key. |
| `AI_MODEL` | Provider model name. |
| `AI_BASE_URL` | OpenAI-compatible API base URL. |
| `TRANSLATION_AUTO_ENABLED` | Enables automatic channel translation. |
| `DATABASE_DRIVER` | `sqlite` or `libsql`. |
| `DATABASE_URL` | Required when using libSQL. |
| `DATABASE_AUTH_TOKEN` | Optional libSQL authentication token. |

The local health endpoint is `http://127.0.0.1:10000/healthz`.

## Render

`render.yaml` can deploy the bot as a Render Blueprint. Render's free filesystem is ephemeral, so use a remote libSQL-compatible database:

```env
DATABASE_DRIVER=libsql
DATABASE_URL=libsql://...
DATABASE_AUTH_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_TOKEN=...
AI_API_KEY=...
```

Free Render web services may sleep when they receive no HTTP traffic; a Discord Gateway connection does not count as HTTP traffic. Use a paid worker, persistent service, or VPS for reliable 24/7 operation.

## Local development

Requires Node.js 22.5 or newer and pnpm 11.9.0.

```bash
pnpm install
cp apps/dino-mutant-collections/.env.example apps/dino-mutant-collections/.env
pnpm --filter @dc/dino-mutant-collections deploy-commands
pnpm --filter @dc/dino-mutant-collections dev
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build every workspace. |
| `pnpm typecheck` | Run TypeScript checks. |
| `pnpm lint` | Run Biome checks. |
| `pnpm format` | Apply Biome formatting. |
| `pnpm dev:panel` | Start the local development panel. |

To build and run the bot from local source with Docker:

```bash
docker compose run --rm --build setup
docker compose up -d --build bot
```

## Development panel

Start the panel locally with `pnpm dev:panel`, then open `http://127.0.0.1:4310`.

For a bot running through the local `compose.yaml`, use:

```bash
docker compose --profile tools up -d --build dev-panel
```

The panel manages local configuration and SQLite data. It binds to loopback and should not be exposed publicly. Remote libSQL databases must be managed through the database provider.
