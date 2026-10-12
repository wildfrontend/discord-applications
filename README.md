# dc-applications

自製 Discord applications 的 monorepo，使用 pnpm workspaces + Turborepo + TypeScript。

## 結構

```
apps/                 # 每個 Discord application 一個資料夾
  dino-mutant-collections/ # Discord 活動與多語言翻譯 bot
  dev-panel/              # 本機資料檢視與重設後台
packages/             # 共用套件
  core/               # @dc/core：client 建立、slash／右鍵指令分派與註冊、env 工具
```

## 1. 在 Discord 建立 application

1. 到 [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**。
2. **General Information** 頁複製 **Application ID** → 填到 `DISCORD_CLIENT_ID`。
3. **Bot** 頁按 **Reset Token** 複製 token → 填到 `DISCORD_TOKEN`（token 等同密碼，不要 commit）。
4. 開發時建議填 `DISCORD_GUILD_ID`（Discord 開啟開發者模式後，對伺服器按右鍵 → 複製伺服器 ID），指令會立即生效；全域指令可能要等一段時間才出現。

```bash
pnpm install
cp apps/dino-mutant-collections/.env.example apps/dino-mutant-collections/.env   # 填入上面的值
```

## 2. 邀請 bot 進伺服器

```bash
pnpm --filter @dc/dino-mutant-collections invite   # 印出邀請連結，用瀏覽器開啟並選擇伺服器
```

## 3. 本機執行

```bash
pnpm --filter @dc/dino-mutant-collections deploy-commands   # 註冊 slash commands
pnpm --filter @dc/dino-mutant-collections dev               # 開發模式（watch）
```

在伺服器輸入 `/ping`，bot 回覆 `Pong!` 就成功了。

## 自訂重複活動

先使用 Discord 原生的「建立活動」介面建立第一場，再使用 bot 擴充其週期：

1. 輸入 `/event repeat`。
2. 在 `activity` 選擇既有的單次活動。
3. 使用 `every` 與 `unit` 設定「每 N 分鐘／小時／天／週」；分鐘週期最少 15 分鐘。
4. bot 會立即建立下一場，並在執行期間持續維持一場未來活動。

活動時間沿用 Discord 的時間戳記，會依每位使用者的本地時區顯示。

其他管理指令：

- `/event list`：列出自訂重複排程。
- `/event remove`：停止排程，不刪除已建立的 Discord 活動。
- `/event notify channel:#活動通知`：設定全伺服器共用的活動通知頻道；Bot 建立下一場循環活動時會發送時間與活動連結。
- `/event notify-disable`：關閉活動頻道通知。

第一版支援「其他地方」與一般語音頻道活動；Stage 活動需要更多頻道管理權限，暫不處理。Bot 需要「建立活動」與「管理活動」權限，一般成員只能管理自己建立的活動，具有「管理活動」權限者可以管理全部排程。預設使用 SQLite，資料保存在 `apps/dino-mutant-collections/data/`；舊版 JSON 資料會在啟動時自動遷移。Docker Compose 會將資料保存在具名 volume，也可以用 `BOT_DATA_DIR` 指定其他位置。

## Multilingual translation

The bot supports Traditional Chinese, English, Japanese, and Korean. It uses an OpenAI-compatible cloud model for natural long-form and conversational translation, so memory-constrained services such as Render do not need to load a local model. The default configuration uses a Qwen model hosted by Groq.

The `/translate` command interface is localized in English, Traditional Chinese, and Korean. Discord automatically displays the version matching each user's Discord language setting.

To synchronize language channels, place them in the same Discord category and have a channel manager create a translation group:

```text
/translate group category:translation-channels chinese-channel:#chinese english-channel:#english japanese-channel:#japanese korean-channel:#korean
/translate status
/translate ungroup
```

Select at least two channels. When someone posts in any channel in the group, the bot translates the message and synchronizes it to the other language channels. Use `/translate link` instead for a simple two-channel, two-way translation link.

A multilingual group generates every target language in one AI request. For example, translating Chinese into English, Japanese, and Korean still uses only one API request. Requests are spaced at least 2.1 seconds apart by default; adjust `AI_MIN_REQUEST_INTERVAL_MS` to match your provider's limits.

You can also translate any message with **right-click → Apps → Translate this message**:

- In a translation-group channel, you can choose any supported target language.
- In a two-way linked channel, the bot automatically uses the other channel's language.
- In an unlinked channel, or when the language is ambiguous, the bot shows a private target-language menu.
- Use `/translate config input-language:Traditional Chinese output-language:Japanese` to save personal defaults. Message context-menu translation uses the saved target language.
- Manual context-menu translation does not require Message Content Intent.

To translate your own text before posting it publicly:

```text
/translate send message:Hello everyone
```

`send` uses your personal source and target defaults, then posts through a webhook with your server nickname and avatar. You can override either default with `input-language` or `output-language` each time. If no source is configured, the bot auto-detects it. If no target is configured, you must select one in the command. The bot needs the **Manage Webhooks** permission in the current channel.

Automatic channel translation is disabled by default. To enable it:

1. Open Discord Developer Portal → your application → **Bot**.
2. Enable **MESSAGE CONTENT INTENT**.
3. Set `TRANSLATION_AUTO_ENABLED=true` in `.env`.
4. Configure the API key, model, and base URL for an OpenAI-compatible provider. For example, with Groq:

```env
AI_API_KEY=...
AI_MODEL=qwen/qwen3.8-27b
AI_BASE_URL=https://api.groq.com/openai/v1
AI_PROVIDER_NAME=groq
# Groq on-demand has a relatively small per-request output limit; 900 is enough for typical Discord messages.
AI_MAX_OUTPUT_TOKENS=900
```

Tell server members that their messages will be sent to a third-party service before enabling automatic translation. Never commit `AI_API_KEY`. The key must belong to the service configured by `AI_BASE_URL`, and the model must be available from that provider; the bot does not automatically switch to a fallback provider. Automatic translation uses webhooks to preserve the original sender's nickname and avatar, so the bot also needs **Manage Webhooks** permission.

## 4. Docker 自架

根目錄的 `Dockerfile` 會產生只有 Bot 與正式依賴的映像；同一份映像可用在本機、NAS、VPS 或支援 Docker 的雲端平台。

已發布的多平台映像位於 `ghcr.io/wildfrontend/dino-mutant-collections:latest`，支援 `linux/amd64` 與 `linux/arm64`。使用線上映像時不需要在自架機器安裝 Node.js 或 pnpm，也不需要自行建置：

```bash
git clone https://github.com/wildfrontend/discord-applications.git
cd discord-applications
docker compose -f compose.self-host.yaml run --rm setup
docker compose -f compose.self-host.yaml up -d bot
docker compose -f compose.self-host.yaml logs -f bot
```

更新線上映像並重建容器：

```bash
docker compose -f compose.self-host.yaml pull
docker compose -f compose.self-host.yaml up -d bot
```

第一次自架可使用互動式設定精靈，不需要手動編輯 `.env`：

```bash
docker compose run --rm --build setup
docker compose up -d bot
docker compose logs -f bot
```

設定精靈會逐步詢問 Discord、AI、翻譯與資料庫設定；Token 採隱藏輸入，完成後以只有檔案擁有者能讀寫的權限儲存到 `apps/dino-mutant-collections/.env`。它也能驗證 Discord Token 並產生 Bot 邀請連結。

之後若要修改設定，可再次執行：

```bash
docker compose run --rm setup
docker compose up -d --force-recreate bot
```

也可以從範例手動建立 `.env`，再啟動：

```bash
cp apps/dino-mutant-collections/.env.example apps/dino-mutant-collections/.env
docker compose up -d --build
docker compose logs -f bot
```

Compose 預設使用 SQLite，並將 `/app/data` 掛載到 `bot-data` volume。更新版本不會清除資料：

```bash
git pull --ff-only
docker compose up -d --build
```

健康檢查位於 `http://127.0.0.1:10000/healthz`。停止服務使用 `docker compose down`；除非確定要刪除 Bot 資料，請勿加上 `--volumes`。

若不使用 Compose，也可以直接執行映像：

```bash
docker build --build-arg APP=dino-mutant-collections -t dino-mutant-collections .
docker run -d --restart unless-stopped \
  --env-file apps/dino-mutant-collections/.env \
  -e BOT_DATA_DIR=/app/data -e PORT=10000 \
  -v dino-bot-data:/app/data \
  dino-mutant-collections
```

- 容器啟動時會先同步 slash commands，再啟動 bot。
- 正式環境**不要**設 `DISCORD_GUILD_ID`，指令才會註冊為全域、在所有伺服器可用。
- 在雲端平台上，環境變數請用平台的 secrets / variables 設定。
- Gateway bot 請維持單一 replica。遠端資料庫模式有租約鎖，可避免平台換版時新舊容器短暫重疊，但這不是 Discord sharding，不能用來水平擴充。

## 5. 部署到 Render

根目錄的 `render.yaml` 是可直接使用的 Blueprint。建立 Render Web Service 或 Blueprint、連接此 GitHub repository 後，Render 會使用 `Dockerfile` 建置。

Render 免費 Web Service 的檔案系統是暫時性的，因此不能把 SQLite 放在容器內。先建立任一個 libSQL 相容的遠端資料庫，再於 Render 填入：

```env
DATABASE_DRIVER=libsql
DATABASE_URL=libsql://...
DATABASE_AUTH_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_TOKEN=...
AI_API_KEY=...
```

其他 AI 參數已放在 Blueprint 中，仍可在 Render Dashboard 修改。若需要頻道自動翻譯，另將 `TRANSLATION_AUTO_ENABLED` 改成 `true`，並在 Discord Developer Portal 打開 Message Content Intent。正式環境通常不設定 `DISCORD_GUILD_ID`。

Render 會自動提供 `PORT`，Bot 會監聽 `0.0.0.0:$PORT` 並提供 `/healthz`。免費 Web Service 在沒有外部 HTTP 請求一段時間後會休眠；Discord Gateway 連線本身不算網站流量，所以免費方案適合測試，不保證 Bot 24 小時在線。正式長期使用建議改用付費 Background Worker、具持久化磁碟的服務，或自行架設的 VPS。

資料庫模式可透過環境變數切換：

| 場景 | `DATABASE_DRIVER` | 持久化方式 |
| --- | --- | --- |
| 本機／Docker Compose／VPS | `sqlite` | 掛載 `/app/data` volume |
| Render 免費方案 | `libsql` | 外部 libSQL 相容資料庫 |
| Render 付費且有 Persistent Disk | `sqlite` | 將磁碟掛載到 `/app/data` |

## 常用指令

| 指令 | 說明 |
| --- | --- |
| `pnpm dev` | 啟動所有 app 的開發模式 |
| `pnpm dev:panel` | 只啟動本機 Dev Panel（http://127.0.0.1:4310） |
| `pnpm build` | 建置所有套件與 app |
| `pnpm typecheck` | 型別檢查 |
| `pnpm lint` / `pnpm format` | Biome 檢查 / 自動修正 |

## Dev Panel

Bot 啟動後，可在另一個終端開啟本機後台：

```bash
pnpm dev:panel
```

若 Bot 使用 Docker Compose 運行，請改用共用同一個 SQLite volume 的後台服務：

```bash
docker compose --profile tools up -d --build dev-panel
```

瀏覽器開啟 `http://127.0.0.1:4310`，可以管理 Bot 的 `.env`、查看程序、活動排程、翻譯群組與個人語言偏好，並執行單項重設。Token 與 API Key 只會顯示是否已設定，面板不會把明文回傳到瀏覽器；儲存設定後需重啟 Bot 才會生效。面板只監聽本機 loopback，不應部署到公開網路。資料檢視與重設目前只支援本機 SQLite；使用遠端 libSQL 時請透過資料庫供應商的 Dashboard 管理。

## 新增一個 application

1. 複製 `apps/dino-mutant-collections` 為 `apps/<name>`，修改 `package.json` 的 `name`（例如 `@dc/<name>`）。
2. 在 `src/commands/` 用 `defineCommand` 新增指令，並加到 `src/commands/index.ts`。
3. `pnpm install` 後即可用 `pnpm --filter @dc/<name> dev` 啟動。

多個 app 會用到的邏輯放進 `packages/`，以 `"@dc/xxx": "workspace:*"` 引用。
