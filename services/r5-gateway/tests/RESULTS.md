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

运行时间：2026-11-13T02:49:23.111Z　|　9/9 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | A:dad 正确密码可授权（角色 parent） | 通过 | `status=200 {"api":"r5_parent_session","authorized":true,"remaining_seconds":1710,"used_seconds":90,"ttl_seconds":120,"member_role":"parent"}` |
| 2 | A:dad 密码错误被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 3 | A:mom 正确密码可授权（角色 owner） | 通过 | `status=200 {"api":"r5_parent_session","authorized":true,"remaining_seconds":1710,"used_seconds":90,"ttl_seconds":120,"member_role":"owner"}` |
| 4 | A:mom 密码错误被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 5 | A:grandma 正确密码可授权（角色 grandparent） | 通过 | `status=200 {"api":"r5_parent_session","authorized":true,"remaining_seconds":1710,"used_seconds":90,"ttl_seconds":120,"member_role":"grandparent"}` |
| 6 | A:grandma 密码错误被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 7 | A:冒用 用别的账号密码登录爸爸账号被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 8 | A:冒用 不存在的账号被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 9 | A:旧口令路径已下线（410，不再接受 x-r5-parent） | 通过 | `status=410 error=R5_PARENT_SECRET_RETIRED` |

## B · 设备状态：未绑定 / 已撤销 / 跨家庭

运行时间：2026-11-13T02:49:27.269Z　|　4/4 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | B1 未绑定设备被拒绝 | 通过 | `status=403 error=R5_DEVICE_NOT_BOUND` |
| 2 | B2 已撤销设备被拒绝 | 通过 | `status=403 error=R5_DEVICE_REVOKED` |
| 3 | B3 跨家庭设备被拒绝 | 通过 | `status=403 error=R5_DEVICE_FAMILY_MISMATCH` |
| 4 | B4 跨家庭设备连进场都拒绝 | 通过 | `status=200 {"error":"R5_MEMBER_DENIED"}` |

## C · 一次性票据全链路（进场 → 开始 → 刷新被拒 → 退出 → 再进被拒）

运行时间：2026-11-13T02:49:29.542Z　|　11/11 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | C1 家长授权成功 | 通过 | `{"api":"r5_parent_session","authorized":true,"remaining_seconds":1710,"used_seconds":90,"ttl_seconds":120,"member_role":"grandparent"}` |
| 2 | C2 授权后可以进场（仅跳过学习条件） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"remaining_seconds":1710,"used_seconds":90,"parent_override":true}` |
| 3 | C3 启动会话时一次性票据被原子消费，并下发服务端会话标识 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1710,"used_seconds":90,"parent_override":true,"override_consumed":true}` |
| 4 | C4 票据已消费，再次进场被拒绝（刷新/重进需要密码） | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":true,"remaining_seconds":1710,"used_seconds":90,"parent_override":false}` |
| 5 | C5 重复 start 被拒绝：一次授权只能创建一个游戏会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"remaining_seconds":1709,"used_seconds":91,"parent_override":false,"override_consumed":false}` |
| 6 | C5b 带会话标识只能续接同一个会话（session_id 不变） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1709,"used_seconds":91,"parent_override":true,"override_consumed":false}` |
| 7 | C6 已启动的会话按原规则继续（带标识心跳放行且照常扣秒） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1706,"used_seconds":94,"parent_override":true,"override_consumed":false}` |
| 8 | C6b 心跳不带会话标识被拒绝，且不误杀已有会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"remaining_seconds":1706,"used_seconds":94,"parent_override":false,"override_consumed":false}` |
| 9 | C7 主动结束会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1706,"used_seconds":94,"parent_override":false,"override_consumed":false}` |
| 10 | C8 退出后重新进入必须重新验证家长 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1706,"used_seconds":94,"parent_override":false}` |
| 11 | C9 退出后不能凭旧授权开始新会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"remaining_seconds":1706,"used_seconds":94,"parent_override":false,"override_consumed":false}` |

## D · 重放、缺密码、伪造字段、旧口令头

运行时间：2026-11-13T02:49:34.493Z　|　5/5 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | D1 重放测试前置授权 | 通过 | `{"api":"r5_parent_session","authorized":true,"remaining_seconds":1706,"used_seconds":94,"ttl_seconds":120,"member_role":"grandparent"}` |
| 2 | D2 不带密码的请求被拒绝 | 通过 | `status=401 error=R5_PARENT_CREDENTIALS_REQUIRED` |
| 3 | D3 请求体里伪造 authorized/remaining 无效 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 4 | D4 伪造 x-r5-parent 头无效（旧口令通道已关闭） | 通过 | `status=401 error=R5_PARENT_CREDENTIALS_REQUIRED` |
| 5 | D5 仍可用 D1 的票据进场（票据是服务端状态，不是请求内容） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"remaining_seconds":1706,"used_seconds":94,"parent_override":true}` |

