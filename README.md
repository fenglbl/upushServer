# upushServer

`upushServer` 是 `upush` 项目的独立后端服务，负责：

- 消息推送接口 `/pushMessage`
- 云函数转发接口 `/cloudfunction`
- 邮箱验证码发送与校验
- 用户安全相关流程（验证旧邮箱、修改邮箱、修改密码、注销账户）
- 健康检查 `/health`

## 技术栈

- Node.js
- Express
- MongoDB
- Resend（邮件发送）
- 个推（UniPush / GeTui）

## 目录结构

```text
upushServer/
├─ app.js
├─ package.json
├─ .env.example
├─ cloudfunctions/
├─ db/
├─ docs/
├─ routes/
├─ unipush/
└─ utils/
```

## 环境要求

- Node.js 18+
- MongoDB 可访问

## 快速开始

```bash
npm install
cp .env.example .env
npm start
```

Windows PowerShell 可参考：

```powershell
Copy-Item .env.example .env
npm install
npm start
```

服务默认监听：

- `http://127.0.0.1:3000`

## 环境变量

请先复制 `.env.example` 为 `.env`，再填写真实配置。

### 个推配置

- `GETUI_APPKEY`
- `GETUI_MASTERSECRET`
- `GETUI_SERVER_URL`

### 数据库配置

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

### 邮件配置

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

### 邮箱验证码风控参数

- `EMAIL_CODE_EXPIRE_MINUTES`
- `EMAIL_CODE_SEND_COOLDOWN_SECONDS`
- `EMAIL_CODE_SEND_WINDOW_MINUTES`
- `EMAIL_CODE_SEND_MAX_PER_WINDOW`

### 可选运行参数

- `PORT`：服务端口，默认 `3000`
- `NODE_ENV`：运行环境，默认 `development`

## 主要接口

### `GET /health`
返回服务与数据库健康状态。

### `POST /pushMessage`
发送推送消息。

### `POST /cloudfunction`
按 `functionName` 调用服务端云函数。

## 建仓前检查建议

在推送到独立仓库之前，建议确认：

- `.env` 没有被提交
- `node_modules/` 没有被提交
- `unipush/getui_token_cache.json` 没有被提交
- 后续若新增日志目录，保持 `logs/` 被忽略
- 确认没有把真实数据库账号、邮件密钥、推送密钥写进文档或示例文件

## 当前状态说明

这个目录已经整理为适合独立建仓的状态：

- 已有 `.gitignore`
- 已保留 `.env.example`
- 已补充 README
- 运行时依赖和敏感文件默认不应纳入版本控制
- 服务端口支持通过 `PORT` 环境变量配置，默认 `3000`
- 云函数目录按项目根目录解析，独立运行更稳定

如果你要在本目录直接创建独立仓库，可执行：

```bash
git init
git add .
git commit -m "chore: initialize upushServer"
```
