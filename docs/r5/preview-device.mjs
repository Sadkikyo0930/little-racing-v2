import {DEFAULT_BASE} from './r5-family-sync.mjs';
export async function verifyPreviewDevice(token, fetchImpl = fetch) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token || '')) throw new Error('请输入已授权的测试设备凭证');
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetchImpl(DEFAULT_BASE + '/v1/racing/save/get', {
      method:'POST', headers:{'content-type':'application/json','x-r5-device':token}, body:'{}', signal:ctrl.signal,
    });
    const body = await res.json();
    if (!res.ok || body.api !== 'r5_racing_save' || body.status !== 'OK' || body.save?.family_id !== 'r5-selftest-family')
      throw new Error('未通过测试家庭验证；请使用 r5-selftest-family 的已授权设备凭证');
    return body;
  } finally { clearTimeout(timer); }
}
