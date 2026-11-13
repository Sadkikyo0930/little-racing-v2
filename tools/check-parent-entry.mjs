/**
 * tools/check-parent-entry.mjs — R5 家长入口静态契约检查（CI 用，无外部依赖）
 *
 * 校验「最终版」契约，任何一条不满足即 exit 1：
 *   1. 页面用 V6 三个家庭账号 + 各自密码，打 POST /v1/parent/session
 *   2. 旧的共享口令 R5_PARENT_SECRET / x-r5-parent 路径不得回到客户端
 *   3. 前端严格校验服务端返回，失败一律 fail-closed
 *   4. 密码不落 localStorage / sessionStorage / URL
 *   5. 服务端确实是 session-binding 版本（会话标识 + 两个 _v2 引擎）
 *   6. 会话迁移只授予 service_role，且没有 DROP FUNCTION
 */
import {readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const read = p => readFileSync(p, 'utf8');
const html = read('docs/gate.html');
const accounts = read('docs/r5/parent-accounts.mjs');
const gateway = read('services/r5-gateway/index.js');

const fails = [];
const check = (name, fn) => {
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { fails.push(name + ' → ' + e.message); console.log('FAIL  ' + name + ' → ' + e.message); }
};

/* ---------- 1. 家长入口 UI 元素 ---------- */
check('家长入口 UI 元素齐全（按钮/弹窗/表单/账号/密码/状态）', () => {
  for (const id of ['parent-entry-open', 'parent-entry-dialog', 'parent-entry-form',
    'parent-entry-account', 'parent-entry-password', 'parent-entry-status']) {
    assert(html.includes('id="' + id + '"'), 'Missing ' + id);
  }
});

/* ---------- 2. 三账号登录契约 ---------- */
check('使用 POST /v1/parent/session（不是旧 game-override）', () => {
  assert(html.includes("R5_CONFIG.base+'/v1/parent/session'"), 'Missing /v1/parent/session');
});

check('请求体带 account + password（三账号认证）', () => {
  assert(/body:JSON\.stringify\(\{family_id:R5_CONFIG\.familyId,device,account,password\}\)/.test(html),
    'Body must send {family_id, device, account, password}');
});

check('账号清单来自 r5/parent-accounts.mjs 且不含凭据', () => {
  assert(html.includes("from './r5/parent-accounts.mjs'"), 'Must import parent-accounts.mjs');
  for (const id of ['growth_mom', 'growth_dad', 'growth_grandma']) {
    assert(accounts.includes("'" + id + "'"), 'Missing account ' + id);
  }
  const code = accounts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(!/password|passwd|hash|sha256/i.test(code), 'parent-accounts.mjs must not contain any credential');
});

/* ---------- 3. 旧口令机制不得回到客户端 ---------- */
check('客户端不再出现 x-r5-parent / game-override / parent-entry-secret', () => {
  assert(!html.includes('x-r5-parent'), 'Retired x-r5-parent header is back');
  assert(!html.includes('/v1/parent/game-override'), 'Retired game-override endpoint is back');
  assert(!html.includes('parent-entry-secret'), 'Retired password field is back');
  // 允许且仅允许一条"旧入口已下线"的提示文案映射，不得出现口令本身的使用
  assert(!/R5_PARENT_SECRET(?!_RETIRED:')/.test(html), 'Retired shared secret is back');
});

/* ---------- 4. fail-closed ---------- */
check('严格校验服务端返回（HTTP + api + authorized + 剩余时长）', () => {
  assert(html.includes('if(!response.ok'), 'Must check HTTP status');
  assert(html.includes("payload?.api!=='r5_parent_session'"), 'Must check api name');
  assert(html.includes('payload?.authorized!==true'), 'Must require authorized===true');
  assert(html.includes('Number(payload.remaining_seconds)<=0'), 'Must reject no time left');
});

/* ---------- 5. 凭据不落地 ---------- */
check('密码不写 localStorage / sessionStorage / URL', () => {
  assert(!/localStorage\.setItem\([^)]*password/i.test(html), 'localStorage must not store password');
  assert(!/sessionStorage\.setItem/i.test(html), 'sessionStorage must not be used here');
  assert(!/location\.(href|replace)\([^)]*\?[^)]*password/i.test(html), 'password must not enter URL');
});

/* ---------- 6. 内联脚本语法 ---------- */
check('HTML 内联脚本语法可解析', () => {
  const scripts = [...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).filter(s => s.trim());
  const dir = mkdtempSync(join(tmpdir(), 'r5-parent-'));
  try {
    scripts.forEach((src, i) => {
      const p = join(dir, i + '.mjs');
      writeFileSync(p, src);
      const run = spawnSync(process.execPath, ['--check', p], {encoding: 'utf8'});
      assert.equal(run.status, 0, 'script ' + i + ' syntax: ' + run.stderr);
    });
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

/* ---------- 7. 服务端版本与路由 ---------- */
check('网关是 session-binding 版本（会话标识 + 两个 _v2 引擎）', () => {
  assert(/SESSION_RE = \/\^\[a-f0-9\]\{32\}\$\//.test(gateway), 'Missing SESSION_RE');
  assert(gateway.includes('r5_game_action_v2'), 'Missing r5_game_action_v2');
  assert(gateway.includes('r5_game_action_md_v2'), 'Missing r5_game_action_md_v2');
  assert(gateway.includes('1.5.0-session-bound'), 'health version not bumped');
  assert(gateway.includes('session_required_for_override'), 'health missing session flag');
});

check('旧口令端点仍固定 410（fail-closed，不静默降级）', () => {
  assert(gateway.includes('/v1/parent/game-override'), 'Deprecated route must stay mapped');
  assert(/parentGameOverrideDeprecated[\s\S]{0,200}R5_PARENT_SECRET_RETIRED/.test(gateway),
    'Deprecated route must throw 410');
});

check('家长授权入口不复用共享口令', () => {
  const start = gateway.indexOf('async function parentSession');
  assert(start > 0, 'Missing parentSession');
  const body = gateway.slice(start, start + 2500);
  assert(!body.includes('x-r5-parent'), 'parentSession must not read x-r5-parent');
  assert(!body.includes('requireParent'), 'parentSession must not use requireParent');
  assert(body.includes('verifyAccountPassword'), 'parentSession must verify account password');
});

/* ---------- 8. 数据库迁移 ---------- */
check('会话绑定迁移存在、权限收紧、无 DROP FUNCTION', () => {
  const main = 'services/r5-gateway/migrations/20261113110500_session_binding.sql';
  const guard = 'services/r5-gateway/migrations/20261113111500_session_binding_guard.sql';
  for (const f of [main, guard]) {
    assert(existsSync(f), 'Missing ' + f);
    const sql = read(f);
    assert(sql.includes('r5_session_open'), f + ' missing r5_session_open');
    assert(sql.includes('session_id'), f + ' missing session_id');
    assert(!/DROP\s+FUNCTION/i.test(sql), f + ' must not DROP FUNCTION');
    assert(!/\bTO\s+(anon|public)\b/i.test(sql), f + ' must not grant to anon/public');
  }
  // 建函数的那一份必须显式收回 PUBLIC/anon/authenticated 并只给 service_role
  const sql = read(main);
  assert(/REVOKE ALL ON FUNCTION/i.test(sql), main + ' missing REVOKE');
  assert(/GRANT EXECUTE ON FUNCTION[\s\S]{0,80}TO service_role/i.test(sql), main + ' must grant to service_role');
});

check('旧引擎保留签名、内部以 NULL 标识委托（无高风险 DDL）', () => {
  const sql = read('services/r5-gateway/migrations/20261113110500_session_binding.sql');
  assert(/r5_game_action_md\(/i.test(sql), 'legacy r5_game_action_md must be redefined');
  assert(/NULL::text/i.test(sql), 'legacy engines must delegate with NULL session');
});

/* ---------- 9. 仓库里不出现明文凭据 ---------- */
// 只检查本入口涉及的三个文件；云凭据/私钥的完整扫描在打包流程里单独做，
// 这里不重复实现，避免 CI 误报。
check('入口相关文件不含明文凭据字段', () => {
  for (const [name, body] of [['docs/gate.html', html],
    ['docs/r5/parent-accounts.mjs', accounts],
    ['services/r5-gateway/index.js', gateway]]) {
    assert(!/process\.env\.R5_PARENT_SECRET\s*\|\|\s*['"][^'"]+['"]/.test(body),
      name + ' hardcodes the retired shared secret');
  }
});

if (fails.length) {
  console.error('\n' + fails.length + ' check(s) failed:');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nPASS: 三账号家长入口（/v1/parent/session）、旧口令路径未回归、fail-closed、'
  + '凭据不落地、session-binding 服务端与迁移、无敏感信息。');
