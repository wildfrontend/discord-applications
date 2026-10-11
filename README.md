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

第一版支援「其他地方」與一般語音頻道活動；Stage 活動需要更多頻道管理權限，暫不處理。bot 需要「建立活動」權限，一般成員只能管理自己建立的活動，具有「管理活動」權限者可以管理全部排程。排程使用 SQLite，預設保存在 `apps/dino-mutant-collections/data/`；舊版 JSON 資料會在啟動時自動遷移。部署 Docker 時請將持久化磁碟掛載到 `/app/data`，也可以用 `BOT_DATA_DIR` 指定其他位置。

## 多語言頻道翻譯

內建繁體中文、英文、日文與韓文，使用 Groq 上的 Qwen 模型提供長句與口語翻譯，Render 等記憶體有限的環境不需要載入本機模型。

將各語言文字頻道放在同一個 Discord 分類後，由頻道管理員建立同步群組：

```text
/translate group category:翻譯頻道 chinese-channel:#中文 english-channel:#english japanese-channel:#日本語 korean-channel:#한국어
/translate status
/translate ungroup
```

至少選擇兩個頻道。群組中任何一個頻道有人發言時，bot 會翻譯並同步到其他語言頻道。也可以用 `/translate link` 保留只有兩個頻道的簡單雙向配對。

多語言群組會在同一次 Groq 請求中產生所有目標語言；例如中文同步到英、日、韓仍只計為 1 次 API 請求。預設會將請求間隔至少 2.1 秒，以符合免費方案的 RPM 限制；可用 `GROQ_MIN_REQUEST_INTERVAL_MS` 調整。

任何訊息也可以使用 **右鍵 → Apps → 翻譯這則訊息**：

- 群組頻道可選擇任一支援的目標語言。
- 雙向配對頻道會自動翻成另一種配對語言。
- 未綁定或無法判斷語言時，會顯示只有操作者看得到的目標語言選單。
- 可用 `/translate config language:繁體中文` 儲存個人預設語言，之後右鍵翻譯不需重複選擇。
- 右鍵手動翻譯不需要 Message Content Intent。

頻道自動翻譯預設關閉。要啟用時：

1. 到 Discord Developer Portal → application → **Bot**。
2. 開啟 **MESSAGE CONTENT INTENT**。
3. 在 `.env` 設定 `TRANSLATION_AUTO_ENABLED=true`。
4. 到 Groq Console 建立免費 API 金鑰後設定：

```env
GROQ_API_KEY=...
GROQ_MODEL=qwen/qwen3.8-27b
```

啟用前應告知伺服器成員訊息會送往第三方服務。`GROQ_API_KEY` 不可 commit 到 Git。此設定不會以 Gemini 作為備援；Groq 失敗或額度用完時只會記錄錯誤。

若使用 Docker Compose，根目錄設定只會啟動 Bot：

```bash
docker compose up -d --build
```

SQLite 資料使用 Docker volume 保存。

## 4. 部署（24 小時上線）

Bot 要持續執行才會回應，正式上線需要放到主機上。根目錄的 `Dockerfile` 可部署到任何支援 Docker 的平台（Railway、Fly.io、Render、VPS 等）：

```bash
docker build --build-arg APP=dino-mutant-collections -t dino-mutant-collections .
docker run -d --restart unless-stopped \
  -e DISCORD_TOKEN=... -e DISCORD_CLIENT_ID=... \
  dino-mutant-collections
```

- 容器啟動時會先同步 slash commands，再啟動 bot。
- 正式環境**不要**設 `DISCORD_GUILD_ID`，指令才會註冊為全域、在所有伺服器可用。
- 在雲端平台上，環境變數請用平台的 secrets / variables 設定。
- Gateway bot 請維持單一 replica；若需要水平擴充，必須先導入 Discord sharding 與分散式排程鎖。

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

瀏覽器開啟 `http://127.0.0.1:4310`，可以查看 Bot 程序、活動排程、翻譯群組與個人語言偏好，並執行單項重設。面板只監聽本機 loopback，不應部署到公開網路。預設讀取 `apps/dino-mutant-collections/data/`，若 Bot 使用自訂資料目錄，請為面板設定相同的 `BOT_DATA_DIR`。

## 新增一個 application

1. 複製 `apps/dino-mutant-collections` 為 `apps/<name>`，修改 `package.json` 的 `name`（例如 `@dc/<name>`）。
2. 在 `src/commands/` 用 `defineCommand` 新增指令，並加到 `src/commands/index.ts`。
3. `pnpm install` 後即可用 `pnpm --filter @dc/<name> dev` 啟動。

多個 app 會用到的邏輯放進 `packages/`，以 `"@dc/xxx": "workspace:*"` 引用。
