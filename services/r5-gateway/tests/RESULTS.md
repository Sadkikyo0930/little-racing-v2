# R5 家长入口（账号密码 + 会话绑定版）· 逐项实测结果

> 本文件由 `tools/render-results.mjs` 从 `tests/artifacts/*.json` 直接渲染，
> 每一行的 `实测返回` 都是接口真实响应的关键字段，不是人工描述。
> 全部用例只访问隔离家庭 `r5-selftest-family`；正式家庭 `little-growth-family-001` 零写入。

| 项 | 值 |
| --- | --- |
| 网关 | `https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5` |
| 网关版本 | `1.5.0-session-bound` |
| 隔离家庭 | `r5-selftest-family` |
| 验收站点 | `https://normal-goose-d5g4qyzr8bb389a4a-1526110019.tcloudbaseapp.com/r5-accept/` |

## A · 三个家长账号的密码校验与冒用拒绝

运行时间：2026-11-13T03:52:13.028Z　|　9/9 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | A:dad 正确密码可授权（角色 parent） | 通过 | `status=200 {"api":"r5_parent_session","authorized":true,"remaining_seconds":1657,"used_seconds":143,"ttl_seconds":120,"member_role":"parent"}` |
| 2 | A:dad 密码错误被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 3 | A:mom 正确密码可授权（角色 owner） | 通过 | `status=200 {"api":"r5_parent_session","authorized":true,"remaining_seconds":1657,"used_seconds":143,"ttl_seconds":120,"member_role":"owner"}` |
| 4 | A:mom 密码错误被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 5 | A:grandma 正确密码可授权（角色 grandparent） | 通过 | `status=200 {"api":"r5_parent_session","authorized":true,"remaining_seconds":1657,"used_seconds":143,"ttl_seconds":120,"member_role":"grandparent"}` |
| 6 | A:grandma 密码错误被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 7 | A:冒用 用别的账号密码登录爸爸账号被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 8 | A:冒用 不存在的账号被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 9 | A:旧口令路径已下线（410，不再接受 x-r5-parent） | 通过 | `status=410 error=R5_PARENT_SECRET_RETIRED` |

## B · 设备状态：未绑定 / 已撤销 / 跨家庭

运行时间：2026-11-13T03:52:18.499Z　|　4/4 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | B1 未绑定设备被拒绝 | 通过 | `status=403 error=R5_DEVICE_NOT_BOUND` |
| 2 | B2 已撤销设备被拒绝 | 通过 | `status=403 error=R5_DEVICE_REVOKED` |
| 3 | B3 跨家庭设备被拒绝 | 通过 | `status=403 error=R5_DEVICE_FAMILY_MISMATCH` |
| 4 | B4 跨家庭设备连进场都拒绝 | 通过 | `status=200 {"error":"R5_MEMBER_DENIED"}` |

## C · 一次性票据全链路（进场 → 开始 → 刷新被拒 → 退出 → 再进被拒）

