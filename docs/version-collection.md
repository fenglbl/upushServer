# app_version 集合说明

用于管理客户端版本信息，供 `checkVersion` 云函数读取。

推荐字段：

```json
{
  "platform": "app",
  "version_name": "0.0.2",
  "version_code": 101,
  "status": 1,
  "force_update": false,
  "download_url": "https://example.com/upush.apk",
  "notes": "1. 修复已知问题\n2. 优化设置页体验",
  "create_date": 1710000000000
}
```

字段说明：

- `platform`: 平台标识，当前可先用 `app`
- `version_name`: 版本号，如 `0.0.2`
- `version_code`: 版本编码，如 `101`
- `status`: 是否启用，`1` 为启用
- `force_update`: 是否强制更新
- `download_url`: 更新下载地址
- `notes`: 更新说明
- `create_date`: 创建时间戳

说明：

- `checkVersion` 只读取 `status: 1` 的最新一条版本记录
- 可通过 `create_date` 控制“最新版本”优先级
