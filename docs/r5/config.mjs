/**
 * r5/config.mjs — 正式赛车 V2（little-racing-v2）R5 闸门配置 · v1.8.0-rc2
 *
 * 这里只有「公开信息」：云函数 HTTPS 地址、正式家庭 ID、正式学习平台地址。
 * 绝不能放：SecretId/SecretKey、数据库口令、service_role、家长密钥、设备令牌、
 *           任何测试环境专用标识（测试账号 / 测试家庭 / 测试设备号）。
 * 设备令牌只由家长链接的 ?d= 参数在运行时写入孩子设备的 localStorage。
 */
export const R5_BUILD = 'v1.8.0-rc2';

export const R5_CONFIG = {
  // 第三阶段已部署并通过 32/32 验收的可信服务端网关
  base: 'https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5',
  // 正式家庭；测试家庭永不出现在本产物里
  familyId: 'little-growth-family-001',

  // 未达标 / 时间用完时「返回 V6 学习平台」的入口（正式站）
  learnUrl: 'https://sadkikyo0930.github.io/little-growth-workbench/v6/',

  // 过闸凭证有效期（秒）。只决定刷新后是否需要重新过闸门，
  // 绝不作为「能不能玩」的判据 —— 每次打开游戏页都会重新问服务端。
  grantTtlSeconds: 300,

  // 心跳间隔兜底值；实际以服务端 child/entry 返回的 heartbeat_seconds 为准
  heartbeatSeconds: 10,

  // 单次请求超时（毫秒）；超时一律 fail-closed，不放行
  timeoutMs: 15000,
};

/** 学习平台地址（允许家长用 ?learn= 覆盖，便于验收） */
export function learnUrl() {
  try {
    const q = new URLSearchParams(location.search).get('learn');
    if (q && /^https:\/\//.test(q)) return q;
  } catch { /* 非浏览器环境 */ }
  return R5_CONFIG.learnUrl;
}