运行时间：2026-11-13T03:52:20.725Z　|　11/11 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | C1 家长授权成功 | 通过 | `{"api":"r5_parent_session","authorized":true,"remaining_seconds":1657,"used_seconds":143,"ttl_seconds":120,"member_role":"grandparent"}` |
| 2 | C2 授权后可以进场（仅跳过学习条件） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"remaining_seconds":1657,"used_seconds":143,"parent_override":true}` |
| 3 | C3 启动会话时一次性票据被原子消费，并下发服务端会话标识 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1657,"used_seconds":143,"parent_override":true,"override_consumed":true}` |
| 4 | C4 票据已消费，再次进场被拒绝（刷新/重进需要密码） | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":true,"remaining_seconds":1657,"used_seconds":143,"parent_override":false}` |
| 5 | C5 重复 start 被拒绝：一次授权只能创建一个游戏会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"remaining_seconds":1657,"used_seconds":143,"parent_override":false,"override_consumed":false}` |
| 6 | C5b 带会话标识只能续接同一个会话（session_id 不变） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1657,"used_seconds":143,"parent_override":true,"override_consumed":false}` |
| 7 | C6 已启动的会话按原规则继续（带标识心跳放行且照常扣秒） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1654,"used_seconds":146,"parent_override":true,"override_consumed":false}` |
| 8 | C6b 心跳不带会话标识被拒绝，且不误杀已有会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"remaining_seconds":1654,"used_seconds":146,"parent_override":false,"override_consumed":false}` |
| 9 | C7 主动结束会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1654,"used_seconds":146,"parent_override":false,"override_consumed":false}` |
| 10 | C8 退出后重新进入必须重新验证家长 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1654,"used_seconds":146,"parent_override":false}` |
| 11 | C9 退出后不能凭旧授权开始新会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"remaining_seconds":1654,"used_seconds":146,"parent_override":false,"override_consumed":false}` |

## D · 重放、缺密码、伪造字段、旧口令头

运行时间：2026-11-13T03:52:25.850Z　|　5/5 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | D1 重放测试前置授权 | 通过 | `{"api":"r5_parent_session","authorized":true,"remaining_seconds":1654,"used_seconds":146,"ttl_seconds":120,"member_role":"grandparent"}` |
| 2 | D2 不带密码的请求被拒绝 | 通过 | `status=401 error=R5_PARENT_CREDENTIALS_REQUIRED` |
| 3 | D3 请求体里伪造 authorized/remaining 无效 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 4 | D4 伪造 x-r5-parent 头无效（旧口令通道已关闭） | 通过 | `status=401 error=R5_PARENT_CREDENTIALS_REQUIRED` |
| 5 | D5 仍可用 D1 的票据进场（票据是服务端状态，不是请求内容） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"remaining_seconds":1654,"used_seconds":146,"parent_override":true}` |

## D2 · 票据过期

运行时间：2026-11-13T03:54:09.548Z　|　2/2 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | D6 超过有效期的票据不能进场 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1647,"used_seconds":153,"parent_override":false}` |
| 2 | D7 超过有效期的票据也不能开始会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"remaining_seconds":1647,"used_seconds":153,"parent_override":false,"override_consumed":false}` |

## E · 当天 1800 秒用尽

运行时间：2026-11-13T03:54:53.221Z　|　3/3 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | E1 当天 1800 秒已用完时拒绝签发 | 通过 | `status=403 error=TIME_LIMIT_REACHED` |
| 2 | E2 额度用尽时进场被拒绝且原因是时间用完 | 通过 | `{"api":"r5_status","allowed":false,"reason":"TIME_LIMIT_REACHED","active":false,"remaining_seconds":0,"used_seconds":1800,"parent_override":false}` |
| 3 | E3 额度用尽时无法开始游戏 | 通过 | `{"api":"r5_status","allowed":false,"reason":"TIME_LIMIT_REACHED","active":false,"remaining_seconds":0,"used_seconds":1800,"parent_override":false,"override_consumed":false}` |

## F · 正常学习路径与周边功能不受影响

运行时间：2026-11-13T03:54:27.074Z　|　4/4 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | F1 正常学习达标后可进场（不依赖家长授权） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED","active":false,"remaining_seconds":1647,"used_seconds":153,"parent_override":false}` |
| 2 | F2 学习路径可以开始会话，且没有消耗家长票据 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED","active":true,"remaining_seconds":1647,"used_seconds":153,"parent_override":false,"override_consumed":false}` |
| 3 | F3 家庭存档接口正常（六星闪耀 / 雷霆 Cam3 所在存档链） | 通过 | `status=200 keys=api,action,status,gateway,family_id,sync_enabled,save,birthday_owned,tx_audit,event_count,backup_count,fragment,fragment_program` |
| 4 | F4 生日/六星闪耀接口在线且未 5xx | 通过 | `status=200 {"api":"r5_birthday"}` |

