# getPushMessage 接口说明

`getPushMessage` 用于获取当前登录用户在当前设备上的推送消息列表。

当前通过 `/cloudfunction` 统一入口调用。

---

## 1. 调用方式

```http
POST /cloudfunction
Content-Type: application/json
```

请求体：

```json
{
  "functionName": "getPushMessage",
  "params": {
    "token": "用户 token",
    "device_id": "当前设备 cid",
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 2. 参数说明

### 必填参数

- `token`：当前登录用户 token
- `device_id`：当前设备 push client id / cid

### 可选参数

- `page`：页码，默认 `1`
- `pageSize`：每页条数，默认 `20`

---

## 3. 返回结构

成功时返回：

```json
{
  "code": 200,
  "msg": "",
  "data": {
    "list": [
      {
        "id": "67ecf6f0c9f4d2b5b9d94567",
        "_id": "67ecf6f0c9f4d2b5b9d94567",
        "user_id": "67ecf2d4c9f4d2b5b9d91234",
        "title": "测试通知",
        "content": "这是一条测试推送",
        "payload": {
          "type": "push_message",
          "action": "open_home_message_list",
          "route": "/pages/home/index",
          "mid": "67ecf6f0c9f4d2b5b9d94567"
        },
        "create_time": 1743610000000
      }
    ],
    "total": 3
  }
}
```

---

## 4. 字段说明

### `data.list`
当前页消息列表。

### `data.total`
总页数（不是总条数）。

### `list[].id`
**统一后的固定消息 id 字段。**

这是当前前端应优先使用的字段，用于：

- 消息列表定位
- 通知点击跳转后按 `mid` 匹配消息
- 后续消息详情页跳转

> 当前服务端会保留原始 `_id`，但前端应优先使用 `id`，不要再依赖 `_id / id / mid` 多字段兜底。

### `list[].payload`
消息附加数据。

推送链路里默认会带：

- `type`
- `action`
- `route`
- `mid`

用于 App 端点击通知后的跳转处理。

---

## 5. 典型错误返回

### token 不存在

```json
{
  "code": 202,
  "msg": "token不存在",
  "data": {}
}
```

### token 过期

```json
{
  "code": 202,
  "msg": "token过期",
  "data": []
}
```

### token 异常

```json
{
  "code": 202,
  "msg": "token异常",
  "data": []
}
```

---

## 6. 当前用途

当前这个接口主要用于：

- 首页消息列表展示
- 通知点击后根据 `mid` 定位消息
- 后续消息详情 / 后台消息管理能力扩展

---

## 7. 当前已知事项

- 当前查询维度是：`用户 + device_id`
- 返回的 `total` 是总页数，不是总记录数
- 当前返回结构已统一补 `id` 字段，前端应统一使用 `id`
