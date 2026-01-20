# TypeScript 迁移指南

本项目已开始迁移到 TypeScript。以下是迁移进度和说明。

## 已完成的工作

### 1. 配置文件
- ✅ `server/tsconfig.json` - 服务器端 TypeScript 配置
- ✅ `web/tsconfig.json` - 前端 TypeScript 配置
- ✅ `share/tsconfig.json` - 共享包 TypeScript 配置

### 2. Share 包（共享代码）
- ✅ `share/src/const.ts` - 常量定义（带类型）
- ✅ `share/src/utils.ts` - 工具函数（带类型）
- ✅ `share/src/index.ts` - 导出文件

### 3. Server 端核心文件
- ✅ `server/src/types/index.ts` - 类型定义
- ✅ `server/src/logger.ts` - 日志模块
- ✅ `server/src/utils.ts` - 工具函数
- ✅ `server/src/bot.ts` - Telegram Bot
- ✅ `server/src/config.ts` - 配置
- ✅ `server/src/database/db.ts` - 数据库模型

### 4. Package.json 更新
- ✅ `server/package.json` - 更新脚本使用 tsx
- ✅ `share/package.json` - 添加构建脚本和类型声明
- ✅ `web/package.json` - 添加 TypeScript 相关依赖

## 待迁移的文件

### Server 端
- [ ] `server/src/app.js` → `app.ts`
- [ ] `server/src/monitor/exchangeMonitor.js` → `exchangeMonitor.ts`
- [ ] `server/src/monitor/monitor.js` → `monitor.ts`
- [ ] `server/src/monitor/orderMonitor.js` → `orderMonitor.ts`
- [ ] `server/src/api/*.js` → `*.ts`
- [ ] `server/src/auth/*.js` → `*.ts`
- [ ] `server/src/service/*.js` → `*.ts`
- [ ] `server/src/checker/*.js` → `*.ts`
- [ ] `server/src/socket/*.js` → `*.ts`

### Web 端
- [ ] `web/src/main.js` → `main.ts`
- [ ] `web/src/config.js` → `config.ts`
- [ ] `web/src/services/*.js` → `*.ts`
- [ ] `web/src/components/*.vue` - 添加 `<script setup lang="ts">` 或类型注解

## 迁移步骤

### 1. 安装依赖
```bash
pnpm install
```

### 2. 构建 Share 包
```bash
cd share
pnpm build
```

### 3. 开发模式运行
```bash
# Server
cd server
pnpm dev

# Web
cd web
pnpm dev
```

### 4. 类型检查
```bash
# Server
cd server
pnpm exec tsc --noEmit

# Web
cd web
pnpm exec vue-tsc --noEmit
```

## 迁移注意事项

### 1. 导入路径
- 所有 `.js` 导入需要改为 `.ts`（TypeScript 会自动处理）
- Share 包导入：`import { ... } from 'share/const.js'` → `import { ... } from 'share/src/const.js'`

### 2. 类型定义
- 使用 `server/src/types/index.ts` 中定义的类型
- CCXT 类型：`import type ccxt from 'ccxt'`
- 自定义类型：`import type { Order, CreateOrderParams } from '../types/index.js'`

### 3. Vue 组件
- 使用 `<script setup lang="ts">` 语法
- 或使用 Options API + TypeScript：`<script lang="ts">`

### 4. 环境变量
- 使用 `process.env` 时需要类型断言或使用 `@types/node`

## 常见问题

### Q: 如何处理动态导入？
A: 使用 `import()` 动态导入，TypeScript 会自动推断类型。

### Q: 如何处理全局变量？
A: 在 `server/src/types/global.d.ts` 中声明：
```typescript
declare global {
    var __Force: any
}
```

### Q: 如何处理 CCXT 的类型？
A: CCXT 已提供类型定义，直接导入使用：
```typescript
import type ccxt from 'ccxt'
const exchange: ccxt.Exchange = ...
```

## 下一步

1. 逐步迁移剩余文件
2. 添加更严格的类型检查
3. 添加 ESLint TypeScript 规则
4. 完善类型定义