## G · 客户端直接调用数据库授权函数必须被拒

运行时间：2026-11-13T03:52:27.787Z　|　9/9 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | G1 家长账号能拿到 CloudBase 会话 token（用于模拟真实客户端） | 通过 | `status=200` |
| 2 | G:客户端直接调用 r5_override_consume 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_override_consume","requestId":"fcc23e1c-c480-4805-` |
| 3 | G:客户端直接调用 r5_parent_override_issue 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_parent_override_issue","requestId":"fad97013-164d-` |
| 4 | G:客户端直接调用 r5_override_bind 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_override_bind","requestId":"705ad36a-63da-48b4-9b8` |
| 5 | G:客户端直接调用 r5_session_open 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_session_open","requestId":"e7b33e76-bf61-4c09-9043` |
| 6 | G:客户端直接调用 r5_session_close 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_session_close","requestId":"b476c434-3a1c-4d45-a95` |
| 7 | G:客户端直接调用 r5_session_beat 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_session_beat","requestId":"ab458723-ee98-456c-afce` |
| 8 | G:客户端直接调用 r5_gate_status_core 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_gate_status_core","requestId":"b3b9e17e-f691-4313-` |
| 9 | G:客户端直接调用 r5_override_bind_session 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_override_bind_session","requestId":"7a1f52d9-06e9-` |

## H1 · 会话绑定：重复 start / 刷新 / 重放（本轮修复）