## D2 · 票据过期

运行时间：2026-11-13T02:49:50.364Z　|　2/2 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | D6 超过有效期的票据不能进场 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1706,"used_seconds":94,"parent_override":false}` |
| 2 | D7 超过有效期的票据也不能开始会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"remaining_seconds":1706,"used_seconds":94,"parent_override":false,"override_consumed":false}` |

## E · 当天 1800 秒用尽

运行时间：2026-11-13T02:50:40.937Z　|　3/3 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | E1 当天 1800 秒已用完时拒绝签发 | 通过 | `status=403 error=TIME_LIMIT_REACHED` |
| 2 | E2 额度用尽时进场被拒绝且原因是时间用完 | 通过 | `{"api":"r5_status","allowed":false,"reason":"TIME_LIMIT_REACHED","active":false,"remaining_seconds":0,"used_seconds":1800,"parent_override":false}` |
| 3 | E3 额度用尽时无法开始游戏 | 通过 | `{"api":"r5_status","allowed":false,"reason":"TIME_LIMIT_REACHED","active":false,"remaining_seconds":0,"used_seconds":1800,"parent_override":false,"override_consumed":false}` |

## F · 正常学习路径与周边功能不受影响

运行时间：2026-11-13T02:50:24.495Z　|　4/4 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | F1 正常学习达标后可进场（不依赖家长授权） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED","active":false,"remaining_seconds":1705,"used_seconds":95,"parent_override":false}` |
| 2 | F2 学习路径可以开始会话，且没有消耗家长票据 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED","active":true,"remaining_seconds":1705,"used_seconds":95,"parent_override":false,"override_consumed":false}` |
| 3 | F3 家庭存档接口正常（六星闪耀 / 雷霆 Cam3 所在存档链） | 通过 | `status=200 keys=api,action,status,gateway,family_id,sync_enabled,save,birthday_owned,tx_audit,event_count,backup_count,fragment,fragment_program` |
| 4 | F4 生日/六星闪耀接口在线且未 5xx | 通过 | `status=200 {"api":"r5_birthday"}` |

## G · 客户端直接调用数据库授权函数必须被拒

