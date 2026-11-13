# R5 家长快速入口：云端对接说明（待完成，不能直接上线）

## 用户规则
- 学习通行证页面左上角小按钮“🔒 家长入口”；打开后输入**现有**家长口令。
- 通过家长验证后，在**当前已绑定设备**上获得一次短时免学习资格；不放宽每日 1800 秒总游戏时间，不重置或加时。
- 不修改 V6 学习记录、R5 存档、金币、车辆解锁或家庭设备权限。
- 无网络、认证失败、后端接口未部署、已用完游戏时长：拒绝进入。正式家庭存档不可用于测试。

## 前端已实现
`docs/gate.html` 通过 `POST /v1/parent/game-override` 请求短时授权（JSON: `{family_id,device,action:"grant"}`，头 `x-r5-parent` 传已有家长口令）。
只有返回 HTTP 200、`api === "r5_parent_game_override"`、`authorized === true` 且 `remaining_seconds > 0` 时签发前端防深链凭证并跳转。
前端不会持久化家长口令。此凭证**不是服务端授权**，游戏守卫会重新向云端确认。

## 服务端必须实现（尚未部署）
1. 在 R5 CloudBase 网关增加 `POST /v1/parent/game-override`，复用 `/v1/parent/bind` 的家长身份验证和家庭权限校验，严禁信任客户端提交的家长 UID。
2. 严格确认 `family_id` 属于认证家长、`device` 是该家庭已授权且未撤销的设备，且父母未关闭游戏总开关。
3. 原子地查询**服务端**当天剩余游戏秒数，已达到 1800 秒时拒绝；**不要重置已用游戏秒数**。成功时只在服务端记录一次短时授权：family_id+device_id+parent_uid+expires_at+scope=skip_learning_only。建议有效期不超过 5 分钟，且一次性消费或只能用于当前游戏会话。
4. 在 `/v1/child/entry` 的服务端资格判断中，允许持有有效家长授权的该设备跳过学习条件；但仍校验设备绑定、全局游戏开关、当天剩余时长。没有授权时原学习规则完全不变。
5. 在 `/v1/game/action` 的 `start` 和每次 `tick` / 心跳中，按服务器侧授权及会话核验资格，并按原逻辑扣减当天游戏时间。授权到期后，已开始的会话是否继续须按清晰规则处理，建议仅允许在授权期内启动，之后依原会话和限时继续；不允许再次自动开新会话。
6. `stop`、网络断开和超时仍遵守原会话安全机制；保留原有 fail-closed 行为。加入防爆破：请求频率限制、错误口令重试限制、审计记录（不记录口令）。
7. 成功 JSON 约定：`{"api":"r5_parent_game_override","authorized":true,"remaining_seconds":number,"expires_at":string}`。失败使用适当 401/403/404/429/5xx 和 `error` 字段；`TIME_LIMIT_REACHED` 标识剩余额度不足。
8. 服务端严格不接受客户端伪造 `authorized` 或 `remaining_seconds`。不要把家长口令或口令哈希写入静态站点、URL、localStorage、日志。
9. 在测试家庭 `r5-selftest-family` 运行授权成功、错误口令、跨家庭/撤销设备、过期、额度用尽、异常断网、重放及拒绝伪造等测试；**不得使用正式家庭模拟请求**。

## 上线条件
- CloudBase 端点实际部署且完成安全测试。
- `child/entry` + `game/action` 对家长授权生效，限时仍严格扣减，不得仅凭前端返回放行。
- iPhone 验证家长一次授权可以入场、孩子无密码无法绕过、额度已满禁止进入。
- 才能将此分支合并到 main。当前主站不得切换到这份未完成的功能分支。
