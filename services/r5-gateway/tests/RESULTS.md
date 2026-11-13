# R5 家长免学习快捷授权 —— 隔离测试实际结果

家庭：`r5-selftest-family`（正式家庭 `little-growth-family-001` 零写入）

网关：`https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5`

> 下表由 `tests/artifacts/*.json` 自动生成，`detail` 是接口真实返回，非人工描述。

## phase A — 17/17

| 结果 | 用例 | 接口实际返回 |
| --- | --- | --- |
| PASS | A0 网关版本含家长快捷授权 | `version=1.3.1-parent-override md_families=["little-growth-family-001","r5-selftest-family"]` |
| PASS | A1 复用现有家长口令可通过服务端验证 | `status=200 devices=18` |
| PASS | A2 正确口令签发家长授权 | `status=200 authorized=true remaining=1800 expires_at=2026-11-13T01:28:36Z ttl=300` |
| PASS | A3 授权有效期不超过 5 分钟 | `剩余约 300 秒` |
| PASS | A4 被授权设备 child/entry 放行且标注家长授权 | `allowed=true reason=STUDY_PASSED_WITH_WAIVER remaining=1800` |
| PASS | A5 未被授权设备仍按学习规则拒绝 | `allowed=false reason=PLAN_UNPUBLISHED` |
| PASS | A6 请求体伪造 authorized/allowed 无效（fail-closed） | `allowed=false reason=PLAN_UNPUBLISHED` |
| PASS | A7 错误口令被拒绝（401） | `status=401 error=R5_PARENT_AUTH_FAILED` |
| PASS | A8 缺少家长口令被拒绝（401） | `status=401 error=R5_PARENT_AUTH_FAILED` |
| PASS | A9 未绑定设备被拒绝（403） | `status=403 error=R5_DEVICE_NOT_BOUND` |
| PASS | A10 已撤销设备被拒绝（403） | `revoke=200 grant=403 error=R5_DEVICE_REVOKED` |
| PASS | A11 非白名单家庭被拒绝 | `status=403 error=R5_FAMILY_NOT_ALLOWED` |
| PASS | A12 授权设备 start 成功并开始计时 | `active=true engine=md-1 remaining=1800` |
| PASS | A13 心跳照旧扣减每日 1800 秒 | `used 0->7 remaining 1800->1793 charged_ms=6244` |
| PASS | A14 重复 start（模拟刷新/重放）不会恢复额度 | `remaining=1793` |
| PASS | A15 stop 正常结束会话 | `status=200 active=false used=7` |
| PASS | A16 授权不跨设备（另一台设备仍被拒绝） | `allowed=false reason=PLAN_UNPUBLISHED` |

## phase B — 2/2

| 结果 | 用例 | 接口实际返回 |
| --- | --- | --- |
| PASS | B1 授权过期后 child/entry 拒绝放行 | `allowed=false reason=PLAN_UNPUBLISHED parent_override=false` |
| PASS | B2 授权过期后无法开始游戏 | `allowed=false active=false reason=PLAN_UNPUBLISHED` |

## phase C — 3/3

| 结果 | 用例 | 接口实际返回 |
| --- | --- | --- |
| PASS | C1 每日 1800 秒用完后拒绝签发授权 | `status=403 error=TIME_LIMIT_REACHED` |
| PASS | C2 额度用尽时 child/entry 返回 TIME_LIMIT_REACHED | `allowed=false reason=TIME_LIMIT_REACHED remaining=0` |
| PASS | C3 额度用尽时无法开始游戏 | `allowed=false active=false` |

## phase D — 4/4

| 结果 | 用例 | 接口实际返回 |
| --- | --- | --- |
| PASS | D0 授权消费后已开始的会话仍可继续（额度不恢复） | `parent_override=true remaining=1800` |
| PASS | D1 未授权设备仍走原学习通行证判定（未被削弱） | `allowed=false reason=PLAN_UNPUBLISHED modules=[]` |
| PASS | D2 家庭存档接口正常（测试家庭） | `status=200 api=r5_racing_save state=OK` |
| PASS | D3 正式站点可访问（未改动主站） | `status=200 bytes=8719 markers=[]` |

## phase E — 4/4

| 结果 | 用例 | 接口实际返回 |
| --- | --- | --- |
| PASS | E1 端点不存在时前端拒绝进入（404 且无 api 标记） | `status=404 error=R5_NOT_FOUND accept=false` |
| PASS | E2 域名/路径错误时前端拒绝进入（非 200 或非 JSON） | `status=404 accept=false` |
| PASS | E3 请求超时/中断时前端抛错且不进入游戏 | `aborted=true` |
| PASS | E4 非法请求体不会产生授权 | `status=401 authorized=undefined` |

## link 联调 — 15/15

| 结果 | 用例 | 接口实际返回 |
| --- | --- | --- |
| PASS | L0 家长口令已就绪（不打印内容） | `已从本地安全文件加载` |
| PASS | L1 跨域预检放行 | `status=204` |
| PASS | L2 前端同款请求返回 200 且 api=r5_parent_game_override | `status=200 api=r5_parent_game_override` |
| PASS | L3 authorized=true（前端据此才放行） | `authorized=true` |
| PASS | L4 remaining_seconds>0（前端第二道校验） | `remaining=1800` |
| PASS | L5 授权有效期 <= 300 秒 | `ttl=300` |
| PASS | L6 响应带跨域头，浏览器可读 | `acao=*` |
| PASS | L7 child/entry 放行被授权设备 | `allowed=true reason=STUDY_PASSED_WITH_WAIVER` |
| PASS | L8 放行原因标注为家长授权 | `parent_override=true reason=STUDY_PASSED_WITH_WAIVER` |
| PASS | L9 错误口令被拒绝 | `status=401 error=R5_PARENT_AUTH_FAILED` |
| PASS | L10 验收站点 gate.html 可访问 | `status=200` |
| PASS | L10 验收站点 index.html 可访问 | `status=200` |
| PASS | L10 验收站点 r5/config.mjs 可访问 | `status=200` |
| PASS | L10 验收站点 r5/grant.mjs 可访问 | `status=200` |
| PASS | L11 验收站点家庭为 r5-selftest-family | `config 已隔离` |

## 合计

**45 项通过 / 0 项失败**
