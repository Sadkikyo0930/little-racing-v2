# R5 家长入口（账号密码版）· 逐项实测结果

> 本文件由 `tools/render-results.mjs` 从 `tests/artifacts/*.json` 直接渲染，
> 每一行的 `实测返回` 都是接口真实响应的关键字段，不是人工描述。
> 全部用例只访问隔离家庭 `r5-selftest-family`；正式家庭 `little-growth-family-001` 零写入。

| 项 | 值 |
| --- | --- |
| 网关 | `https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5` |
| 网关版本 | `1.4.0-parent-account` |
| 隔离家庭 | `r5-selftest-family` |
| 验收站点 | `https://normal-goose-d5g4qyzr8bb389a4a-1526110019.tcloudbaseapp.com/r5-accept/` |

## A · 三个家长账号的密码校验与冒用拒绝

运行时间：2026-11-13T02:24:35.560Z　|　9/9 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | A:dad 正确密码可授权（角色 parent） | 通过 | `status=200 {"api":"r5_parent_session","authorized":true,"remaining_seconds":1750,"used_seconds":50,"ttl_seconds":120,"member_role":"parent"}` |
| 2 | A:dad 密码错误被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 3 | A:mom 正确密码可授权（角色 owner） | 通过 | `status=200 {"api":"r5_parent_session","authorized":true,"remaining_seconds":1750,"used_seconds":50,"ttl_seconds":120,"member_role":"owner"}` |
| 4 | A:mom 密码错误被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 5 | A:grandma 正确密码可授权（角色 grandparent） | 通过 | `status=200 {"api":"r5_parent_session","authorized":true,"remaining_seconds":1750,"used_seconds":50,"ttl_seconds":120,"member_role":"grandparent"}` |
| 6 | A:grandma 密码错误被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 7 | A:冒用 用别的账号密码登录爸爸账号被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 8 | A:冒用 不存在的账号被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 9 | A:旧口令路径已下线（410，不再接受 x-r5-parent） | 通过 | `status=410 error=R5_PARENT_SECRET_RETIRED` |

## B · 设备状态：未绑定 / 已撤销 / 跨家庭

运行时间：2026-11-13T02:24:39.151Z　|　4/4 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | B1 未绑定设备被拒绝 | 通过 | `status=403 error=R5_DEVICE_NOT_BOUND` |
| 2 | B2 已撤销设备被拒绝 | 通过 | `status=403 error=R5_DEVICE_REVOKED` |
| 3 | B3 跨家庭设备被拒绝 | 通过 | `status=403 error=R5_DEVICE_FAMILY_MISMATCH` |
| 4 | B4 跨家庭设备连进场都拒绝 | 通过 | `status=200 {"error":"R5_MEMBER_DENIED"}` |

## C · 一次性票据全链路（进场 → 开始 → 刷新被拒 → 退出 → 再进被拒）

运行时间：2026-11-13T02:24:42.334Z　|　9/9 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | C1 家长授权成功 | 通过 | `{"api":"r5_parent_session","authorized":true,"remaining_seconds":1750,"used_seconds":50,"ttl_seconds":120,"member_role":"grandparent"}` |
| 2 | C2 授权后可以进场（仅跳过学习条件） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"remaining_seconds":1750,"used_seconds":50,"parent_override":true}` |
| 3 | C3 启动会话时一次性票据被原子消费 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1750,"used_seconds":50,"parent_override":true,"override_consumed":true}` |
| 4 | C4 票据已消费，再次进场被拒绝（刷新/重进需要密码） | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":true,"remaining_seconds":1750,"used_seconds":50,"parent_override":false}` |
| 5 | C5 同一张票据不会被二次消费（已运行的会话只续期，override_consumed=false） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1749,"used_seconds":51,"parent_override":true,"override_consumed":false}` |
| 6 | C6 已启动的会话按原规则继续（心跳放行且照常扣秒） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1747,"used_seconds":53,"parent_override":true,"override_consumed":false}` |
| 7 | C7 主动结束会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1746,"used_seconds":54,"parent_override":false,"override_consumed":false}` |
| 8 | C8 退出后重新进入必须重新验证家长 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1746,"used_seconds":54,"parent_override":false}` |
| 9 | C9 退出后不能凭旧授权开始新会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1746,"used_seconds":54,"parent_override":false,"override_consumed":false}` |

## D · 重放、缺密码、伪造字段、旧口令头

运行时间：2026-11-13T02:24:47.043Z　|　5/5 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | D1 重放测试前置授权 | 通过 | `{"api":"r5_parent_session","authorized":true,"remaining_seconds":1746,"used_seconds":54,"ttl_seconds":120,"member_role":"grandparent"}` |
| 2 | D2 不带密码的请求被拒绝 | 通过 | `status=401 error=R5_PARENT_CREDENTIALS_REQUIRED` |
| 3 | D3 请求体里伪造 authorized/remaining 无效 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 4 | D4 伪造 x-r5-parent 头无效（旧口令通道已关闭） | 通过 | `status=401 error=R5_PARENT_CREDENTIALS_REQUIRED` |
| 5 | D5 仍可用 D1 的票据进场（票据是服务端状态，不是请求内容） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"remaining_seconds":1746,"used_seconds":54,"parent_override":true}` |

## D2 · 票据过期

运行时间：2026-11-13T02:25:01.713Z　|　2/2 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | D6 超过有效期的票据不能进场 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1746,"used_seconds":54,"parent_override":false}` |
| 2 | D7 超过有效期的票据也不能开始会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1746,"used_seconds":54,"parent_override":false,"override_consumed":false}` |

## E · 当天 1800 秒用尽

