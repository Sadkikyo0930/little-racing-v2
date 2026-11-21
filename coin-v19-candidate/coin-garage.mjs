import {getDevice} from '../r5/grant.mjs';
import {COIN_CARS, createCoinShop, mergeGarageOwnership} from './coin-shop.mjs';
export {mergeGarageOwnership};
export const cloudCar = id => COIN_CARS.includes(id);
const bridge = document.querySelector('meta[name="coin-preview-isolated"]');
let update = () => {};
const shop = bridge ? createCoinShop({
  base:new URL('./coin-preview-r5/v1/racing',document.baseURI).href,
  device:getDevice(), expectedFamily:bridge.content, allowEquipSync:true,
  notify:() => update(),
}) : null;
const selectKey='dual-kart.coin-preview.selection.v1';
let selected = null;

export function coinView() {
  return shop?.view() ?? {status:'OFF',coins:null,owned:{},catalog:new Map(),enabled:false,busy:false};
}
export const cloudGrants = () => coinView().owned;
export function offerSpec(spec) {
  const offer=spec && coinView().catalog.get(spec.id);
  return offer ? {...spec,unlock:{...spec.unlock,price:offer.price}} : spec;
}
export function selection() { return selected; }
export function rememberSelection(id) {
  selected=id;
  try {
    if (id) sessionStorage.setItem(selectKey,id);
    else sessionStorage.removeItem(selectKey);
  } catch {}
}
export function savedSelection() {
  try {
    const id=sessionStorage.getItem(selectKey);
    return Object.hasOwn(cloudGrants(),id) ? id : null;
  } catch { return null; }
}
export function onCoinChange(fn) { update=fn; }
export function refreshCoins() { return shop?.refresh(); }
export function buyCloudCar(id, confirm, owns) {
  return shop?.purchase(id,confirm,owns) ?? Promise.resolve({status:'UNAVAILABLE'});
}
export function syncCloudVehicle(id) { return shop?.syncEquip(id); }

const messages={
  HTTP_401:'设备需要重新绑定。',HTTP_403:'该家庭未开放云端车库。',
  DEVICE_REQUIRED:'缺少设备身份，请重新进入试玩。',DEVICE_NOT_AUTHORIZED:'设备未获授权，请重新绑定。',
  PURCHASE_DISABLED:'云端购买暂未开启。', HTTP_404:'模拟金币接口未就绪。',
  NETWORK:'暂时连不上云端，原有车辆仍保留。', FAMILY_MISMATCH:'云端家庭不匹配。',
  SYNC_DISABLED_PROD:'跨设备同步暂未开放。', OFF:'云端购买未启用。',
};
export const coinMessage = s => messages[s] ?? '云端商店暂不可用。';

export function renderCloudInfo(target, localCoins, isNew) {
  let box=target.querySelector('#coin-v19-status');
  if (!isNew) { box?.remove(); return; }
  if (!box) {
    box=document.createElement('section');
    box.id='coin-v19-status'; box.setAttribute('role','status');
    box.style.cssText='font:600 13px/1.42 system-ui;color:#e8f3ff;background:#152b47;border-radius:10px;padding:8px;margin:6px 0;';
    target.append(box);
  }
  const v=coinView();
  const balance=v.coins===null?'暂不可用':v.coins.toLocaleString('zh-CN');
  const own=v.current==='tiger-kart'?'虎啸流星':v.current==='monster-truck'?'雷霆巨兽':'';
  const lines=['本机金币 '+localCoins.toLocaleString('zh-CN'),
    '云端可购买金币 '+balance,
    '两份余额分开 · 本机金币不能用于新车'];
  if (v.status!=='OK') lines.push(v.status==='IDLE'?'正在查询云端…':coinMessage(v.status));
  else if (!v.enabled) lines.push('云端购买暂未开启。');
  if (own) lines.push('模拟云端当前装备 '+own);
  box.replaceChildren(...lines.map(line=>{const div=document.createElement('div');div.textContent=line;return div;}));
}
