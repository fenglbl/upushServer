# 日志查看接口说明

`/logs` 用于查看 `logs/` 目录下按天生成的日志文件，并支持基础筛选。

当前是轻量版实现：

- 直接读取 `logs/YYYY-MM-DD.log`
- 支持按日期、级别、关键词、消息内容筛选
- 适合快速排查线上问题

---

## 1. 接口地址

```http
GET /logs
```

示例：

```text
http://127.0.0.1:3000/logs
```

---

## 2. 查询参数

### `date`
日志日期，格式：`YYYY-MM-DD`

- 默认值：当天
- 示例：`2026-04-03`

### `level`
按日志级别筛选。

可选值示例：

- `INFO`
- `WARN`
- `ERROR`

### `keyword`
在整行日志文本中做关键字匹配（不区分大小写）。

适合查：

- `pushMessage`
- `security audit`
- `cloudfunction executed`
- 用户 id / 设备 id

### `message`
只在 message 区域中做关键字匹配（不区分大小写）。

适合查：

- `push delivery failed`
- `request completed`
- `getui push request failed`

### `limit`
返回条数。

- 默认值：`100`
- 最大值：`500`

### `order`
排序方式：

- `desc`：倒序，最新日志优先（默认）
- `asc`：正序

---

## 3. 调用示例

### 3.1 查看当天最新 100 条日志

```bash
curl "http://127.0.0.1:3000/logs"
```

### 3.2 查看指定日期日志

```bash
curl "http://127.0.0.1:3000/logs?date=2026-04-03"
```

### 3.3 只看 ERROR 日志

```bash
curl "http://127.0.0.1:3000/logs?date=2026-04-03&level=ERROR"
```

### 3.4 查 push 相关日志

```bash
curl "http://127.0.0.1:3000/logs?date=2026-04-03&keyword=push"
```

### 3.5 查安全审计日志

```bash
curl "http://127.0.0.1:3000/logs?date=2026-04-03&keyword=security%20audit"
```

### 3.6 查 message 中包含 request completed 的日志

```bash
curl "http://127.0.0.1:3000/logs?date=2026-04-03&message=request%20completed"
```

### 3.7 正序查看前 50 条

```bash
curl "http://127.0.0.1:3000/logs?date=2026-04-03&limit=50&order=asc"
```

---

## 4. 成功返回示例

```json
{
  "code": 200,
  "msg": "ok",
  "data": {
    "date": "2026-04-03",
    "file": "E:\\Desktop\\upush\\upushServer\\logs\\2026-04-03.log",
    "totalLines": 128,
    "returned": 20,
    "filters": {
      "level": "ERROR",
      "keyword": "push",
      "message": null,
      "limit": 20,
      "order": "desc"
    },
    "entries": [
      {
        "index": 128,
        "raw": "[2026-04-03 00:10:01] [ERROR] push delivery failed ...",
        "parsed": true,
        "time": "2026-04-03 00:10:01",
        "level": "ERROR",
        "message": "push delivery failed { ... }"
      }
    ]
  }
}
```

---

## 5. 错误返回示例

### 5.1 日期格式错误

```json
{
  "code": 400,
  "msg": "date 参数格式错误，应为 YYYY-MM-DD",
  "data": {}
}
```

### 5.2 日志文件不存在

```json
{
  "code": 404,
  "msg": "日志文件不存在",
  "data": {
    "date": "2026-04-01",
    "file": "E:\\Desktop\\upush\\upushServer\\logs\\2026-04-01.log"
  }
}
```

### 5.3 服务端读取失败

```json
{
  "code": 500,
  "msg": "日志查询失败",
  "error": "..."
}
```

---

## 6. 返回字段说明

### `entries[].raw`
原始日志整行文本。

### `entries[].parsed`
是否成功按当前日志格式解析。

- `true`：已识别出时间、级别、message
- `false`：只返回原始文本

### `entries[].time`
日志时间，例如：

```text
2026-04-03 00:10:01
```

### `entries[].level`
日志级别，例如：

- `INFO`
- `WARN`
- `ERROR`

### `entries[].message`
解析后的 message 区域。

---

## 7. 当前限制

当前版本是轻量实现，限制如下：

- 只支持单日日志文件查询
- 直接读文件，不走数据库索引
- 适合排查和人工查看，不适合超大规模日志检索
- 复杂筛选目前只支持：`date / level / keyword / message / limit / order`

---

## 8. 后续可增强方向

后续如果要继续增强，可以考虑：

- 多日期范围查询
- 按 action / userId / functionName 精细筛选
- 结构化日志落盘
- 日志查看页
- 下载日志文件
- WebSocket 实时日志筛选
