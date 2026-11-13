# R5 家长入口（账号密码版）—— CloudBase 部署与安全修复记录

- 记录时间：2026-11-13（Asia/Shanghai）
- 环境：`normal-goose-d5g4qyzr8bb389a4a`（区域 ap-shanghai，**未重建、未迁移、未删库**）
- 正式家庭 `little-growth-family-001`：**全程零写入**，家长入口**未启用**
- 上一轮（家长口令版）记录见 [`DEPLOY_R5_PARENT_OVERRIDE.md`](./DEPLOY_R5_PARENT_OVERRIDE.md)，其中的 `x-r5-parent` 口令路径**本轮已下线**

---

## 1. 这次解决了什么

上一轮上线的是"共享口令 + 300 秒绑定"模型，检查发现三个问题：

| # | 问题 | 本轮做法 |
| --- | --- | --- |
| 1 | 家长要额外记一个 `R5_PARENT_SECRET` 口令，和 V6 已有的家庭账号是两套凭证 | 去掉独立口令，**直接复用 V6 三个家庭账号各自的密码** |
| 2 | 授权 300 秒内可以反复建会话；退出后短时间能免密再进 | 改成**服务端一次性票据（120 秒）**，`start` 时原子消费，退出即失效 |
| 3 | `r5_override_bind` / `r5_parent_game_override` 对 `authenticated` 开放 EXECUTE，客户端可直接调 RPC | 全部 `REVOKE`，只留 `service_role`，函数体内再加 `r5_override_internal_only()` 兜底 |

## 2. 云函数

| 项 | 值 |
| --- | --- |
| 函数名 | `r5-gateway` |
| FunctionId | `lam-ie8suyaz` |
| Runtime | Nodejs18.15 / 入口 `index.main` |
| 部署方式 | `updateFunctionCode`（代码包整体替换） |
| 版本标识 | `1.4.0-parent-account`（`GET /r5/health` 的 `version`） |
| 部署时间 | 2026-11-13 10:04:08（`ModTime`） |
| 新增依赖 | **无**（`fetch` 用 Node 18 内建） |

路由变化：

- 新增 `POST /r5/v1/parent/session` —— 唯一的家长授权入口
- `POST /r5/v1/parent/game-override` —— **保留路由但固定返回 `410 R5_PARENT_SECRET_RETIRED`**，任何旧前端打过来都明确失败，不会静默降级
- 其余 16 条路由（child/entry、game/action、parent/bind|revoke|devices|status、device/whoami、birthday/claim、racing/\*）**一行未改**

`health()` 新增字段：

```json
{ "version": "1.4.0-parent-account",
  "parent_override_endpoint_path": "/v1/parent/session",
  "parent_override_ttl_seconds": 120,
  "parent_auth": "cloudbase-account-password",
  "parent_override_single_use": true,
  "parent_secret_retired": true }
```

环境变量（只报告配置状态，不输出值）：

| 变量 | 状态 | 本轮变化 |
| --- | --- | --- |
| `R5_AUTH_BASE` | **未配置**（走默认 `https://<envId>.api.tcloudbasegateway.com`） | 新增可选变量 |
| `R5_PARENT_SECRET` | 仍为已配置（36 位） | **代码不再读取它做家长校验**，仅 `health().parentEndpointReady` 沿用 |
| `R5_PARENT_UID` | 已配置 | 只服务于 `parent/bind|revoke|devices|status` 四条老路由 |
| `R5_ALLOWED_FAMILIES` / `R5_MD_FAMILIES` / `R5_INTERNAL_SECRET` / `R5_ENV_ID` / `R5_REGION` | 已配置，未改动 | — |

## 3. 家长身份链

```
浏览器（gate.html）      { family_id, device, account, password }
        │  HTTPS；密码只在这一次请求体里出现
        ▼
r5-gateway              POST https://<envId>.api.tcloudbasegateway.com/auth/v1/signin
        │               200 → access_token(JWT)；400/401/403 → 视为凭证错误
        │               网络异常/超时 → 503 R5_AUTH_UNAVAILABLE（fail-closed，不消耗重试额度）
        ▼
        取 JWT 的 sub = 真实 uid；客户端提交的 account 只用于展示与审计
        │
        ▼  set_config('request.jwt.claims', {sub, role:'authenticated'})
PostgreSQL              public.r5_parent_override_issue(family, device, account, 120)
        │               ① 该 uid 是本家庭 owner / parent / grandparent
        │               ② 设备已绑定、未撤销、family_id 一致
        │               ③ r5_parent_settings.enabled = true
        │               ④ 当天剩余额度 > 0（已用时长只读，绝不清零）
        ▼
        写一次性票据到 public.r5_game_override（浏览器拿不到票据本体）
        │
        ▼  返回 { authorized:true, one_time:true, remaining_seconds, member_role, ttl_seconds:120 }
前端                    只把这个结果当"可以跳转"，不落 localStorage、不写 URL
```

