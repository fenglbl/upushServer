# pushMessage 接口使用文档

`/pushMessage` 用于向指定用户的已登记设备发送推送消息。

当前接口支持：

- `POST /pushMessage`
- `GET /pushMessage`
- `GET /pushMessage/:id`

服务默认地址示例：

- `http://127.0.0.1:3000`

---

## 1. 接口能力说明

`pushMessage` 的主要流程：

1. 根据用户 id 查询已登记设备
2. 将推送消息写入 `uni-push-message`
3. 调用个推（GeTui / UniPush）向目标设备发送通知
4. 返回成功 / 部分成功 / 失败结果
5. 如果目标用户当前有 WebSocket 在线连接，还会向 `/ws/:id` 广播实时消息

---

## 2. 请求参数

### 必填参数

- `id`：目标用户 id
- `title`：推送标题

### 可选参数

- `content`：推送内容，默认空字符串
- `payload`：附加数据
  - 可以传字符串
  - 也可以传对象
  - 服务端会自动规范为对象 payload
  - 默认会补充这些字段：
    - `type`：默认 `push_message`
    - `action`：默认 `open_home_message_list`
    - `route`：默认 `/pages/home/index`
    - `mid`：消息记录 id
  - 发送给个推时会自动转成字符串

---

## 3. 调用方式

### 3.1 POST /pushMessage

适合 webhook 或后端调用。

#### 请求示例

```http
POST /pushMessage HTTP/1.1
Host: 127.0.0.1:3000
Content-Type: application/json

{
  "id": "67ecf2d4c9f4d2b5b9d91234",
  "title": "测试通知",
  "content": "这是一条测试推送",
  "payload": {
    "type": "test",
    "from": "webhook"
  }
}
```

#### curl 示例

```bash
curl -X POST "http://127.0.0.1:3000/pushMessage" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "67ecf2d4c9f4d2b5b9d91234",
    "title": "测试通知",
    "content": "这是一条测试推送",
    "payload": {
      "type": "test",
      "from": "webhook"
    }
  }'
```

---

### 3.2 GET /pushMessage

通过 query 参数提交推送。

#### 请求示例

```http
GET /pushMessage?id=67ecf2d4c9f4d2b5b9d91234&title=%E6%B5%8B%E8%AF%95%E9%80%9A%E7%9F%A5&content=%E8%BF%99%E6%98%AF%E4%B8%80%E6%9D%A1%E6%B5%8B%E8%AF%95%E6%8E%A8%E9%80%81 HTTP/1.1
Host: 127.0.0.1:3000
```

#### curl 示例

```bash
curl "http://127.0.0.1:3000/pushMessage?id=67ecf2d4c9f4d2b5b9d91234&title=测试通知&content=这是一条测试推送"
```

> 注意：如果 `payload` 是对象，建议优先使用 `POST`。

---

### 3.3 GET /pushMessage/:id

把目标用户 id 放到路径里，其他参数走 query。

#### 请求示例

```http
GET /pushMessage/67ecf2d4c9f4d2b5b9d91234?title=%E6%B5%8B%E8%AF%95%E9%80%9A%E7%9F%A5&content=%E8%BF%99%E6%98%AF%E4%B8%80%E6%9D%A1%E6%B5%8B%E8%AF%95%E6%8E%A8%E9%80%81 HTTP/1.1
Host: 127.0.0.1:3000
```

#### curl 示例

```bash
curl "http://127.0.0.1:3000/pushMessage/67ecf2d4c9f4d2b5b9d91234?title=测试通知&content=这是一条测试推送"
```

---

## 4. 返回结果说明

### 4.1 全部成功

返回码：`200`

```json
{
  "code": 200,
  "msg": "推送请求已提交",
  "data": {
    "totalDevices": 1,
    "successCount": 1,
    "failureCount": 0,
    "results": [
      {
        "ok": true,
        "deviceId": "xxxxxxxx",
        "messageId": "67ecf6f0c9f4d2b5b9d94567",
        "providerResponse": {
          "code": 0,
          "msg": "success"
        }
      }
    ]
  }
}
```

