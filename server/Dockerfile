FROM node:current

WORKDIR /APP

COPY ./package.json ./pnpm-lock.json server/

WORKDIR /APP/server
RUN npm install pnpm
RUN pnpm install

COPY . .
WORKDIR /APP
COPY --from=share . ./share/


EXPOSE 3000

CMD [ "node server/src/app.js" ]
