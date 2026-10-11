# 用法：docker build --build-arg APP=dino-mutant-collections -t dino-mutant-collections .
ARG APP=dino-mutant-collections

FROM node:24-slim AS build
ARG APP
RUN npm install -g pnpm@11.9.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@dc/${APP}...
# 產出只含該 app 正式依賴的獨立資料夾（workspace 套件會被複製進去）
RUN pnpm deploy --filter=@dc/${APP} --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=build /out .
USER node
# 每次啟動先同步 slash commands（失敗不影響 bot 上線），再啟動 bot
CMD ["sh", "-c", "node dist/deploy-commands.js; exec node dist/index.js"]
