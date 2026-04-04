# Admin Agreements API

日期：2026-04-04

## 概述

提供 `upush-admin` 协议管理页第一版所需接口。

- 数据集合：`app_agreement`
- 路由前缀：`/admin`

---

## 1. 获取协议列表

### 请求
`GET /admin/agreements`

### Query 参数
- `page`
- `pageSize`
- `keyword`
- `agreementId` / `agreement_id`
- `status`：`all | 0 | 1`

---

## 2. 获取协议详情

### 请求
`GET /admin/agreements/:id`

---

## 3. 创建或更新协议

### 请求
`POST /admin/agreements`

### Body 示例
```json
{
  "agreementId": "user_service",
  "title": "用户服务协议",
  "content": "<h1>用户服务协议</h1><p>这里是正文</p>",
  "status": 0
}
```

如果带 `id` 字段，则按更新处理。

---

## 4. 发布协议

### 请求
`POST /admin/agreements/:id/publish`

### 行为
- 将同 `agreement_id` 下当前启用版本置为 `status=0`
- 将目标版本置为 `status=1`
- 更新 `publish_time`
