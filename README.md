# upushServer

`upushServer` 是 `upush` 项目的独立后端服务仓库，负责推送、云函数转发、数据库连接、邮箱验证码、账户安全相关后端流程等能力。

## 核心能力

- 消息推送接口 `/pushMessage`
- 云函数转发接口 `/cloudfunction`
- 健康检查接口 `/health`
- 邮箱验证码发送与校验
- 旧邮箱验证 / 修改邮箱 / 修改密码 / 注销账户
- MongoDB 数据访问
- 个推（GeTui / UniPush）消息推送

## 技术栈

- Node.js
- Express
- MongoDB
- Resend
- GeTui / UniPush

## 目录结构

```text
upushServer/
├─ app.js
├─ package.json
├─ package-lock.json
├─ .env.example
├─ .gitignore
├─ cloudfunctions/
├─ db/
├─ docs/
├─ routes/
├─ unipush/
├─ utils/
└─ websocket/
```

## 运行环境

- Node.js 18+
- MongoDB 可访问
- 可用的个推配置
- 可用的邮件发送配置（Resend）

## 快速开始

```bash
npm install
cp .env.example .env
npm start
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
npm install
npm start
```

默认监听地址：

- `http://127.0.0.1:3000`

支持通过环境变量覆盖：

- `PORT=3000`

## 环境变量

请复制 `.env.example` 为 `.env` 后填写真实值。

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

### 通用运行参数

- `PORT`：服务端口，默认 `3000`
- `NODE_ENV`：运行环境，默认 `development`

## 主要接口

### `GET /health`
返回服务状态、数据库连接情况、运行环境、运行时长等。

### `POST /pushMessage`
发送推送消息。

### `GET /pushMessage`
通过查询参数提交推送消息。

### `GET /pushMessage/:id`
按目标 ID 提交推送消息。

详细用法见：[`docs/push-message-api.md`](./docs/push-message-api.md)

### `POST /cloudfunction`
按 `functionName` 调用后端云函数。

其中消息列表云函数 `getPushMessage` 的详细说明见：[`docs/get-push-message-api.md`](./docs/get-push-message-api.md)

### `GET /logs`
查看日志文件并按日期、级别、关键词做基础筛选。

详细用法见：[`docs/logs-api.md`](./docs/logs-api.md)

## 当前整理结果

当前仓库已经完成基础独立化整理：

- 已补 `.gitignore`
- 已保留 `.env.example`
- 已首提并推送到独立 GitHub 仓库
- 服务端口支持 `PORT`
- 云函数目录按项目根路径解析，独立运行更稳定
- 运行时缓存默认不会进入版本控制

## 安全注意事项

- 不要提交真实 `.env`
- 不要提交数据库账号、邮件密钥、推送密钥
- 不要提交运行时 token 缓存
- 若历史上暴露过密钥，请尽快轮换
- 生产环境建议补鉴权、日志、限流与 HTTPS

## 后续方向

当前仓库下一步优先考虑：

- 请求日志 / 异常日志 / 审计日志
- `/pushMessage` 鉴权加强
- 推送链路错误回传与可观测性
- 更完整的部署说明
- 后端配置与环境区分

详见：[`ROADMAP.md`](./ROADMAP.md)
