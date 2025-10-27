FROM node:22-alpine

WORKDIR /APP

# 基于此Dockerfile的镜像构建在项目根目录进行，以便使用share目录下的文件
COPY ./package.json ./pnpm-lock.yaml ./web/

WORKDIR /APP/web
# ARG NPM_REGISTRY=https://registry.npmmirror.com
# RUN echo "npm registry: $NPM_REGISTRY"
# RUN npm config set registry https://registry.npm.taobao.org
RUN npm config set strict-ssl false
RUN npm install -g pnpm --registry=https://registry.npmmirror.com
RUN pnpm install --registry=https://registry.npmmirror.com

COPY . .
WORKDIR /APP
COPY --from=share . ./share/

WORKDIR /APP/web
RUN npm run build