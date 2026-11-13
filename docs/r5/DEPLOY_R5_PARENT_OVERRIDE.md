# R5 家长免学习快捷授权 —— CloudBase 部署与验收记录

- 记录时间：2026-11-13（Asia/Shanghai）
- 环境：`normal-goose-d5g4qyzr8bb389a4a`（区域 ap-shanghai，**未重建、未迁移、未删库**）
- 正式家庭 `little-growth-family-001`：**全程零写入**（见 §6）
- 状态：服务端已部署 + 隔离家庭测试通过 + 前端联调通过；**未切换到正式家庭使用**，等待家人在 iPhone 上最终验收。

---

## 1. 云函数

| 项 | 值 |
| --- | --- |
| 函数名 | `r5-gateway` |
| FunctionId | `lam-ie8suyaz` |
| Runtime | Nodejs18.15 |
| 部署方式 | `updateFunctionCode`（代码包整体替换） |
| 版本标识 | `1.3.1-parent-override`（`GET /r5/health` 的 `version` 字段） |
| 部署时间 | 2026-11-13 09:23:14 |
| 入口 | `index.main` |

新增能力（只增不改）：

- 路由 `POST /r5/v1/parent/game-override`
- `health()` 增加 `parent_override_endpoint`、`parent_override_ttl_seconds`
- 其余 16 条既有路由（child/entry、game/action、parent/*、device/whoami、birthday、racing/*）一行未动

环境变量（只报告配置状态，不输出值）：

| 变量 | 状态 | 用途 |
| --- | --- | --- |
| `R5_PARENT_SECRET` | 已配置（36 位） | 既有家长口令，本次复用，**未新增密码** |
| `R5_PARENT_UID` | 已配置 | 服务端固定家长 uid，用于构造 claims |
| `R5_ALLOWED_FAMILIES` | 已配置（含 `r5-selftest-family`） | 家庭白名单 |
| `R5_MD_FAMILIES` | 已配置 | 多设备计时引擎白名单，未改动 |
| `R5_INTERNAL_SECRET` | 已配置 | 内部函数 HMAC 断言，未改动 |

## 2. 数据库变更清单

| 对象 | 类型 | 变更 |
| --- | --- | --- |
| `public.r5_game_override` | 新表 | 授权唯一真相；RLS 开启；对 `anon`/`authenticated` 无任何策略与权限 |
| `public.r5_parent_game_override(text,text,integer)` | 新函数 | 签发短时授权，TTL 60–300 秒 |
| `public.r5_parent_game_override_audit(text,text,jsonb)` | 新函数 | 失败/限流审计，不记录口令 |
| `public.r5_override_bind(text,text,integer)` | 新函数 | `start` 时把授权绑定到本次会话 |
| `public.r5_status(text)` | 升级 | 增加 `parent_override` 字段；`study_ok` 允许家长授权替代学习条件；限时/开关逻辑不变 |
| `public.r5_game_action(text,text)` | 升级 | `start` 成功后调用 `r5_override_bind`；计时规则不变 |
| `public.r5_game_action_md(text,text)` | 升级 | 同上（多设备引擎） |

迁移版本：`20261113093000`、`20261113093500`。

一致性校验：`node tests/verify-migration.mjs` → 6/6 函数 `EQUIVALENT`
（去注释去空白后 md5 与线上 `pg_proc.prosrc` 一致）。

## 3. 接口契约

```http
POST /r5/v1/parent/game-override
content-type: application/json
x-r5-parent: <既有家长口令>

{"family_id":"<家庭>","device":"<设备令牌>","action":"grant"}
```

成功 `200`：

```json
{
  "api": "r5_parent_game_override",
  "authorized": true,
  "scope": "skip_learning_only",
  "remaining_seconds": 1800,
  "expires_at": "2026-11-13T01:36:51Z",
  "ttl_seconds": 300
}
```

失败：

| HTTP | error | 场景 |
| --- | --- | --- |
| 401 | `R5_PARENT_AUTH_FAILED` | 口令错误 / 未带口令 |
| 403 | `R5_DEVICE_NOT_BOUND` | 设备未绑定 |
| 403 | `R5_DEVICE_REVOKED` | 设备已撤销 |
| 403 | `R5_DEVICE_FAMILY_MISMATCH` | 跨家庭设备 |
| 403 | `TIME_LIMIT_REACHED` | 当天 1800 秒已用完 |
| 403 | `R5_PARENT_CONTROL_DISABLED` | 家长关闭了赛车总开关 |
| 403 | `R5_FAMILY_NOT_ALLOWED` | 家庭不在白名单 |
| 429 | `R5_TOO_MANY_ATTEMPTS` | 10 分钟内错 5 次 |

## 4. 测试结果（真实接口日志，非人工描述）

全部请求指向线上网关，家庭固定为隔离家庭 `r5-selftest-family`。
原始日志见 `tests/artifacts/*.json`（每个用例含 `name` / `ok` / 实际返回 `detail`）。

| 套件 | 覆盖内容 | 结果 | 时间(UTC) |
| --- | --- | --- | --- |
| phase-a | 正确口令签发、TTL≤5min、child/entry 放行、伪造 body 无效、错误口令、未绑定/撤销/跨家庭、start 计时、心跳扣秒、刷新重放不恢复额度、stop、授权不跨设备 | **17/17** | 01:23:33 |
| phase-b | 授权过期后 child/entry 拒绝、无法开始游戏 | **2/2** | 01:23:58 |
| phase-c | 额度用尽拒绝签发、child/entry 返回 TIME_LIMIT_REACHED、无法开始 | **3/3** | 01:24:09 |
| phase-d | 已开会话续玩但不恢复额度、未授权设备仍走学习规则、家庭存档接口正常、正式站点未受影响 | **4/4** | 01:24:45 |
| phase-e | 端点不存在/域名错误/请求超时/非法请求体时前端不放行（fail-closed） | **4/4** | 01:25:03 |
| link | 浏览器等价跨域请求：预检 204、200+authorized、remaining>0、CORS 头、child/entry 放行、错误口令 401、验收站点 4 个资源可达、站点家庭已隔离 | **15/15** | 01:34:04 |

合计 **45 项通过 / 0 项失败**。

关键实测样本（摘自 `phase-a.json`）：

- `A2` 正确口令签发：`status=200 authorized=true remaining=1800 expires_at=2026-11-13T01:28:36Z ttl=300`
- `A13` 心跳扣秒：`used 0->7 remaining 1800->1793 charged_ms=6244`
- `A14` 刷新/重放：`remaining=1793`（未被恢复）
- `A10` 撤销设备：`revoke=200 grant=403 error=R5_DEVICE_REVOKED`
- `C1` 额度用尽：`status=403 error=TIME_LIMIT_REACHED`
- `B1` 过期授权：`allowed=false parent_override=false`

## 5. 隔离验收站点（供 iPhone 验收）

- 地址：`https://normal-goose-d5g4qyzr8bb389a4a-1526110019.tcloudbaseapp.com/r5-accept/gate.html?d=r5dev_parent_accept_01`
- 托管位置：CloudBase 静态托管 `r5-accept/` 子目录（**与主站 GitHub Pages 完全分离，未改动线上主站**）
- 隔离手段：站点内 `r5/config.mjs`、`bind.html`、`r5/r5-online.mjs` 的家庭全部改为
  `r5-selftest-family`，与正式家庭 `little-growth-family-001` 数据完全隔离
- 验收设备令牌：`r5dev_parent_accept_01`（只存在于隔离家庭，可随时撤销）

验收步骤：

1. iPhone Safari 打开上面的地址（`?d=` 会把设备令牌写进本机 localStorage）
2. 页面为学习通行证，左上角出现 **🔒 家长入口**
3. 点开，输入**现有家长口令** → 应直接进入赛车，不要求先完成学习
4. 故意输错口令 → 提示「家长口令不正确」，**不进入**
5. 查看今日剩余时间：仍从当天已用秒数继续扣，不会重置

## 6. 正式家庭零写入证据

测试前后对 `little-growth-family-001` 取证：

| 指标 | 值 |
| --- | --- |
| 学习记录总数 | 73（测试期间新增 0） |
| 今日游戏用量行 | 0 |
| 家长授权行 | 0 |
| 今日家长审计 | 0 |
| 赛车存档行 | 0 |

所有测试写入都落在 `r5-selftest-family`（审计 16 条，全部为测试动作）。

## 7. 回滚

1. 云函数：把 `services/r5-gateway/index.js` 回退到上一版（`1.2.0-md`）并重新部署即可；
   旧路由与旧函数体在本次提交中一字未改，回滚不会丢功能。
2. 数据库：函数可用 `20261113093000` 之前的 `r5_status` / `r5_game_action` 定义覆盖；
   表 `r5_game_override` 可保留（无引用时无副作用），需要时 `DROP TABLE public.r5_game_override`。
3. 静态托管：删除 `r5-accept/` 目录即可下线验收站点。
4. 正式家庭：目前无需回滚——从未启用。

## 8. 未做 / 边界

- **没有**合并到 `main`，**没有**改动雷霆 Cam3、六星闪耀（birthday）、两章剧情、赛车模型与镜头相关文件。
- **没有**新增家长密码，**没有**改动每日 1800 秒。
- 家长入口前端本次未改动（`docs/gate.html` 已在分支上完成）。
