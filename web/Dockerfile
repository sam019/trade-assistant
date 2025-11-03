FROM node:25-alpine as build-stage

WORKDIR /app
COPY ./package.json ./pnpm-lock.yaml ./web/

WORKDIR /app/web
RUN npm install -g pnpm
RUN pnpm install

COPY . .
WORKDIR /app
COPY --from=share . ./share/

ENV NODE_ENV=production

WORKDIR /app/web
RUN npm run build

FROM caddy:2-alpine
COPY --from=build-stage /app/web/dist /srv/www
