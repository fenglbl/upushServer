# app_contact 集合说明

用于管理联系方式数据。

建议集合名：`app_contact`

推荐字段：

```json
{
  "type": "email",
  "value": "1500827725@qq.com",
  "status": 1,
  "create_date": 1710000000000
}
```

字段说明：

- `_id`: MongoDB 默认主键
- `type`: 联系方式类型，例如 `email`、`wechat`、`phone`
- `value`: 联系方式的值
- `status`: 状态，`1` 表示启用
- `create_date`: 创建时间戳
