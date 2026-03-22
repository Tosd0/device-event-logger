# device-event-logger

记录用户设备事件的 API 端点，支持通过 MCP 查询。

## 一键部署

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/_CeE7I?referralCode=fcYa38)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Tosd0/device-event-logger)

点击按钮即可自动创建服务和 PostgreSQL 数据库。数据库表会在首次请求时自动初始化。

## 手动部署

### Deno Deploy

1. Fork 或导入此仓库到 GitHub
2. 前往 [dash.deno.com](https://dash.deno.com) 创建项目，关联仓库
3. 设置入口文件为 `entry/deno.ts`
4. 在项目设置中添加环境变量：
   - `DATABASE_URL` — PostgreSQL 连接字符串
   - `API_KEY` — 认证密钥
   - `TZ_OFFSET` — `480`（可选）
5. 部署即可，推送代码会自动重新部署

### Cloudflare Workers

1. 安装 Wrangler CLI：

```bash
npm install -g wrangler
```

2. 创建 `wrangler.toml`：

```toml
name = "device-event-logger"
main = "entry/cloudflare.ts"
compatibility_date = "2024-01-01"
node_compat = true

[vars]
TZ_OFFSET = "480"
```

3. 设置 Secrets：

```bash
wrangler secret put DATABASE_URL
wrangler secret put API_KEY
```

4. 部署：

```bash
wrangler deploy
```

> 注意：CF Workers 需要支持 TCP 连接的 PostgreSQL（如 Neon、Supabase），通过 `cloudflare:sockets` 连接。

### Node.js

```bash
git clone https://github.com/Tosd0/device-event-logger.git
cd device-event-logger
npm install

# 设置环境变量
export DATABASE_URL="postgres://user:pass@host:5432/dbname"
export API_KEY="your-secret-key"
export TZ_OFFSET="480"

# 启动（需要 Node.js >= 22）
npm start
```

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 | 是 |
| `API_KEY` | `/events` 端点的认证密钥 | 是 |
| `TZ_OFFSET` | 与 UTC 的时区偏移（分钟，默认 `480`） | 否 |
| `PORT` | 服务端口（默认 `8000`，仅 Node/Deno） | 否 |