运行时间：2026-11-13T02:50:16.759Z　|　9/9 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | G1 家长账号能拿到 CloudBase 会话 token（用于模拟真实客户端） | 通过 | `status=200` |
| 2 | G:客户端直接调用 r5_override_consume 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_override_consume","requestId":"e24bf523-0f82-432b-` |
| 3 | G:客户端直接调用 r5_parent_override_issue 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_parent_override_issue","requestId":"32d4bde0-998e-` |
| 4 | G:客户端直接调用 r5_override_bind 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_override_bind","requestId":"910fb6d9-ac2e-4ff7-bb3` |
| 5 | G:客户端直接调用 r5_session_open 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_session_open","requestId":"d6dc1251-2b34-48f1-8b9a` |
| 6 | G:客户端直接调用 r5_session_close 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_session_close","requestId":"219ed197-d6a3-4b41-984` |
| 7 | G:客户端直接调用 r5_session_beat 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_session_beat","requestId":"db46d2ac-bdc9-42b8-9c12` |
| 8 | G:客户端直接调用 r5_gate_status_core 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_gate_status_core","requestId":"0a8c7d51-c40f-42e9-` |
| 9 | G:客户端直接调用 r5_override_bind_session 被拒绝 | 通过 | `status=403 body={"code":"DATABASE_42501","message":"permission denied for function r5_override_bind_session","requestId":"bfd18889-ef56-` |

## H1 · 会话绑定：重复 start / 刷新 / 重放（本轮修复）

运行时间：2026-11-13T02:46:39.090Z　|　17/17 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | H1 家长账号授权成功（票据未消费） | 通过 | `{"api":"r5_parent_session","used_seconds":60,"remaining_seconds":1740,"session_id":null,"session_origin":null,"authorized":true}` |
| 2 | H2 持票据时进场放行（仅跳过学习条件） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"used_seconds":60,"remaining_seconds":1740,"parent_override":true,"session_id":null,"session_origin":null,"session_bound":true}` |
| 3 | H3 首次 start 返回服务端会话标识，且票据被原子消费 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":60,"remaining_seconds":1740,"parent_override":true,"override_consumed":true,"session_id":"40a0f33a662940128d4c59485d03896e","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 4 | H4 重复 start（不带标识）被拒绝——本轮修复的核心 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":61,"remaining_seconds":1739,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1}` |
| 5 | H5 被拒绝的重复 start 不会回传会话标识 | 通过 | `session_id=null` |
| 6 | H6 刷新页面（新客户端无标识）仍进不去，且票据无法二次消费 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":61,"remaining_seconds":1739,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1} \| {"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":true,"used_seconds":61,"remaining_seconds":1739,"parent_override":false,"session_id":null,"session_origin":null,"session_bound":true}` |
| 7 | H7 带原会话标识可以续接同一个会话（不是新会话） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":61,"remaining_seconds":1739,"parent_override":true,"override_consumed":false,"session_id":"40a0f33a662940128d4c59485d03896e","session_origin":"parent_override","session_resumed":true,"session_bound":true,"active_devices":1}` |
| 8 | H8 心跳带标识放行并照常计费 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":61,"remaining_seconds":1739,"parent_override":true,"override_consumed":false,"session_id":"40a0f33a662940128d4c59485d03896e","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 9 | H9 心跳不带标识被拒绝，且不泄漏标识 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":62,"remaining_seconds":1738,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1}` |
| 10 | H10 伪造会话标识被拒绝 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":62,"remaining_seconds":1738,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1}` |
| 11 | H11 上述拒绝没有误杀正在进行的会话（原标识仍可心跳） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":62,"remaining_seconds":1738,"parent_override":true,"override_consumed":false,"session_id":"40a0f33a662940128d4c59485d03896e","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 12 | H12 会话标识也可以通过 x-r5-session 请求头传递 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":62,"remaining_seconds":1738,"parent_override":true,"override_consumed":false,"session_id":"40a0f33a662940128d4c59485d03896e","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 13 | H13 累计时长单调不减（1800 秒上限只减不增） | 通过 | `used 61 -> 62` |
| 14 | H14 结束会话后 active=false | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"used_seconds":62,"remaining_seconds":1738,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |
| 15 | H15 会话重放：结束后用旧标识 start 被拒绝 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"used_seconds":62,"remaining_seconds":1738,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |
| 16 | H16 结束后不带标识 start 同样被拒绝（已消费票据不能开第二次） | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"used_seconds":62,"remaining_seconds":1738,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |
| 17 | H17 结束后再进场需要重新家长验证 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"used_seconds":62,"remaining_seconds":1738,"parent_override":false,"session_id":null,"session_origin":null,"session_bound":true}` |

## H2 · 会话绑定：断线恢复、断线超时失效

运行时间：2026-11-13T02:46:46.369Z　|　7/7 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | H18 重新授权后可创建新会话（旧授权已作废） | 通过 | `{"api":"r5_parent_session","used_seconds":62,"remaining_seconds":1738,"session_id":null,"session_origin":null,"authorized":true} \| {"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":62,"remaining_seconds":1738,"parent_override":true,"override_consumed":true,"session_id":"a05a7de6af214021ae94e7c61d9c13c9","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 2 | H19 短暂断线（3 秒无心跳）后带标识可原地恢复 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":65,"remaining_seconds":1735,"parent_override":true,"override_consumed":false,"session_id":"a05a7de6af214021ae94e7c61d9c13c9","session_origin":"parent_override","session_resumed":true,"session_bound":true,"active_devices":1}` |
| 3 | H20 断线超过空闲上限后心跳被拒绝 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"used_seconds":65,"remaining_seconds":1735,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |
| 4 | H21 断线超时后旧标识无法恢复会话（不会长期免密重进） | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"used_seconds":65,"remaining_seconds":1735,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |
| 5 | H22 断线超时后再进场需要家长重新验证 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"used_seconds":65,"remaining_seconds":1735,"parent_override":false,"session_id":null,"session_origin":null,"session_bound":true}` |
| 6 | H23 超时后重新验证家长可以重新开始，并拿到全新会话标识 | 通过 | `{"api":"r5_parent_session","used_seconds":65,"remaining_seconds":1735,"session_id":null,"session_origin":null,"authorized":true} \| {"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":65,"remaining_seconds":1735,"parent_override":true,"override_consumed":true,"session_id":"6f228321c5df46b8951b0669881bd5a1","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 7 | H24 旧会话标识在新会话开始后仍然无效 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":66,"remaining_seconds":1734,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1}` |

