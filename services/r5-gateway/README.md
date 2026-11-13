# services/r5-gateway

R5 学习闸门线上网关（CloudBase HTTP 云函数 `r5-gateway`，Runtime Nodejs18.15，入口 `index.main`）。

## 本次（账号密码 + 一次性票据 + 会话绑定）改了什么

| 项 | 变化 |
| --- | --- |
| 版本标识 | `1.3.1-parent-override` → `1.4.0-parent-account` → **`1.5.0-session-bound`**（`GET /r5/health` 的 `version`） |
| 新路由 | `POST /r5/v1/parent/session` |
| 下线路由 | `POST /r5/v1/parent/game-override` 固定返回 `410 R5_PARENT_SECRET_RETIRED` |
| 家长身份来源 | 旧的共享口令 `x-r5-parent` → **复用 V6 三个家庭账号各自的密码**，由 CloudBase Auth `/auth/v1/signin` 校验 |
| 授权模型 | 300 秒"绑定"→ **120 秒一次性票据**，`start` 时原子消费 |
| 会话模型（1.5.0） | 一次性票据只能开 **一个** 会话：`start` 同时下发服务端 `session_id`，后续 `tick` / `stop` / 续接必须携带；既无票据又无有效标识时一律拒绝（`SESSION_REQUIRED`） |
| `health()` | 新增 `parent_auth` / `parent_override_single_use` / `parent_secret_retired` / `session_binding` / `session_idle_seconds` |
| 其它路由 | **一行未改**（child/entry、parent/*、device/whoami、birthday、racing/*） |

请求 / 响应契约、错误码、部署记录、逐项实测结果与回滚方案见
[`docs/r5/DEPLOY_R5_PARENT_OVERRIDE.md`](../../docs/r5/DEPLOY_R5_PARENT_OVERRIDE.md)。

## 身份链（每一步都在服务端）

```
浏览器   { family_id, device, account, password }
   ↓  HTTPS，密码只出现这一次
网关     POST <envId>.api.tcloudbasegateway.com/auth/v1/signin
   ↓  200 → access_token（JWT）
网关     取 sub = 真实 uid（account 只作展示与审计，永远不作为身份）
   ↓  set_config('request.jwt.claims', {sub, role:'authenticated'})
数据库   public.r5_parent_override_issue(family, device, account, ttl)
         校验：该 uid 是本家庭 owner/parent/grandparent
                设备已绑定、未撤销、属于本家庭
                家长总开关开启、当天剩余额度 > 0
   ↓  写一次性票据（浏览器拿不到票据本体）
前端     只得到一个布尔授权 + 剩余秒数，sessionStorage 里的东西服务端一概不认
```

`start` 时数据库用**单条 UPDATE** 消费票据：

```sql
UPDATE public.r5_game_override
   SET consumed_at = now(), session_until = now() + interval '150 seconds'
 WHERE family_id = $1 AND device_uid = $2 AND play_date = today
   AND consumed_at IS NULL AND expires_at > now()
   AND EXISTS (设备未撤销)
RETURNING 1 INTO hit;
```

并发下只有一条 UPDATE 能命中，因此"同一张票据开两次"在数据库层就不可能。
退出 / 结束 / 超额时 `session_until` 归 NULL，再进场必须重新输密码。

### 会话绑定（1.5.0 补上的那一半）

票据只解决"授权用一次"，不解决"一次授权开一个会话"——上一版就漏在这里：
`r5_override_active(p_entry => false)` 只要 `session_until > now()` 就返回真，
而 `session_until` 会被每次心跳滑动续期，于是已消费票据 + 同一设备 = 永久免密。

现在 `start` 在消费票据的同时生成服务端会话标识：

```sql
sid := public.r5_session_open(family, uid, 'parent_override');   -- 32 位 hex
PERFORM public.r5_override_bind_session(family, uid, sid);        -- 票据 ←→ 会话
```

后续规则：

| 调用 | 条件 | 结果 |
| --- | --- | --- |
| `start` 无票、无标识 | 学习未达标 | `allowed:false, reason:SESSION_REQUIRED` |
| `start` 无票、带**本设备当日有效**标识 | `last_beat <= now()-45s` 内 | `allowed:true, session_resumed:true` |
| `tick` 带错标识 / 不带标识 | — | 拒绝，但**不打断**正在进行的会话 |
| 任何被拒绝的响应 | — | `session_id` 恒为 `null`，不回传别人的标识 |

`r5_override_active(false)` 现在要求"票据 `session_id` = 当前会话 `session_id` 且会话仍在心跳"，
所以"窗口还在但没人心跳"不再等于有资格玩。断网 / 关页超过 45 秒即失效。

## 目录

```
index.js                                        云函数源码（与线上部署一致，1.5.0-session-bound）
package.json                                    运行标识（无新增依赖）
migrations/
  20261113093000_parent_game_override.sql       授权表 + 签发 / 绑定 / 审计函数（初版）
  20261113093500_parent_game_override_status.sql  r5_status / r5_game_action / r5_game_action_md（初版）
  20261113101500_parent_override_single_use.sql  一次性票据 + 权限收紧
tests/
  parent-account.test.mjs                       三账号 / 设备 / 一次性消费 / 重放 / 额度 / 越权（phase-a ~ phase-g）
  session-binding.test.mjs                      会话绑定：重复 start / 刷新 / 断线 / 重放 / 多设备（phase-h1 ~ phase-h5）
  acceptance-walkthrough.mjs                    协议级"真实退出重进"走查（含验收站点页面检查）
  parent-override.test.mjs                      上一轮的口令版用例（保留作回归，已是历史路径）
  link-verify.test.mjs                          前端 ↔ 网关真实联调
  verify-migration.mjs                          迁移文件与线上定义等价性校验
  RESULTS.md                                    本轮逐项实际结果（102 项）
  artifacts/*.json                              原始接口返回日志（每个用例都带 status 与关键字段）
```

本次新增的两个迁移（会话绑定）：

```
20261113110500_session_binding.sql         session_id 列 + 会话工具函数 + _v2 引擎 + 老函数 fail-closed 委托
20261113111500_session_binding_guard.sql   细化：无标识的 start/tick 只拒绝、不误杀；不回传未证明的标识
```

## 跑测试

```bash
# 三账号密码校验（密码从本机凭据文件读取，不写进仓库、不打印）
node tests/parent-account.test.mjs phase-a

# 设备状态：未绑定 / 已撤销 / 跨家庭
node tests/parent-account.test.mjs phase-b

# 一次性消费全链路：授权 → 进场 → 开始（消费）→ 刷新被拒 → 心跳照常 → 结束 → 再进被拒
node tests/parent-account.test.mjs phase-c

# 重放 / 不带密码 / 伪造字段 / 旧口令头
node tests/parent-account.test.mjs phase-d

# 需要先构造数据库状态：
node tests/parent-account.test.mjs phase-d2   # 票据过期
node tests/parent-account.test.mjs phase-e    # 当天 1800 秒用尽

# 正常学习路径 + 存档 + 生日接口
node tests/parent-account.test.mjs phase-f

# 客户端直接调数据库授权函数必须被拒（permission denied 42501）
node tests/parent-account.test.mjs phase-g

# 协议级真实退出重进
node tests/acceptance-walkthrough.mjs

# 会话绑定专项（本轮修复重点，共 40 项）
node tests/session-binding.test.mjs phase-h1   # 重复 start / 刷新 / 重放 17 项
node tests/session-binding.test.mjs phase-h2   # 断线恢复与超时失效（含真实静默 50 秒）7 项
node tests/session-binding.test.mjs phase-h3   # 多设备并发 9 项
node tests/session-binding.test.mjs phase-h4   # 学习路径不受影响 4 项（需 plan published=true）
node tests/session-binding.test.mjs phase-h5   # 额度用尽 3 项（需 used_ms=1800000）
```

`phase-d2` / `phase-e` 的数据准备 SQL 见 `tests/RESULTS.md` 的「测试数据准备」一节。

## 安全边界

- **密码不落地**：浏览器只在一次 HTTPS 请求体里提交密码；网关不写日志、不写审计、不入库，
  校验完立即丢弃；源码 / 仓库 / URL / localStorage 里都没有任何密码或哈希。
- **身份只认 uid**：客户端提交的 `account` 只用于展示与审计，真实身份取 CloudBase 签发的 JWT `sub`。
- **票据不下发**：`r5_parent_override_issue` 只在服务端写表，前端拿不到票据本体，复制 URL、
  刷新、回放请求都换不到第二次免学习资格。
- **权限收紧**：`r5_override_bind` / `r5_parent_game_override` / `r5_parent_override_issue` /
  `r5_override_consume|touch|close|active` / `r5_gate_status` / `r5_parent_game_override_audit`
  全部 `REVOKE ALL ... FROM PUBLIC, anon, authenticated`，只 `GRANT EXECUTE ... TO service_role`；
  函数体内再加 `r5_override_internal_only()`：`current_user IN ('anon','authenticated')` 直接抛 42501。
- **防爆破**：家庭 + 账号 + 来源内存窗口（10 分钟 5 次）与审计表跨实例窗口双重限制，
  触发后 `429 R5_TOO_MANY_ATTEMPTS`，且**失败次数本身不会重置已用游戏时间**。
- **不触碰 1800 秒**：家长授权只放宽 `study_ok`，
  `permitted := (NOT enabled OR study_ok) AND remaining > 0` 保持原样，额度只减不增。
