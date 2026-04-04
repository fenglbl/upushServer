# Admin Feedback API

日期：2026-04-04

## 概述

提供 `upush-admin` 反馈中心第一版所需接口。

- 数据集合：`app_feedback`
- 路由前缀：`/admin`

---

## 1. 获取反馈列表

### 请求
`GET /admin/feedback`

### Query 参数
- `page`
- `pageSize`
- `keyword`
- `type`：`all | bug | suggestion | other`
- `replyStatus`：`all | 0 | 1`

### 返回
- `list`
- `total`
- `page`
- `pageSize`
- `meta`

---

## 2. 获取反馈详情

### 请求
`GET /admin/feedback/:id`

---

## 3. 回复反馈

### 请求
`POST /admin/feedback/:id/reply`

### Body 示例
```json
{
  "replyContent": "我们已经定位到问题，会尽快修复。",
  "replyStatus": 1
}
```

### 字段说明
- `replyContent`: 回复内容，必填
- `replyStatus`: 回复状态，当前 `1` 表示已回复；若未传则按 `0/1` 规范化

---

## 4. 当前返回字段

```json
{
  "id": "...",
  "type": "bug",
  "contact": "1500827725@qq.com",
  "content": "设置页点击保存后没有响应，希望修复。",
  "screenshots": [],
  "replyStatus": 0,
  "replyContent": "",
  "replyTime": 0,
  "replyTimeText": "",
  "status": 1,
  "createDate": 1710000000000,
  "createDateText": "2026-04-04 20:00:00"
}
```
