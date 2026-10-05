# dc-applications

自製 Discord applications 的 monorepo，使用 pnpm workspaces + Turborepo + TypeScript。

## 結構

```
apps/                 # 每個 Discord application 一個資料夾
  example-bot/        # 範例 bot（/ping）
packages/             # 共用套件
  core/               # @dc/core：client 建立、slash command 分派與註冊、env 工具
```

## 開始

```bash
pnpm install
cp apps/example-bot/.env.example apps/example-bot/.env   # 填入 token / client id

pnpm --filter @dc/example-bot deploy-commands   # 註冊 slash commands
pnpm --filter @dc/example-bot dev               # 開發模式（watch）
```

## 常用指令

| 指令 | 說明 |
| --- | --- |
| `pnpm dev` | 啟動所有 app 的開發模式 |
| `pnpm build` | 建置所有套件與 app |
| `pnpm typecheck` | 型別檢查 |
| `pnpm lint` / `pnpm format` | Biome 檢查 / 自動修正 |

## 新增一個 application

1. 複製 `apps/example-bot` 為 `apps/<name>`，修改 `package.json` 的 `name`（例如 `@dc/<name>`）。
2. 在 `src/commands/` 用 `defineCommand` 新增指令，並加到 `src/commands/index.ts`。
3. `pnpm install` 後即可用 `pnpm --filter @dc/<name> dev` 啟動。

多個 app 會用到的邏輯放進 `packages/`，以 `"@dc/xxx": "workspace:*"` 引用。
