import {previewStorage} from './isolation-storage.mjs';
import {getDevice} from './grant.mjs';
import {createSyncController} from './family-sync-controller.mjs';

let controller, timer, captureQueued = false;
const labels = {SYNCING:'正在同步', SYNCED:'已同步', RESTORED:'已从云端恢复',
  OFFLINE:'离线，进度保存在本机', ERROR:'同步失败，保留本机进度', DENIED:'设备未授权，未同步', PENDING:'有进度待同步',
  COINS_INSUFFICIENT:'金币不足，本次消费未生效', EVENT_CONFLICT:'奖励事件冲突，需家长检查', REVISION_CONFLICT:'版本冲突，进度仍保存在本机',
  REVIEW_REQUIRED:'同步需检查，保留本机进度', LOCAL_SAVE_REVIEW_REQUIRED:'发现旧存档，需家长检查',
  SYNC_DISABLED_PROD:'隔离保护：禁止正式家庭', MIGRATION_NOT_CONFIRMED:'测试家庭尚未建立基线'};
function render(state) {
  let badge = document.getElementById('r5-sync-badge');
  if (!badge) {
    badge = document.createElement('button'); badge.id = 'r5-sync-badge'; badge.type = 'button';
    badge.style.cssText = 'position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 6px);left:8px;z-index:2147483002;max-width:70vw;border:1px solid #789;border-radius:12px;padding:6px 10px;background:#102841e8;color:white;font:12px sans-serif';
    badge.addEventListener('click', () => controller?.sync({retryBlocked:true})); document.body.appendChild(badge);
  }
  badge.textContent = '家庭存档 · ' + (labels[state.status] || '尚未同步');
  badge.dataset.status = state.status;
  let review = document.getElementById('r5-sync-review');
  if (['COINS_INSUFFICIENT','EVENT_CONFLICT','REVIEW_REQUIRED'].includes(state.status)) {
    if (!review) {
      review = document.createElement('div'); review.id = 'r5-sync-review';
      review.style.cssText = 'position:fixed;inset:0;z-index:2147483602;display:grid;place-items:center;background:#102841ed;color:white;padding:24px;font:16px/1.7 system-ui';
      document.body.appendChild(review);
    }
    review.replaceChildren(); const panel = document.createElement('div');panel.style.maxWidth='480px';
    const title = document.createElement('h2');title.textContent=labels[state.status];
    const text=document.createElement('p');text.textContent='本机进度和未确认操作仍保留，已暂停自动重试。' + (state.authoritative_coins != null ? '云端金币：'+state.authoritative_coins+'。':'') + '请先导出待检查记录。';
    const backup=document.createElement('button');backup.textContent='导出本机待检查记录';backup.onclick=()=>{
      const blob=new Blob([controller.exportPending()],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='r5-isolated-pending-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    panel.append(title,text,backup);
    if (state.status==='COINS_INSUFFICIENT') {
      const retry=document.createElement('button');retry.textContent='重新读取云端并重试';retry.onclick=()=>controller.sync({retryBlocked:true});panel.append(retry);
    }
    review.append(panel);
  } else if (['SYNCED','RESTORED'].includes(state.status)) review?.remove();
}
export function scheduleFamilySync() {
  if (!controller?.joined()) return;
  if (!controller.blocked()) render({status:'PENDING'});
  if (!captureQueued) {
    captureQueued = true;
    queueMicrotask(() => { captureQueued = false; try { controller.capture(); } catch { render({status:'ERROR'}); } });
  }
  clearTimeout(timer); timer = setTimeout(() => controller.sync(), 300);
}
export async function prepareFamilyPreview() {
  // Set only by the separately approved, verified production migration.
  if (previewStorage.getItem('r5.family-sync.migration-confirmed.v1') !== 'true') return true;
  const deviceToken = getDevice();
  if (!deviceToken) { location.replace('./bind.html'); return false; }
  controller = createSyncController({storage: previewStorage, deviceToken, onStatus: render,
    onRestore: () => dispatchEvent(new Event('r5-family-restored'))});
  const result = await controller.join();
  if (!['SYNCED','RESTORED'].includes(result?.status)) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483601;background:#102841;color:white;padding:32px;font:18px sans-serif';
    const text = document.createElement('p'); text.textContent = (labels[result?.status] || '无法确认测试家庭云档') + '。未启动游戏，也未上传旧档。';
    const link = document.createElement('a'); link.href = './bind.html'; link.textContent = '返回隔离设备设置'; link.style.color = '#ffe08a';
    box.append(text, link); document.body.appendChild(box); return false;
  }
  addEventListener('online', () => controller.sync());
  addEventListener('pagehide', () => controller.capture());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) controller.sync(); });
  setInterval(() => { if (!document.hidden) controller.sync(); }, 15000);
  return true;
}
