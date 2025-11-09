FROM node:25-alpine

WORKDIR /app

COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
COPY ./share/package.json ./share/
COPY ./server/package.json ./server/

RUN npm install -g pnpm && pnpm install -P --frozen-lockfile

COPY ./share/ ./share/
COPY ./server/ ./server/

WORKDIR /app/server

ENV NODE_ENV=production TZ='Asia/Shanghai'

EXPOSE $PORT

CMD ["node", "src/app.js"]
