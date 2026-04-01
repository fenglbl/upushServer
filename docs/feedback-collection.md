# app_feedback 集合说明

用于存储用户提交的反馈意见。

建议集合名：`app_feedback`

推荐字段：

```json
{
  "type": "bug",
  "contact": "1500827725@qq.com",
  "content": "设置页点击保存后没有响应，希望修复。",
  "screenshots": [
    "https://example.com/feedback/1.png",
    "https://example.com/feedback/2.png"
  ],
  "reply_status": 0,
  "reply_content": "",
  "reply_time": 0,
  "status": 1,
  "create_date": 1710000000000
}
```

字段说明：

- `_id`: MongoDB 默认主键
- `type`: 反馈类型，例如 `bug`、`suggestion`、`other`
- `contact`: 联系方式，可以存邮箱、手机号、微信等
- `content`: 反馈意见正文
- `screenshots`: 截图数组，支持多张，存图片地址列表
- `reply_status`: 是否已回复，`0` 未回复，`1` 已回复
- `reply_content`: 回复内容
- `reply_time`: 回复时间戳
- `status`: 数据状态，`1` 正常，`0` 删除或停用
- `create_date`: 创建时间戳

说明建议：

- `screenshots` 建议统一存可访问的图片 URL 数组
- `type` 建议前后端约定固定枚举，避免后续统计困难
- `reply_status` 与 `reply_content`、`reply_time` 配合使用，便于后台处理反馈闭环
