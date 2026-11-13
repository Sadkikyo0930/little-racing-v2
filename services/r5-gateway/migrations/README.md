# R5 家长免学习快捷授权 —— 数据库迁移

## 这两个文件是什么

| 文件 | 内容 |
| --- | --- |
| `20261113093000_parent_game_override.sql` | 授权表 `r5_game_override` + 签发 / 绑定 / 失败审计三个函数 |
| `20261113093500_parent_game_override_status.sql` | 升级 `r5_status`、`r5_game_action`、`r5_game_action_md`，让它们认这份授权 |
| `20261113101500_parent_override_single_use.sql` | 一次性票据（120 秒）+ 授权函数权限收紧 |
| `20261113110500_session_binding.sql` | 会话绑定：`session_id` 列 / 会话工具函数 / `_v2` 计时引擎 / 老函数 fail-closed 委托 |
| `20261113111500_session_binding_guard.sql` | 会话绑定细化：无标识的 `start`/`tick` 只拒绝不误杀，且不回传未证明的标识 |

`20261113110500` 与 `20261113111500` 都不含 `DROP`：只做 `ADD COLUMN IF NOT EXISTS`
与 `CREATE OR REPLACE FUNCTION`，旧网关回滚时数据库仍可用。

两个文件里的函数体与线上库 `pg_proc.prosrc` **逐字节一致**（可用
`tests/verify-migration.mjs` 复核：它把本地定义去掉注释与空白后取 md5，
与线上同一规范化结果比对，6/6 应全部 `EQUIVALENT`）。

## 设计要点

1. **只免学习条件，不免时间。**
   `r5_status` 里新增的 `override_active` 只参与
   `study_ok := (学习达标) OR override_active`，
   最终 `permitted := (NOT enabled OR study_ok) AND remaining > 0` 一字未改。
   所以每日 1800 秒、 bonus 秒数、游戏总开关照旧生效。

2. **只在「被授权的那台设备」上生效。**
   `r5_status` 用 `claims.sub`（网关按设备令牌构造）去比对
   `r5_game_override.device_uid`。家长自己拿口令调用 `r5_status` 时
   `sub` 是家长 uid，永远匹配不上，拿不到免学习放行。

3. **授权是服务端唯一的真相。**
   表启用了 RLS 且没有给 `anon` / `authenticated` 任何策略与直读权限，
   只有 `SECURITY DEFINER` 函数（表属主）能读写。
   前端 `localStorage` 与 URL 参数再怎么写都不影响判定。

4. **额度为 0 时连授权都不签发。**
   签发函数先只读核对 `used_ms`，`remaining <= 0` 直接抛
   `R5_TIME_LIMIT_REACHED`。函数内不存在任何 `used_ms = 0` 之类的写入。

5. **一次性消费 + 会话绑定。**
   授权默认 300 秒（下限 60 / 上限 300，表上还有
   `expires_at <= granted_at + interval '5 minutes'` 的 CHECK 兜底）。
   游戏 `start` 时 `r5_override_bind` 把 `consumed_at` / `bound_until`
   写死，`bound_until` 取 `least(当天 24:00, now + 剩余秒数 + 300 秒)`，
   授权绝不可能跨天、也不会因为重复 `start` 而续命。

6. **审计不含口令。**
   `r5_parent_game_override_audit` 只接受
   `game_override_failed_auth` / `game_override_throttled` / `game_override_denied`
   三种动作，`detail` 里只有 `ip`、`device_uid`、错误码，从不写口令或口令哈希。

## 执行顺序

```sql
\i 20261113093000_parent_game_override.sql
\i 20261113093500_parent_game_override_status.sql
```

两个文件都是幂等的（`CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION`），
可以在同一环境重复执行。