关键点：**账号名不构成身份**。用 `growth_dad` 这个名字配 `growth_mom` 的密码，Auth 直接 400，
网关返回 401，数据库层根本不会被调用。

## 4. 一次性票据（原子消费）

```sql
-- r5_override_consume(family, device)
UPDATE public.r5_game_override
   SET consumed_at = now(),
       session_until = now() + interval '150 seconds'
 WHERE family_id = $1
   AND device_uid = $2
   AND play_date = timezone('Asia/Shanghai', now())::date
   AND consumed_at IS NULL
   AND expires_at > now()
   AND EXISTS (SELECT 1 FROM public.r5_device d
                WHERE d.device_uid = $2 AND d.family_id = $1 AND d.revoked_at IS NULL)
RETURNING 1 INTO hit;
```

- 并发两个 `start` 只有一个能命中（单条 UPDATE + `consumed_at IS NULL` 行锁）
- `r5_override_touch()` 只在 `consumed_at IS NOT NULL AND session_until > now()` 时续 150 秒
- `r5_override_close()`（`stop` / 超额）把 `session_until` 置 NULL
- `r5_override_active(p_entry)`：`p_entry=true` 只认**未消费且未过期**的票据，
  所以刷新页面 / 重新进场拿不到 `allowed=true`
- 表级 check 约束 `r5_game_override_window_chk` 保证 `granted_at < expires_at <= granted_at + 5min`

## 5. 数据库变更清单（迁移 `20261113101500_parent_override_single_use`）

任务 ID `task-4acd865c0e7f4454`，`Status: Succeed`，本地文件由平台自动落盘（`localFileAction: created`）。

| 对象 | 变更 |
| --- | --- |
| `public.r5_game_override` | `ADD COLUMN account_name text`、`ADD COLUMN session_until timestamptz` |
| `public.r5_parent_override_issue(text,text,text,integer)` | **新增**。服务端唯一签发入口 |
| `public.r5_override_consume(text,text)` | **新增**。一次性消费（原子） |
| `public.r5_override_touch(text,text)` | **新增**。活跃会话续期 |
| `public.r5_override_close(text,text)` | **新增**。结束即失效 |
| `public.r5_override_active(text,text,boolean)` | 重写。`p_entry` 区分"进门"与"在局" |
| `public.r5_gate_status(text,boolean)` | **新增**。拆出 `study_ok` / `permitted` 计算 |
| `public.r5_status(text)` | **签名不变**，函数体改为 `RETURN public.r5_gate_status($1,false)` |
| `public.r5_child_entry(text)` | 改为 `r5_gate_status($1,true)` + `server_time/heartbeat_seconds/resume_same_day` |
| `public.r5_game_action` / `r5_game_action_md` | `start` 消费票据；`tick` 续期；`stop`/超额关闭；返回增加 `override_consumed` |
| `public.r5_override_bind(...)` | **签名保留，函数体改为 `RAISE EXCEPTION 'R5_DEPRECATED_USE_OVERRIDE_CONSUME'`** |
| `public.r5_parent_game_override(...)` | **签名保留，函数体改为 `RAISE EXCEPTION 'R5_DEPRECATED_USE_PARENT_SESSION'`** |
| `public.r5_override_internal_only()` | **新增**。`current_user IN ('anon','authenticated')` → 抛 42501 |

> 说明：`r5_status(text)` 之所以保留签名而不是 `DROP` 后重建，是为了不影响既有调用方；
> 迁移里也没有 `DROP FUNCTION`，避免"删掉一整块"的高风险操作。

### 权限收紧（本轮重点）

```sql
REVOKE ALL ON FUNCTION public.r5_override_bind(text,text,integer)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_parent_game_override(text,text,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_parent_override_issue(text,text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_override_consume(text,text)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_override_touch(text,text)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_override_close(text,text)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_override_active(text,text,boolean)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_gate_status(text,boolean)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_parent_game_override_audit(text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r5_override_internal_only()                FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.r5_parent_override_issue(...) TO service_role;
-- 其余同上，只给 service_role

-- 孩子端 4 个函数保持原授权，避免影响正常游戏
GRANT EXECUTE ON FUNCTION public.r5_status(text),
                          public.r5_child_entry(text),
                          public.r5_game_action(text,text),
                          public.r5_game_action_md(text,text) TO authenticated, service_role;

REVOKE ALL ON TABLE public.r5_game_override FROM PUBLIC, anon, authenticated;
```

实测（以真实 `authenticated` token 直连 PostgREST）：