运行时间：2026-11-13T02:25:15.463Z　|　3/3 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | E1 当天 1800 秒已用完时拒绝签发 | 通过 | `status=403 error=TIME_LIMIT_REACHED` |
| 2 | E2 额度用尽时进场被拒绝且原因是时间用完 | 通过 | `{"api":"r5_status","allowed":false,"reason":"TIME_LIMIT_REACHED","active":false,"remaining_seconds":0,"used_seconds":1800,"parent_override":false}` |
| 3 | E3 额度用尽时无法开始游戏 | 通过 | `{"api":"r5_status","allowed":false,"reason":"TIME_LIMIT_REACHED","active":false,"remaining_seconds":0,"used_seconds":1800,"parent_override":false,"override_consumed":false}` |

## F · 正常学习路径与周边功能不受影响

运行时间：2026-11-13T02:25:22.955Z　|　4/4 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | F1 正常学习达标后可进场（不依赖家长授权） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED","active":false,"remaining_seconds":1746,"used_seconds":54,"parent_override":false}` |
| 2 | F2 学习路径可以开始会话，且没有消耗家长票据 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED","active":true,"remaining_seconds":1746,"used_seconds":54,"parent_override":false,"override_consumed":false}` |
| 3 | F3 家庭存档接口正常（六星闪耀 / 雷霆 Cam3 所在存档链） | 通过 | `status=200 keys=api,action,status,gateway,family_id,sync_enabled,save,birthday_owned,tx_audit,event_count,backup_count,fragment,fragment_program` |
| 4 | F4 生日/六星闪耀接口在线且未 5xx | 通过 | `status=200 {"api":"r5_birthday"}` |

## G · 客户端直接调用数据库授权函数必须被拒

运行时间：2026-11-13T02:24:41.356Z　|　4/4 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | G1 家长账号能拿到 CloudBase 会话 token（用于模拟真实客户端） | 通过 | `status=200` |
| 2 | G:客户端直接调用 r5_override_consume 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_override_consume","requestId":"1aa83777-3356-42dc-` |
| 3 | G:客户端直接调用 r5_parent_override_issue 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_parent_override_issue","requestId":"b26e3400-f548-` |
| 4 | G:客户端直接调用 r5_override_bind 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_override_bind","requestId":"7c3c69c2-83d8-47f7-a10` |

## W · 验收站点协议级"真实退出重进"走查

运行时间：2026-11-13T02:25:41.636Z　|　13/13 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | 页面可打开且已是账号密码版（无 x-r5-parent 旧通道） | 通过 | `gate.html=200 bytes=21425` |
| 2 | 家长账号清单模块可加载（不含任何密码） | 通过 | `parent-accounts.mjs=200 bytes=510` |
| 3 | 未验证家长时进不去（学习未达标） | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1745,"used_seconds":55,"parent_override":false}` |
| 4 | 密码错误被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 5 | 选择账号 + 正确密码 → 拿到一次性授权 | 通过 | `{"api":"r5_parent_session","authorized":true,"remaining_seconds":1745,"used_seconds":55}` |
| 6 | 授权后进场成功（只跳过学习条件） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"remaining_seconds":1745,"used_seconds":55,"parent_override":true}` |
| 7 | 开始游戏时票据被消费 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1745,"used_seconds":55,"parent_override":true,"override_consumed":true}` |
| 8 | 刷新页面后进场被拒绝（不再免密） | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":true,"remaining_seconds":1745,"used_seconds":55,"parent_override":false}` |
| 9 | 重放旧授权不会产生第二次授权消费（start 只是续上同一个会话） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1745,"used_seconds":55,"parent_override":true,"override_consumed":false}` |
| 10 | 结束游戏 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1745,"used_seconds":55,"parent_override":false,"override_consumed":false}` |
| 11 | 退出后重新进入必须再次输入家长密码 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1745,"used_seconds":55,"parent_override":false}` |
| 12 | 退出后凭旧授权无法开始游戏 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1745,"used_seconds":55,"parent_override":false,"override_consumed":false}` |
| 13 | 重新输入密码后可再次进场（额度继续累计，不清零） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"remaining_seconds":1745,"used_seconds":55,"parent_override":true} \| session={"api":"r5_parent_session","authorized":true,"remaining_seconds":1745,"used_seconds":55}` |

## 合计

- 用例总数：**53**
- 通过：**53**
- 失败：**0**

## 测试数据准备（两个用例需要构造数据库状态）

`phase-d2`（票据过期）——先正常签发一张票据，再把时间窗整体前移，
既满足表上 `r5_game_override_window_chk`（`granted_at < expires_at <= granted_at + 5min`），
又让票据落在过期区间：

```sql
UPDATE public.r5_game_override
   SET granted_at = clock_timestamp() - interval '10 minutes',
       expires_at = clock_timestamp() - interval '8 minutes'
 WHERE family_id = 'r5-selftest-family'
   AND device_uid = 'r5dev_acc_ttl_01' AND consumed_at IS NULL;
```

`phase-e`（额度用尽）——把当天已用时长置为 1800 秒，用例跑完立刻恢复原值：

```sql
UPDATE public.r5_daily_usage SET used_ms = 1800000, active = false
 WHERE family_id = 'r5-selftest-family' AND play_date = CURRENT_DATE;
-- 用例结束后恢复为测试前的真实值，不清零、不额外加时间
UPDATE public.r5_daily_usage SET used_ms = 54000, active = false
 WHERE family_id = 'r5-selftest-family' AND play_date = CURRENT_DATE;
```

`phase-f`（正常学习路径）需要当天学习计划为已发布状态，
其余用例（含走查）需要"学习未完成"这一前提，因此计划在 `published = true / false` 之间切换，
切换只发生在隔离家庭。