---

### 4.2 部分设备成功，部分失败

返回码：`207`

```json
{
  "code": 207,
  "msg": "部分设备推送失败",
  "data": {
    "totalDevices": 2,
    "successCount": 1,
    "failureCount": 1,
    "results": [
      {
        "ok": true,
        "deviceId": "device-a",
        "messageId": "67ecf6f0c9f4d2b5b9d94567",
        "providerResponse": {
          "code": 0,
          "msg": "success"
        }
      },
      {
        "ok": false,
        "deviceId": "device-b",
        "error": "Request failed with status code 400",
        "providerCode": 20001,
        "providerMsg": "param is invalid",
        "providerResponse": {
          "msg": "param is invalid",
          "code": 20001
        }
      }
    ]
  }
}
```

---

### 4.3 全部失败

返回码：`500`

```json
{
  "code": 500,
  "msg": "推送失败",
  "data": {
    "totalDevices": 1,
    "successCount": 0,
    "failureCount": 1,
    "results": [
      {
        "ok": false,
        "deviceId": "xxxxxxxx",
        "error": "Request failed with status code 400",
        "providerCode": 20001,
        "providerMsg": "param is invalid",
        "providerResponse": {
          "msg": "param is invalid",
          "code": 20001
        }
      }
    ]
  }
}
```

---

### 4.4 目标用户没有设备

返回码：`404`

```json
{
  "code": 404,
  "msg": "目标用户没有可用设备",
  "data": {
    "totalDevices": 0,
    "successCount": 0,
    "failureCount": 0,
    "results": []
  }
}
```

---

### 4.5 参数错误

#### 缺少 id

```json
{
  "code": 202,
  "msg": "id error"
}
```

#### 缺少 title

```json
{
  "code": 202,
  "msg": "title error"
}
```

#### 用户 id 格式错误

```json
{
  "code": 201,
  "msg": "目标用户 id 格式错误",
  "data": {}
}
```

---

## 5. payload 说明

推荐：

- webhook / 服务端调用优先使用 `POST`
- `payload` 建议传 JSON 对象

例如：

```json
{
  "type": "order_created",
  "orderId": "A10086",
  "source": "my-webhook"
}
```

服务端处理时会：

1. 在数据库消息记录中保留 payload
2. 自动补一个 `mid`
3. 发给个推前自动转成字符串

因此客户端如果需要读取 `payload`，应按 JSON 字符串解析。

---

## 6. WebSocket 联动说明

如果目标用户当前在线并建立了：

- `ws://127.0.0.1:3000/ws/:id`

那么 `pushMessage` 在推送成功时，还会额外广播一条实时消息。

广播数据示例：

```json
{
  "type": "push",
  "id": "67ecf2d4c9f4d2b5b9d91234",
  "title": "测试通知",
  "content": "这是一条测试推送",
  "payload": {
    "type": "test"
  },
  "time": 1743610000000
}
```

> 注意：WebSocket 广播只代表服务端本地实时通知，不等于个推厂商通道一定最终送达。

---

## 7. 当前已知事项

- 当前 `/pushMessage` 适合 webhook / 内部服务调用
- 当前未启用强制鉴权（因为现阶段需要兼容 webhook 调用）
- 若后续需要增强安全性，建议采用：
  - 可配置开关式鉴权
  - 来源白名单
  - webhook 签名校验
  - 基础限流

---

## 8. 排查建议

如果返回：

- `500 推送失败`
- 或 `207 部分设备推送失败`

优先看：

- `data.results[].providerCode`
- `data.results[].providerMsg`
- `data.results[].providerResponse`

例如：

- `20001 / param is invalid`：通常表示发给个推的参数格式不合法
- `10001`：通常表示 token 失效，服务端当前会自动刷新并重试一次

同时也可以结合：

- `logs/*.log`
- `/ws/logger`

一起排查。
