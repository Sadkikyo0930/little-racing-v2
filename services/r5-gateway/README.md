# services/r5-gateway

R5 学习闸门线上网关（CloudBase HTTP 云函数 `r5-gateway`，Runtime Nodejs18.15，入口 `index.main`）。

## 本次（R5 家长免学习快捷授权）改了什么

| 项 | 变化 |
| --- | --- |
| 版本标识 | `1.2.0-md` → `1.3.1-parent-override`（`GET /r5/health` 的 `version`） |
| 新路由 | `POST /r5/v1/parent/game-override` |
| `health()` | 增加 `parent_override_endpoint`、`parent_override_ttl_seconds` |
| 其它 16 条路由 | **一行未改**（child/entry、game/action、parent/*、device/whoami、birthday、racing/*） |

请求 / 响应契约、错误码、部署记录、45 项实测结果与回滚方案见
[`docs/r5/DEPLOY_R5_PARENT_OVERRIDE.md`](../../docs/r5/DEPLOY_R5_PARENT_OVERRIDE.md)。

## 目录

```
index.js                                    云函数源码（与线上部署一致）
package.json                                运行标识（无新增依赖）
migrations/                                  两个幂等迁移，函数体与线上 pg_proc.prosrc 逐字节一致
  20261113093000_parent_game_override.sql    授权表 + 签发 / 绑定 / 审计函数
  20261113093500_parent_game_override_status.sql  r5_status / r5_game_action / r5_game_action_md
  README.md                                  设计要点
tests/
  parent-override.test.mjs                   隔离家庭安全测试（phase-a ~ phase-e）
  link-verify.test.mjs                       前端 ↔ 网关真实联调（浏览器等价跨域请求）
  verify-migration.mjs                       迁移文件与线上定义等价性校验
  RESULTS.md                                 45 项实际结果（由 artifacts 生成）
  artifacts/*.json                           原始接口返回日志
```

## 跑测试

```bash
# 只打 r5-selftest-family，正式家庭零写入
R5_PARENT_SECRET=<家长口令> node tests/parent-override.test.mjs phase-a

# 前端联调（口令也可从本地安全文件读取，见脚本内 SECRET_CANDIDATES）
node tests/link-verify.test.mjs

# 迁移与线上一致性
node tests/verify-migration.mjs
```

`phase-b` / `phase-c` 需要先构造「授权过期」与「额度用尽」两种数据库状态，
具体 SQL 见 `tests/parent-override.test.mjs` 顶部注释。

## 安全边界

- 家长令牌只在请求头 `x-r5-parent` 里出现一次，服务端用 `crypto.timingSafeEqual` 做定长比较；
  源码、日志、审计表、localStorage、URL 都不留口令。
- 免学习资格完全由数据库 `r5_game_override` 表判定；前端返回的任何
  `authorized` / `remaining_seconds` 都不被服务端采信。
- 家长授权**不触碰**每日 1800 秒限额：`r5_status` 只把 `study_ok` 放宽，
  `permitted := (NOT enabled OR study_ok) AND remaining > 0` 保持原样。
