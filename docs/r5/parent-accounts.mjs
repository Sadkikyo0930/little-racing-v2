/**
 * r5/parent-accounts.mjs — 家长入口可选账号
 *
 * 这里只放「账号标识 + 显示名」，**没有任何密码或密码哈希**。
 * 密码由家长在页面上输入，随一次性请求发到 R5 网关，网关再调用
 * CloudBase Auth 的 /auth/v1/signin 校验（与 V6 学习台同一套账号体系）。
 *
 * 新增/改名只改这个文件；不要在别处硬编码账号名。
 * 三个账号分别对应正式家庭 little-growth-family-001 的三位家长：
 *   growth_mom   → owner（妈妈）
 *   growth_dad   → parent（爸爸）
 *   growth_grandma → grandparent（外婆）
 */
export const R5_PARENT_ACCOUNTS = [
  { id: 'growth_mom', label: '妈妈' },
  { id: 'growth_dad', label: '爸爸' },
  { id: 'growth_grandma', label: '外婆' },
];