运行时间：2026-11-13T03:52:33.931Z　|　17/17 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | H1 家长账号授权成功（票据未消费） | 通过 | `{"api":"r5_parent_session","used_seconds":147,"remaining_seconds":1653,"session_id":null,"session_origin":null,"authorized":true}` |
| 2 | H2 持票据时进场放行（仅跳过学习条件） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"used_seconds":147,"remaining_seconds":1653,"parent_override":true,"session_id":null,"session_origin":null,"session_bound":true}` |
| 3 | H3 首次 start 返回服务端会话标识，且票据被原子消费 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":147,"remaining_seconds":1653,"parent_override":true,"override_consumed":true,"session_id":"521839f2609145ca9a7a53cf06a299b3","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 4 | H4 重复 start（不带标识）被拒绝——本轮修复的核心 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":147,"remaining_seconds":1653,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1}` |
| 5 | H5 被拒绝的重复 start 不会回传会话标识 | 通过 | `session_id=null` |
| 6 | H6 刷新页面（新客户端无标识）仍进不去，且票据无法二次消费 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":147,"remaining_seconds":1653,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1} \| {"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":true,"used_seconds":147,"remaining_seconds":1653,"parent_override":false,"session_id":null,"session_origin":null,"session_bound":true}` |
| 7 | H7 带原会话标识可以续接同一个会话（不是新会话） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":147,"remaining_seconds":1653,"parent_override":true,"override_consumed":false,"session_id":"521839f2609145ca9a7a53cf06a299b3","session_origin":"parent_override","session_resumed":true,"session_bound":true,"active_devices":1}` |
| 8 | H8 心跳带标识放行并照常计费 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":147,"remaining_seconds":1653,"parent_override":true,"override_consumed":false,"session_id":"521839f2609145ca9a7a53cf06a299b3","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 9 | H9 心跳不带标识被拒绝，且不泄漏标识 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":148,"remaining_seconds":1652,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1}` |
| 10 | H10 伪造会话标识被拒绝 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":148,"remaining_seconds":1652,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1}` |
| 11 | H11 上述拒绝没有误杀正在进行的会话（原标识仍可心跳） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":148,"remaining_seconds":1652,"parent_override":true,"override_consumed":false,"session_id":"521839f2609145ca9a7a53cf06a299b3","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 12 | H12 会话标识也可以通过 x-r5-session 请求头传递 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":148,"remaining_seconds":1652,"parent_override":true,"override_consumed":false,"session_id":"521839f2609145ca9a7a53cf06a299b3","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 13 | H13 累计时长单调不减（1800 秒上限只减不增） | 通过 | `used 147 -> 148` |
| 14 | H14 结束会话后 active=false | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"used_seconds":148,"remaining_seconds":1652,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |
| 15 | H15 会话重放：结束后用旧标识 start 被拒绝 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"used_seconds":148,"remaining_seconds":1652,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |
| 16 | H16 结束后不带标识 start 同样被拒绝（已消费票据不能开第二次） | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"used_seconds":148,"remaining_seconds":1652,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |
| 17 | H17 结束后再进场需要重新家长验证 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"used_seconds":148,"remaining_seconds":1652,"parent_override":false,"session_id":null,"session_origin":null,"session_bound":true}` |

## H2 · 会话绑定：断线恢复、断线超时失效

运行时间：2026-11-13T03:52:36.894Z　|　7/7 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | H18 重新授权后可创建新会话（旧授权已作废） | 通过 | `{"api":"r5_parent_session","used_seconds":148,"remaining_seconds":1652,"session_id":null,"session_origin":null,"authorized":true} \| {"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":148,"remaining_seconds":1652,"parent_override":true,"override_consumed":true,"session_id":"4646a7caaeb44a83bc8603bd0d469a63","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 2 | H19 短暂断线（3 秒无心跳）后带标识可原地恢复 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":151,"remaining_seconds":1649,"parent_override":true,"override_consumed":false,"session_id":"4646a7caaeb44a83bc8603bd0d469a63","session_origin":"parent_override","session_resumed":true,"session_bound":true,"active_devices":1}` |
| 3 | H20 断线超过空闲上限后心跳被拒绝 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"used_seconds":151,"remaining_seconds":1649,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |
| 4 | H21 断线超时后旧标识无法恢复会话（不会长期免密重进） | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"used_seconds":151,"remaining_seconds":1649,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |
| 5 | H22 断线超时后再进场需要家长重新验证 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"used_seconds":151,"remaining_seconds":1649,"parent_override":false,"session_id":null,"session_origin":null,"session_bound":true}` |
| 6 | H23 超时后重新验证家长可以重新开始，并拿到全新会话标识 | 通过 | `{"api":"r5_parent_session","used_seconds":151,"remaining_seconds":1649,"session_id":null,"session_origin":null,"authorized":true} \| {"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":151,"remaining_seconds":1649,"parent_override":true,"override_consumed":true,"session_id":"cc248863a316463e9ae93e2f8d5da822","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 7 | H24 旧会话标识在新会话开始后仍然无效 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":151,"remaining_seconds":1649,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1}` |

## H3 · 会话绑定：多设备并发

运行时间：2026-11-13T03:53:33.041Z　|　9/9 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | H25 设备A 授权并开始会话 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":151,"remaining_seconds":1649,"parent_override":true,"override_consumed":true,"session_id":"0032566e580441c2a426d22ab5a4c67d","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 2 | H26 设备B 没有票据时 start 被拒绝（不能搭便车） | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":152,"remaining_seconds":1648,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1}` |
| 3 | H27 设备B 拿设备A 的会话标识也无法续接（标识绑定设备） | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":152,"remaining_seconds":1648,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1}` |
| 4 | H28 设备B 自己授权后可开始自己的会话，标识与A 不同 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":152,"remaining_seconds":1648,"parent_override":true,"override_consumed":true,"session_id":"c07310b768484cb499b2fe548a259179","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":2}` |
| 5 | H29 设备A 用设备B 的标识被拒绝 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":153,"remaining_seconds":1647,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":2}` |
| 6 | H30 两台设备各自心跳都放行 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":153,"remaining_seconds":1647,"parent_override":true,"override_consumed":false,"session_id":"0032566e580441c2a426d22ab5a4c67d","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":2} \| {"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":153,"remaining_seconds":1647,"parent_override":true,"override_consumed":false,"session_id":"c07310b768484cb499b2fe548a259179","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":2}` |
| 7 | H31 服务端同时看到两个活跃会话 | 通过 | `active_devices=2` |
| 8 | H32 A 结束后 A 被拒，B 不受影响 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":153,"remaining_seconds":1647,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1} \| {"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":153,"remaining_seconds":1647,"parent_override":true,"override_consumed":false,"session_id":"c07310b768484cb499b2fe548a259179","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 9 | H33 B 结束后两台都无活跃会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"used_seconds":153,"remaining_seconds":1647,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |

