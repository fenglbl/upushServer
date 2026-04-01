# app_agreement 集合说明

用于存储平台协议内容，支持按协议 id 获取最新发布的一条。

建议集合名：`app_agreement`

推荐字段：

```json
{
  "agreement_id": "user_service",
  "title": "用户服务协议",
  "content": "<h1>用户服务协议</h1><p>这里是富文本内容</p>",
  "publish_time": 1710000000000,
  "status": 1,
  "create_date": 1710000000000
}
```

字段说明：

- `_id`: MongoDB 默认主键
- `agreement_id`: 协议 id，例如 `user_service`、`privacy_policy`
- `title`: 协议标题
- `content`: 协议正文，富文本 HTML 字符串
- `publish_time`: 发布时间时间戳
- `status`: 状态，`1` 表示启用
- `create_date`: 创建时间戳

查询规则：

- 云函数 `getAgreement` 通过 `agreement_id` 查询
- 仅返回 `status: 1` 的记录
- 按 `publish_time` 倒序取最新一条
