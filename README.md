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

## Recurring events

Create the first event with Discord's native scheduled-event interface, then configure recurrence:

```text
/event repeat
```

Choose the event and set the interval. The bot keeps one future occurrence scheduled. Other commands:

- `/event list` — list recurring schedules.
- `/event remove` — stop a schedule without deleting existing events.
- `/event notify channel:#event-notifications` — set the notification channel.
- `/event notify-disable` — disable event notifications.

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