## H3 · 会话绑定：多设备并发

运行时间：2026-11-13T02:47:56.794Z　|　9/9 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | H25 设备A 授权并开始会话 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":66,"remaining_seconds":1734,"parent_override":true,"override_consumed":true,"session_id":"43738dae5aa447119b40c7c2a68e42a0","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 2 | H26 设备B 没有票据时 start 被拒绝（不能搭便车） | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":66,"remaining_seconds":1734,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1}` |
| 3 | H27 设备B 拿设备A 的会话标识也无法续接（标识绑定设备） | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":66,"remaining_seconds":1734,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1}` |
| 4 | H28 设备B 自己授权后可开始自己的会话，标识与A 不同 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":67,"remaining_seconds":1733,"parent_override":true,"override_consumed":true,"session_id":"b0d2d53f5d0443e5a4a621562c5895be","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":2}` |
| 5 | H29 设备A 用设备B 的标识被拒绝 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":67,"remaining_seconds":1733,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":2}` |
| 6 | H30 两台设备各自心跳都放行 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":67,"remaining_seconds":1733,"parent_override":true,"override_consumed":false,"session_id":"43738dae5aa447119b40c7c2a68e42a0","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":2} \| {"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":67,"remaining_seconds":1733,"parent_override":true,"override_consumed":false,"session_id":"b0d2d53f5d0443e5a4a621562c5895be","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":2}` |
| 7 | H31 服务端同时看到两个活跃会话 | 通过 | `active_devices=2` |
| 8 | H32 A 结束后 A 被拒，B 不受影响 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"used_seconds":68,"remaining_seconds":1732,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":1} \| {"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"used_seconds":68,"remaining_seconds":1732,"parent_override":true,"override_consumed":false,"session_id":"b0d2d53f5d0443e5a4a621562c5895be","session_origin":"parent_override","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 9 | H33 B 结束后两台都无活跃会话 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"used_seconds":69,"remaining_seconds":1731,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |

## H4 · 正常学习路径不受影响

