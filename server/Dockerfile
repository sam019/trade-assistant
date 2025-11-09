# FROM node:25-alpine

# WORKDIR /app
# COPY ./package.json ./pnpm-lock.yaml ./server/

# WORKDIR /app/server
# RUN npm install -g pnpm
# RUN pnpm install

# COPY . .
# WORKDIR /app
# COPY --from=share . ./share/

# ENV NODE_ENV=production TZ='Asia/Shanghai'

# EXPOSE $PORT

# WORKDIR /app/server
# CMD ["node", "src/app.js"]

FROM node:25-alpine

WORKDIR /app

COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
COPY ./share/package.json ./share/
COPY ./server/package.json ./server/

RUN npm install -g pnpm && pnpm install -P

# WORKDIR /app/share
COPY ./share/ ./share/
COPY ./server/ ./server/

WORKDIR /app/server

ENV NODE_ENV=production TZ='Asia/Shanghai'

EXPOSE $PORT

CMD ["node", "src/app.js"]
