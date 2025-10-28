FROM node:25-alpine

WORKDIR /app
COPY ./package.json ./pnpm-lock.yaml ./server/

WORKDIR /app/server
RUN npm install -g pnpm && pnpm install

COPY . .
WORKDIR /app
COPY --from=share . ./share/

ENV NODE_ENV=production

EXPOSE $PORT

WORKDIR /app/server
CMD ["node", "src/app.js"]