```
POST /rest/rpc/r5_override_consume      → 403 DATABASE_42501 permission denied for function r5_override_consume
POST /rest/rpc/r5_parent_override_issue → 403 DATABASE_42501 permission denied for function r5_parent_override_issue
POST /rest/rpc/r5_override_bind         → 403 DATABASE_42501 permission denied for function r5_override_bind
```

## 6. 正式家庭零写入的证据

- 本轮所有 SQL 的 `WHERE` 都限定了 `family_id = 'r5-selftest-family'`
- 唯一涉及正式家庭设备的用例是 B3/B4：**只读探测**该设备是否会被跨家庭拒绝，
  返回 `403 R5_DEVICE_FAMILY_MISMATCH` / `R5_MEMBER_DENIED`，不写任何行
- `r5_parent_settings` 中 `little-growth-family-001` 的 `enabled` 状态未被本轮改动
- 前端验收站点 `r5-accept/` 的 `config.mjs` 里 `familyId = 'r5-selftest-family'`

## 7. 回滚方案

| 场景 | 回滚动作 |
| --- | --- |
| 网关代码异常 | `updateFunctionCode` 回退到上一版代码包（`1.3.1-parent-override`）；数据库函数向后兼容，旧版网关调 `r5_parent_game_override` 会得到 42501，需同时回退迁移 |
| 数据库异常 | 迁移 `20261113101500` 的 `rollbackSql` 已随 applyMigration 提交（删除新增列与新增函数、恢复旧函数体） |
| 只想临时关掉家长入口 | `UPDATE public.r5_parent_settings SET enabled = false WHERE family_id = ...`，孩子端学习/计时完全不受影响 |

## 8. 验收站点

- 地址：`https://normal-goose-d5g4qyzr8bb389a4a-1526110019.tcloudbaseapp.com/r5-accept/`
- 家庭：`r5-selftest-family`（隔离），设备：`r5dev_parent_accept_01`
- 家长账号：`growth_mom` / `growth_dad` / `growth_grandma`（密码为各自原有密码，任何人不可见）
- 当前该家庭当天学习计划设为**未发布**，因此孩子端只能通过「🔒 家长入口」进场——
  这正是本轮要验收的行为；正常学习解锁路径由 `phase-f` 覆盖

---

# 第二轮修复：会话绑定（网关 `1.5.0-session-bound`）

## 9. 上一版遗留的漏洞

验收时发现 C5 用例的实测返回里出现了 `allowed:true, active:true`：票据已被消费，
再调一次 `game/action start` 仍然放行。根因不在票据，而在"会话"这一层：

```sql
-- 旧 r5_override_active(p_entry => false)
AND ((o.consumed_at IS NULL AND o.expires_at > now())
  OR (o.consumed_at IS NOT NULL AND o.session_until IS NOT NULL
      AND o.session_until > now()))
```

`session_until` 是**被每次 tick 滑动续期**的 150 秒窗口。于是只要不停心跳，
`r5_override_active` 就一直为真；而 `r5_game_action_md` 的 `allowed` 直接取
`r5_gate_status(family,false).allowed`，`start` 又从不校验"这次 start 是不是
同一个会话"。结果：**已消费票据 + 同一台设备 = 永久免密**。刷新、换标签页、
直接打 API 都能拿到 `allowed:true`。

## 10. 修复模型：服务端会话标识

一次家长授权 → 一个会话；会话由服务端生成标识，客户端不能自己声明。

| 概念 | 存放 | 生命周期 |
| --- | --- | --- |
| 一次性票据 | `r5_game_override`（`consumed_at`） | 签发后 120 秒内可消费一次 |
| 会话标识 `session_id` | `r5_usage_session.session_id`（32 位十六进制，服务端 `gen_random_uuid()`） | 建立会话时生成；`stop`、超额、空闲 45 秒、重新授权都会作废 |
| 票据与会话的绑定 | `r5_game_override.session_id` | 消费票据时由 `r5_override_bind_session()` 写入 |

`start` 的三条路径（`r5_game_action_v2` / `r5_game_action_md_v2`）：

1. **有未消费票据** → 原子消费 → 新会话 → 返回新的 `session_id`
2. **无票据，但带了本设备当天的有效 `session_id`** → 续接同一会话（`session_resumed:true`），标识不变
3. **都没有** → 拒绝（`SESSION_REQUIRED`），不新建会话；若已有非活跃残留则顺手清理

`r5_override_active(p_entry => false)` 改成必须存在**绑定且仍在心跳的会话**：

```sql
JOIN public.r5_usage_session s
  ON s.family_id = o.family_id AND s.play_date = o.play_date
 AND s.actor_key = md5(o.device_uid)
WHERE o.consumed_at IS NOT NULL
  AND o.session_until > now()
  AND o.session_id IS NOT NULL AND s.session_id = o.session_id
  AND s.last_beat > now() - interval '45 seconds'
```

因此"窗口还在但没人心跳"不再等于"有资格玩"。

### 两个刻意的细节