## H4 · 正常学习路径不受影响

运行时间：2026-11-13T03:54:32.230Z　|　4/4 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | H34 学习达标时不需要票据也能开始（session_origin=study） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED","active":true,"used_seconds":153,"remaining_seconds":1647,"parent_override":false,"override_consumed":false,"session_id":"927bfde3a0504c15a65968fb37498c77","session_origin":"study","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 2 | H35 学习路径带标识心跳正常 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED","active":true,"used_seconds":154,"remaining_seconds":1646,"parent_override":false,"override_consumed":false,"session_id":"927bfde3a0504c15a65968fb37498c77","session_origin":"study","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 3 | H36 旧前端（心跳不带标识）在学习路径下仍可用 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED","active":true,"used_seconds":154,"remaining_seconds":1646,"parent_override":false,"override_consumed":false,"session_id":"1377f04fb1224c059856087746bb08e3","session_origin":"study","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 4 | H37 学习路径结束会话正常 | 通过 | `{"api":"r5_status","allowed":false,"reason":"STUDY_PASSED","active":false,"used_seconds":154,"remaining_seconds":1646,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |

## H5 · 额度用尽时的会话拒绝

运行时间：2026-11-13T03:54:54.550Z　|　3/3 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | H38 额度用尽时家长授权被拒绝（TIME_LIMIT_REACHED） | 通过 | `status=403 {"session_id":null,"session_origin":null,"error":"TIME_LIMIT_REACHED"}` |
| 2 | H39 额度用尽时 start 被拒绝 | 通过 | `{"api":"r5_status","allowed":false,"reason":"TIME_LIMIT_REACHED","active":false,"used_seconds":1800,"remaining_seconds":0,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |
| 3 | H40 额度用尽时心跳被拒绝 | 通过 | `{"api":"r5_status","allowed":false,"reason":"TIME_LIMIT_REACHED","active":false,"used_seconds":1800,"remaining_seconds":0,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |

## L · 前端联通、旧口令下线与线上页面版本（CORS / 三账号 / 410）

运行时间：　|　17/17 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | L0 隔离家庭测试账号已就绪（不打印密码） | 通过 | `r5test_dad 已从 .local 加载` |
| 2 | L1 跨域预检放行 | 通过 | `status=204` |
| 3 | L2 预检允许 x-r5-device 与 x-r5-session 头 | 通过 | `allow-headers=content-type,x-r5-device,x-r5-session` |
| 4 | L3 未带密码被拒绝（fail-closed） | 通过 | `status=401 error=R5_PARENT_CREDENTIALS_REQUIRED` |
| 5 | L4 账号+密码返回 200 且 api=r5_parent_session | 通过 | `status=200 api=r5_parent_session` |
| 6 | L5 authorized=true（前端据此才跳转） | 通过 | `authorized=true` |
| 7 | L6 remaining_seconds>0（前端第二道校验） | 通过 | `remaining=1647` |
| 8 | L7 一次性票据有效期 <= 120 秒 | 通过 | `ttl=120` |
| 9 | L8 响应带跨域头，浏览器可读 | 通过 | `acao=*` |
| 10 | L9 受权设备 child/entry 放行（只跳过学习条件） | 通过 | `allowed=true reason=STUDY_PASSED_WITH_WAIVER` |
| 11 | L10 旧口令端点固定 410 R5_PARENT_SECRET_RETIRED | 通过 | `status=410 error=R5_PARENT_SECRET_RETIRED` |
| 12 | L11 网关版本为 1.5.0-session-bound 且开启会话绑定 | 通过 | `version=1.5.0-session-bound session_binding=true idle=45` |
| 13 | L12 验收站点 gate.html 可访问 | 通过 | `status=200` |
| 14 | L12 验收站点 r5/parent-accounts.mjs 可访问 | 通过 | `status=200` |
| 15 | L12 验收站点 r5/r5-online.mjs 可访问 | 通过 | `status=200` |
| 16 | L13 线上 gate.html 已是三账号版（无旧口令通道） | 通过 | `len=21425 session=true` |
| 17 | L14 验收站点家庭为 r5-selftest-family | 通过 | `config 已隔离` |

## W · 验收站点协议级"真实退出重进"走查

运行时间：2026-11-13T03:52:33.604Z　|　15/15 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | 页面可打开且已是账号密码版（无 x-r5-parent 旧通道） | 通过 | `gate.html=200 bytes=21425` |
| 2 | 家长账号清单模块可加载（不含任何密码） | 通过 | `parent-accounts.mjs=200 bytes=510` |
| 3 | 未验证家长时进不去（学习未达标） | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1654,"used_seconds":146,"parent_override":false,"session_id":null,"session_origin":null}` |
| 4 | 密码错误被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 5 | 选择账号 + 正确密码 → 拿到一次性授权 | 通过 | `{"api":"r5_parent_session","authorized":true,"remaining_seconds":1654,"used_seconds":146,"session_id":null,"session_origin":null}` |
| 6 | 授权后进场成功（只跳过学习条件） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"remaining_seconds":1654,"used_seconds":146,"parent_override":true,"session_id":null,"session_origin":null}` |
| 7 | 开始游戏时票据被消费，并拿到服务端会话标识 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1654,"used_seconds":146,"parent_override":true,"override_consumed":true,"session_id":"c64edaff014349219f7f2db224c28607","session_origin":"parent_override","session_resumed":false}` |
| 8 | 刷新页面后进场被拒绝（不再免密） | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":true,"remaining_seconds":1654,"used_seconds":146,"parent_override":false,"session_id":null,"session_origin":null}` |
| 9 | 刷新后再次 start 被拒绝（已消费票据 + 设备身份不再足够） | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"remaining_seconds":1654,"used_seconds":146,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false}` |
| 10 | 带原会话标识可以续接同一个会话，标识不变 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1654,"used_seconds":146,"parent_override":true,"override_consumed":false,"session_id":"c64edaff014349219f7f2db224c28607","session_origin":"parent_override","session_resumed":true}` |
| 11 | 结束游戏 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1653,"used_seconds":147,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false}` |
| 12 | 退出后重新进入必须再次输入家长密码 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1653,"used_seconds":147,"parent_override":false,"session_id":null,"session_origin":null}` |
| 13 | 退出后凭旧授权无法开始游戏 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"remaining_seconds":1653,"used_seconds":147,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false}` |
| 14 | 重新输入密码后可再次进场（额度继续累计，不清零） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"remaining_seconds":1653,"used_seconds":147,"parent_override":true,"session_id":null,"session_origin":null} \| session={"api":"r5_parent_session","authorized":true,"remaining_seconds":1653,"used_seconds":147,"session_id":null,"session_origin":null}` |
| 15 | 重新验证后可以创建全新会话（新标识与上一次不同） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1653,"used_seconds":147,"parent_override":true,"override_consumed":true,"session_id":"6cf1612720764916bfe45de5247aa03c","session_origin":"parent_override","session_resumed":false}` |

## 合计

- 用例总数：**119**
- 通过：**119**
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
