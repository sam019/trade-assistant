FROM node:25-alpine as build-stage

WORKDIR /app

COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
COPY ./share/package.json ./share/
COPY ./web/package.json ./web/

RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY ./share/ ./share/
COPY ./web/ ./web/

WORKDIR /app/web

ENV NODE_ENV=production

RUN npm run build

FROM caddy:2-alpine

COPY --from=build-stage /app/web/dist /srv/www