- **拒绝但不打断**：不带标识的 `start/tick` 只被拒绝，不会删掉正在进行的会话。
  否则一次并发重复请求（双击、React 双调用）就能把玩家自己的会话打掉。
- **不回传别人的标识**：只有"刚创建"或"带对了标识"的调用才会拿到 `session_id`；
  被拒绝的响应里该字段恒为 `null`。

## 11. 断线 / 关页的处理

| 场景 | 服务端行为 | 结果 |
| --- | --- | --- |
| 短暂断网（< 45 秒） | `last_beat` 仍在窗口内 | 带标识 `start`/`tick` 原地续接 |
| 断网 / 关页 > 45 秒 | `last_beat` 过期；`md` 引擎直接删行，`v1` 引擎在下次调用时清理 | 旧标识失效，必须重新家长验证 |
| 主动 `stop` | 删除会话行 + `session_until := NULL` | 立即失效，重放无效 |
| 重新家长验证 | 新票据 + 新 `session_id`，旧会话被覆盖 | 旧标识永久失效 |

前端 `r5/r5-online.mjs` 同步调整：`session_id` 只存内存（不进 localStorage /
sessionStorage / URL），切后台只停心跳不 `stop`，真正离开页面才 `stop`。
所以"刷新页面"必然拿不到标识，也就必然回到家长验证。

## 12. 数据库变更（迁移 `20261113110500_session_binding` + `20261113111500_session_binding_guard`）

新增列（`ADD COLUMN IF NOT EXISTS`，不动已有数据）：

```
r5_usage_session   + session_id text / origin text / device_uid text
r5_game_override   + session_id text / session_started_at timestamptz
唯一索引 r5_usage_session_sid_uk (family_id, session_id) WHERE session_id IS NOT NULL
```

新增函数（全部 `SECURITY DEFINER`，`REVOKE ALL FROM PUBLIC, anon, authenticated`，
只 `GRANT EXECUTE TO service_role`）：

```
r5_session_live(family, device, session_id)          -- 会话是否仍在 45 秒心跳窗口内
r5_session_open(family, device, origin)              -- 生成并写入新的 session_id
r5_session_beat(family, device, session_id)          -- 仅当标识匹配且未过期时续期
r5_session_close(family, device, session_id)         -- 删除会话行
r5_override_bind_session(family, device, session_id) -- 把票据绑到会话
r5_gate_status_core(family, entry, ignore_override)  -- 拆出"只看学习条件"的判定
r5_game_action_v2(family, action, session_id)        -- 单设备计时 + 会话绑定
r5_game_action_md_v2(family, action, session_id)     -- 多设备计时 + 会话绑定
```

保留但改写的老函数：`r5_gate_status` 转调 core；`r5_game_action` / `r5_game_action_md`
保留原签名，改为以 `NULL` 标识委托 `_v2`——**旧客户端在学习路径下照常工作，
在家长免学习路径下必然被拒**（fail-closed，不需要 DROP 函数）。

## 13. 本轮实测

- 用例总数 **102**，通过 **102**，失败 **0**（`tests/RESULTS.md`，由 artifacts 直接渲染）
- 其中会话绑定专项 **40** 项：`phase-h1` 17 / `phase-h2` 7 / `phase-h3` 9 / `phase-h4` 4 / `phase-h5` 3
- 关键实测：
  - `start` 首次 `allowed:true, override_consumed:true`，随即第二次 `start` → `allowed:false, reason:SESSION_REQUIRED`
  - 带原标识 → `allowed:true, session_resumed:true`，`session_id` 不变
  - 真实静默 50 秒后再带标识 → `allowed:false`，`active_devices:0`
  - 两台设备各自会话互不干扰（`active_devices:2`），交叉使用标识被拒
  - 客户端直接用 `authenticated` token 调 `r5_session_open/close/beat`、
    `r5_gate_status_core`、`r5_override_bind_session` 全部 `403 DATABASE_42501`
- 迁移任务：`task-d0260a073aee4b97`（`session_binding`）、`task-c37f51adf6e645ea`（`session_binding_guard`），均 `Succeed`

## 14. 本轮回滚

| 场景 | 回滚动作 |
| --- | --- |
| 只想回到"不校验会话标识" | `CREATE OR REPLACE FUNCTION public.r5_game_action_md_v2(...) ` 回填旧函数体（`gitrepo/services/r5-gateway/migrations/20261113101500_*.sql` 中有 1.4.0 版本实现） |
| 网关回滚 | `updateFunctionCode` 回退到 `1.4.0-parent-account` 代码包；数据库新增列与函数向后兼容，不会阻断旧网关 |
| 彻底回退 | 两个迁移都只做 `ADD COLUMN` / `CREATE OR REPLACE`，没有 `DROP`；删列会丢会话历史，不建议 |
