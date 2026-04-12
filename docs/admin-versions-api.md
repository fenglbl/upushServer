# Admin Versions API

日期：2026-04-04

## 概述

提供 `upush-admin` 版本管理第一版所需接口。

- 数据集合：`app_version`
- 路由前缀：`/admin`

---

## 1. 获取版本列表

### 请求
`GET /admin/versions`

### Query 参数
- `page`
- `pageSize`
- `keyword`
- `platform`
- `status`：`all | 0 | 1`

### 排序规则
- 默认按 `versionCode` **从大到小** 排序
- 同编码下再按 `publish_time / update_time / _id` 倒序兜底

---

## 2. 获取版本详情

### 请求
`GET /admin/versions/:id`

---

## 3. 创建或更新版本

### 请求
`POST /admin/versions`

### Body 示例
```json
{
  "platform": "app",
  "versionName": "0.0.2",
  "versionCode": 101,
  "status": 0,
  "forceUpdate": false,
  "downloadUrl": "https://example.com/upush.apk",
  "notes": "1. 修复已知问题\n2. 优化设置页体验"
}
```

如果带 `id` 字段，则按更新处理。

---

## 4. 发布版本

### 请求
`POST /admin/versions/:id/publish`

### 行为
- 将同 `platform` 下当前启用版本置为 `status=0`
- 将目标版本置为 `status=1`
- 更新 `publish_time / update_time`
