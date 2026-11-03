# Dino Mutant Collections

A self-hosted Discord bot for recurring scheduled events, multilingual translation, and buff tower screenshot tracking. The repository is a pnpm/Turborepo monorepo and also includes a local development panel.

## Features

- Recurring Discord scheduled events with optional channel notifications.
- Personal translation commands that post with the sender's nickname and avatar.
- Message context-menu translation.
- Automatic two-way or multi-channel translation groups.
- Traditional Chinese, English, Japanese, and Korean translation.
- Localized `/translate` command UI in English, Traditional Chinese, Japanese, and Korean.
- Per-channel buff tower tracking from screenshots, with occupying tribes and availability in Japan time.
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
4. Enable **Message Content Intent** if you plan to use automatic channel translation or buff tower screenshot tracking.

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

## Buff tower screenshots

1. Set `TOWER_TRACKING_ENABLED=true` in the bot environment (or use the setup wizard), enable **Message Content Intent** in Discord Developer Portal, and restart the bot.
2. Configure `AI_API_KEY`, `AI_BASE_URL`, and an image-capable `AI_MODEL` supporting JSON mode. Optionally set `TOWER_AI_MODEL` to use a different model for screenshots on the same provider. The example Groq model supports images and JSON mode; see the [provider's vision documentation](https://console.groq.com/docs/vision).
3. Bind a normal text channel to a game server (requires **Manage Channels** in that channel):

```text
/tower setup server:27 channel:#buff-towers
```

Upload PNG, JPEG, or WebP screenshots up to 20 MB in that channel. Screenshots are sent to the configured AI provider. The bot reads the map location at the bottom right, the **occupying tribe** (not the tribe attempting occupation), and **shield remaining time**. Only the configured server and areas **7, 8, 9, 12, 14, 17, 18, 19** are accepted; `027-19` is normalized to `27-19`.

**Uploads are private drafts by default.** Each uploader receives a DM preview; multiple uploads from the same person in the same channel merge into their pending draft. Recognition never changes published tower records. Failed readings keep any previously staged rows, show a private notice, and still remove the source images after delivering the result. Other users cannot access or publish someone else's draft. Tower channels are excluded from automatic translation forwarding, so images and captions are not copied into other language channels.

In the DM, select **Update current period**, **Update previous period**, or **Start a new period**. Changing the selection only refreshes the private preview. Press **Publish** after reviewing it to update the chosen public summary. The suggested target uses the source message's timestamp and the existing 48-hour ranges; an identifiable UTC capture before the current boundary can suggest the previous period. Uncertain clock readings remain labelled for review. **Discard draft** removes only pending data. Newer draft revisions require another preview before an old button can publish, and publication rechecks the user's channel permissions.

If server DMs are blocked, the channel receives only a generic recovery hint, without tower data. Run `/tower draft` in the source channel to resume an **ephemeral preview visible only to you**. The normalized draft is saved even after source-image deletion. `/tower list` also provides a private view of the current published period in your own Discord language. Neither command creates another public summary.

Each channel keeps **one editable plain-text summary per reporting period**. The first image's **Discord message timestamp** anchors a default **48-hour** range. Publishing to the current period edits that same message, even if screenshots were uploaded separately or by different members. After the range ends, a new draft suggests a new period; a new public summary appears only after confirmation. The earlier summary remains as history. Explicitly starting a new period early closes the preceding range after showing this in the preview. No empty periods are posted during inactivity.

Every period has an independent saved tower snapshot. Publishing a correction to the previous period edits only that period's public message, without copying current-period data into it or changing the current summary. Last known tower information carries into a new period and is labelled **Previous report** until updated there. Drafts, period snapshots, boundaries, and summary message IDs survive restarts. If a selected summary was deleted, publication recreates it in that same period. Existing channels can adopt their latest bot summary; new or rebound channels start fresh.

Absolute times use **Asia/Tokyo (UTC+9)**, with a Discord relative timestamp beside each time. Availability is estimated as **estimated screenshot time + shield countdown**, including hours over 24, up to 48. The top-right game clock supplies the screenshot time when usable; otherwise the Discord upload timestamp is used. Another 48 hours is never added. Occupying tribes remain the last confirmed reports after a countdown ends.

Screenshots can be submitted repeatedly during the same 48-hour occupation cycle. On publication, each successfully read screenshot is compared using its estimated capture minute. A newer capture minute replaces the tower's tribe and availability, even when the resulting availability is earlier. Upload time and attachment order break ties within the same capture minute. For example, a 09:00 upload with 48 hours remaining and an upload the next day at 09:00 with 24 hours remaining point to the same availability time. After a new occupation, a fresh screenshot supplies the new countdown. Failed readings and older estimated capture minutes never replace a newer record; other towers are unaffected. Expiration does not automatically start another 48-hour cycle.

The bot also reads the **top-right game clock** and whether its **UTC label** is visible. With an explicit UTC label, it resolves the nearest UTC date, including midnight rollover. A clock more than **30 minutes** before upload still supplies the reference time and updates the record when newer than the existing observation; the result is marked **“over 30 minutes old; time may be inaccurate”**. Exactly 30 minutes does not trigger the marker. A future UTC reading uses upload time with an uncertainty marker rather than being treated as a nearly day-old image. Missing or unreadable clocks use upload time. The clock shows no seconds, so calibration has roughly one minute of uncertainty.

For a fully visible clock with **no timezone label**, the bot continues estimating the delay from minute values and timezone offsets in 15-minute increments, including whole-hour, half-hour, and quarter-hour offsets. Unknown timezone and date make the actual delay ambiguous: a delay of 15 minutes or more can resemble a shorter delay, so the bot cannot reliably determine whether it exceeds 30 minutes. These estimates still update records and always carry a localized **“time may be inaccurate”** marker. The earlier 10-minute rejection cutoff is removed. Each tower labels its basis as UTC clock, minute estimate, or upload time. Original upload time, extracted clock data, and the uncertainty flag persist across restarts. Existing availability times remain unchanged during migration, and existing minute estimates gain the uncertainty marker.

This is an analysis-only channel. After delivering a private preview or a generic recovery hint, the bot deletes the original image message, including any accompanying text, whether recognition succeeds, fails, or identifies an unsupported/wrong-server image. Failed recognition never changes tower records. The bot needs **Manage Messages** permission for cleanup. If neither a DM preview nor a recovery hint can be delivered, the source is retained. A failed publication keeps the saved draft for retry. Messages containing non-image files or attachments changed during processing are also retained to avoid deleting unprocessed files. Cleanup errors leave the text result intact and append a permission/error notice.

Tower commands use the invoking user’s Discord language. Discord supplies the user locale on interactions, but ordinary image uploads do not include it, so the bot remembers each user’s latest interaction locale for subsequent uploads. Run any bot command (for example `/tower list`) once to register or refresh the language. Supported output languages are Traditional Chinese, English, Japanese, and Korean; unknown users and unsupported locales use Japanese. This does not require `/translate config`. The shared summary uses the confirming publisher’s language; other readers see the same message, or can use `/tower list` for a private view in their own language. See the [Discord interaction locale documentation](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-object).

For example, a screenshot uploaded on November 3, 2026 at **17:11:42 Japan time** with `31:48:18` remaining gives:

```text
增益塔｜日本時間 (UTC+9)｜預估可佔領時間
- 27-7 （留空）
- 27-8 （留空）
- 27-9 （留空）
- 27-12 （留空）
- 27-14 （留空）
- 27-17 （留空）
- 27-18 （留空）
- 27-19 [PRIZE] STONE 11/05 01:00
```

The bot needs **View Channel**, **Send Messages**, **Read Message History**, and **Manage Messages**. All members can use the private `/tower list` and `/tower draft` commands; configuring or disabling tracking requires **Manage Channels**. Omit `channel` in `setup` to use the current channel. Setting the same server preserves records; switching servers clears that channel's old records. `/tower disable` stops tracking and clears the current channel's records. Records and period snapshots persist in SQLite (`towers.sqlite`), with pending private drafts in `tower-drafts.sqlite` (both in the existing data volume) or the configured libSQL database. Images themselves are not stored.

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
| `TOWER_TRACKING_ENABLED` | Enables screenshot detection in channels configured with `/tower setup`. Requires Message Content Intent. |
| `TOWER_AI_MODEL` | Optional image-capable model override; otherwise uses `AI_MODEL`. Uses the same API key and base URL. |
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