运行时间：2026-11-13T02:48:12.631Z　|　4/4 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | H34 学习达标时不需要票据也能开始（session_origin=study） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED","active":true,"used_seconds":69,"remaining_seconds":1731,"parent_override":false,"override_consumed":false,"session_id":"c7ab974a7a454ea29ac0cd96b53de33e","session_origin":"study","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 2 | H35 学习路径带标识心跳正常 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED","active":true,"used_seconds":70,"remaining_seconds":1730,"parent_override":false,"override_consumed":false,"session_id":"c7ab974a7a454ea29ac0cd96b53de33e","session_origin":"study","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 3 | H36 旧前端（心跳不带标识）在学习路径下仍可用 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED","active":true,"used_seconds":70,"remaining_seconds":1730,"parent_override":false,"override_consumed":false,"session_id":"f09e2cd14b8145339c1f61012931bda9","session_origin":"study","session_resumed":false,"session_bound":true,"active_devices":1}` |
| 4 | H37 学习路径结束会话正常 | 通过 | `{"api":"r5_status","allowed":false,"reason":"STUDY_PASSED","active":false,"used_seconds":70,"remaining_seconds":1730,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |

## H5 · 额度用尽时的会话拒绝

运行时间：2026-11-13T02:48:22.797Z　|　3/3 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | H38 额度用尽时家长授权被拒绝（TIME_LIMIT_REACHED） | 通过 | `status=403 {"session_id":null,"session_origin":null,"error":"TIME_LIMIT_REACHED"}` |
| 2 | H39 额度用尽时 start 被拒绝 | 通过 | `{"api":"r5_status","allowed":false,"reason":"TIME_LIMIT_REACHED","active":false,"used_seconds":1800,"remaining_seconds":0,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |
| 3 | H40 额度用尽时心跳被拒绝 | 通过 | `{"api":"r5_status","allowed":false,"reason":"TIME_LIMIT_REACHED","active":false,"used_seconds":1800,"remaining_seconds":0,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false,"session_bound":false,"active_devices":0}` |

## W · 验收站点协议级"真实退出重进"走查

运行时间：2026-11-13T02:51:27.330Z　|　15/15 通过

| # | 用例 | 结果 | 实测返回 |
| --- | --- | --- | --- |
| 1 | 页面可打开且已是账号密码版（无 x-r5-parent 旧通道） | 通过 | `gate.html=200 bytes=21425` |
| 2 | 家长账号清单模块可加载（不含任何密码） | 通过 | `parent-accounts.mjs=200 bytes=510` |
| 3 | 未验证家长时进不去（学习未达标） | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1700,"used_seconds":100,"parent_override":false,"session_id":null,"session_origin":null}` |
| 4 | 密码错误被拒绝 | 通过 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| 5 | 选择账号 + 正确密码 → 拿到一次性授权 | 通过 | `{"api":"r5_parent_session","authorized":true,"remaining_seconds":1700,"used_seconds":100,"session_id":null,"session_origin":null}` |
| 6 | 授权后进场成功（只跳过学习条件） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"remaining_seconds":1700,"used_seconds":100,"parent_override":true,"session_id":null,"session_origin":null}` |
| 7 | 开始游戏时票据被消费，并拿到服务端会话标识 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1700,"used_seconds":100,"parent_override":true,"override_consumed":true,"session_id":"45e38c605f17400fbab2deec3120be2f","session_origin":"parent_override","session_resumed":false}` |
| 8 | 刷新页面后进场被拒绝（不再免密） | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":true,"remaining_seconds":1700,"used_seconds":100,"parent_override":false,"session_id":null,"session_origin":null}` |
| 9 | 刷新后再次 start 被拒绝（已消费票据 + 设备身份不再足够） | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":true,"remaining_seconds":1699,"used_seconds":101,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false}` |
| 10 | 带原会话标识可以续接同一个会话，标识不变 | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1699,"used_seconds":101,"parent_override":true,"override_consumed":false,"session_id":"45e38c605f17400fbab2deec3120be2f","session_origin":"parent_override","session_resumed":true}` |
| 11 | 结束游戏 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1699,"used_seconds":101,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false}` |
| 12 | 退出后重新进入必须再次输入家长密码 | 通过 | `{"api":"r5_status","allowed":false,"reason":"PLAN_UNPUBLISHED","active":false,"remaining_seconds":1699,"used_seconds":101,"parent_override":false,"session_id":null,"session_origin":null}` |
| 13 | 退出后凭旧授权无法开始游戏 | 通过 | `{"api":"r5_status","allowed":false,"reason":"SESSION_REQUIRED","active":false,"remaining_seconds":1699,"used_seconds":101,"parent_override":false,"override_consumed":false,"session_id":null,"session_origin":null,"session_resumed":false}` |
| 14 | 重新输入密码后可再次进场（额度继续累计，不清零） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":false,"remaining_seconds":1699,"used_seconds":101,"parent_override":true,"session_id":null,"session_origin":null} \| session={"api":"r5_parent_session","authorized":true,"remaining_seconds":1699,"used_seconds":101,"session_id":null,"session_origin":null}` |
| 15 | 重新验证后可以创建全新会话（新标识与上一次不同） | 通过 | `{"api":"r5_status","allowed":true,"reason":"STUDY_PASSED_WITH_WAIVER","active":true,"remaining_seconds":1699,"used_seconds":101,"parent_override":true,"override_consumed":true,"session_id":"49ec61e9cf024d669903c2e7f1919e57","session_origin":"parent_override","session_resumed":false}` |

## 合计

- 用例总数：**102**
- 通过：**102**
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
