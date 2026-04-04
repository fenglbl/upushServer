# Admin Settings API

日期：2026-04-04

## 概述

提供 `upush-admin` 系统设置页的第一版读写接口。

- 数据集合：`admin-settings`
- 当前使用单例记录：`key=default`
- 路由前缀：`/admin`

---

## 1. 获取系统设置

### 请求

`GET /admin/settings`

### 响应示例

```json
{
  "code": 200,
  "msg": "ok",
  "data": {
    "push": {
      "defaultRange": "7d",
      "defaultTargetMode": "user",
      "defaultPayloadTemplate": "default",
      "autoOpenBatchDetail": true
    },
    "logs": {
      "defaultLevel": "",
      "defaultLimit": 100,
      "defaultOrder": "desc",
      "keepQueryInUrl": true
    },
    "ui": {
      "appName": "UPUSH Admin",
      "theme": "light",
      "showQuickActions": true,
      "compactTable": false
    },
    "meta": {
      "key": "default",
      "updatedAt": 0,
      "updatedAtText": "",
      "createdAt": 0,
      "createdAtText": ""
    }
  }
}
```

---

## 2. 保存系统设置

### 请求

`POST /admin/settings`

### Body 示例

```json
{
  "push": {
    "defaultRange": "30d",
    "defaultTargetMode": "user",
    "defaultPayloadTemplate": "default",
    "autoOpenBatchDetail": true
  },
  "logs": {
    "defaultLevel": "ERROR",
    "defaultLimit": 200,
    "defaultOrder": "desc",
    "keepQueryInUrl": true
  },
  "ui": {
    "appName": "UPUSH Admin",
    "theme": "light",
    "showQuickActions": true,
    "compactTable": false
  }
}
```

### 响应

保存成功后返回最新标准化配置。

---

## 3. 字段约束

### push
- `defaultRange`: `7d | 30d | 24h`
- `defaultTargetMode`: `user | group | all`
- `defaultPayloadTemplate`: `default | simple | system_notice`
- `autoOpenBatchDetail`: `boolean`

### logs
- `defaultLevel`: `"" | INFO | WARN | ERROR`
- `defaultLimit`: `1 ~ 500`
- `defaultOrder`: `asc | desc`
- `keepQueryInUrl`: `boolean`

### ui
- `appName`: `string`
- `theme`: `light | dark | system`
- `showQuickActions`: `boolean`
- `compactTable`: `boolean`

---

## 4. 说明

- 若集合中不存在 `key=default` 记录，`GET /admin/settings` 会自动写入默认配置。
- 当前版本是 Sprint 2 的第一版设置能力，目标是先支撑后台设置页回显与保存。
- 后续可以继续扩展为更多配置分组（如通知、版本、反馈、权限等）。
