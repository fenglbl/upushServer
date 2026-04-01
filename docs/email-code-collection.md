# app_email_code 集合说明

用于存储邮箱验证码。

建议集合名：`app_email_code`

推荐字段：

```json
{
  "email": "user@example.com",
  "scene": "register",
  "code": "123456",
  "status": 1,
  "used": 0,
  "expire_time": 1710000000000,
  "create_date": 1710000000000,
  "update_date": 1710000000000
}
```

字段说明：

- `email`: 邮箱地址
- `scene`: 验证码场景，例如 `register`、`update_email`
- `code`: 验证码
- `status`: 状态，`1` 有效，`0` 无效
- `used`: 是否已使用，`0` 未使用，`1` 已使用
- `expire_time`: 过期时间戳
- `create_date`: 创建时间戳
- `update_date`: 更新时间戳
