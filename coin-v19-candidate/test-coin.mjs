import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCoinShop,mergeGarageOwnership} from './coin-shop.mjs';

const origin=process.env.COIN_TEST_ORIGIN ?? 'http://127.0.0.1:8770';
if(new URL(origin).hostname!=='127.0.0.1') throw Error('Use the dedicated loopback fixture server');
const base=origin+'/coin-preview-r5/v1/racing', family='r5-selftest-coin-v19';
let count=0;
const pass=label=>{count++;console.log('PASS',label)};
const opts=alias=>({base,device:'coin-v19-demo-'+alias,expectedFamily:family,retryDelays:[1],allowEquipSync:true});
const shop=alias=>createCoinShop(opts(alias));
const accept=async()=>true;
const tiger='tiger-kart', truck='monster-truck';
const local={coins:4417,owned:{moto:{paid:1500},'birthday-star-6':true,frag_common:{source:'fragment'},frag_rare:{source:'fragment'}},
  current:'moto',story:{chapter1:'done',chapter2:'done'},study:{score:99},fragments:{common:9},tx:[{id:'old-purchase'}]};
const frozen=JSON.stringify(local);
const project=s=>({...local,owned:mergeGarageOwnership(local.owned,s.view().owned)});
let a=shop('a'), b=shop('b');
assert.equal((await a.refresh()).status,'OK');
assert.equal(a.view().coins,6500);
assert.equal(a.view().catalog.get(tiger).price,2000);
assert.equal(a.view().catalog.get(truck).price,4000);
assert.deepEqual(project(a),local);
pass('state + authoritative prices, empty cloud retains all five local progress areas');

let zero=shop('zero'); await zero.refresh();
assert.equal(zero.view().coins,0); assert.equal(project(zero).coins,4417);
assert.equal((await zero.purchase(tiger,accept)).status,'INSUFFICIENT_COINS');
assert.deepEqual(project(zero),local);
pass('zero wallet display is independent; no grant with insufficient cloud coins');

for(const [alias,code] of [['denied','DEVICE_NOT_AUTHORIZED'],['offline','HTTP_503'],['missing','HTTP_404'],['invalid','HTTP_401']]) {
  let s=shop(alias); await s.refresh();
  assert.equal(s.view().status,code); assert.equal(s.view().coins,null);
  assert.equal((await s.purchase(tiger,accept)).status,'UNAVAILABLE');
  assert.deepEqual(project(s),local);
  pass(alias+' keeps local save and hides purchase');
}
const missing=createCoinShop({...opts('a'),device:'',fetchImpl:()=>assert.fail('Missing device must not fetch')});
await missing.refresh();
assert.equal(missing.view().status,'DEVICE_REQUIRED');
pass('missing device never sends request');
let d=shop('disabled');await d.refresh();
assert(!d.view().enabled && d.view().coins===6500);
assert.equal((await d.purchase(tiger,accept)).status,'UNAVAILABLE');
assert.deepEqual(project(d),local);
pass('disabled gate, prices retained, no local fallback');

const history=[];
a=createCoinShop({...opts('a'),fetchImpl:(url,init)=>{
  history.push([url,JSON.parse(init.body),init.headers['x-r5-device']]);
  return fetch(url,init);
}});
await Promise.all([a.refresh(),b.refresh()]);
assert.equal((await a.purchase(tiger,()=>false)).status,'CANCELLED');
assert.equal((await a.purchase(tiger,accept,()=>true)).status,'UNAVAILABLE');
assert.equal(history.filter(([url])=>url.endsWith('/purchase')).length,0);
pass('cancel and locally owned guard prevent any purchase request');

let release;
const first=a.purchase(tiger,()=>new Promise(resolve=>{release=resolve;}));
assert.equal((await a.purchase(tiger,accept)).status,'BUSY');
release(true);
const both=await Promise.all([first,b.purchase(tiger,accept)]);
assert.deepEqual(both.map(r=>r.status).sort(),['ALREADY_OWNED','PURCHASED']);
assert.equal(both.reduce((n,r)=>n+r.deducted,0),2000);
assert.equal(a.view().coins,4500); assert.equal(b.view().coins,4500);
assert.equal(a.view().current,null);
assert(history.some(([url,body,device])=>url.endsWith('/purchase')&&Object.keys(body).join()==='vehicle_id'&&device==='coin-v19-demo-a'));
pass('same-screen click lock plus two-device concurrent purchase idempotency; purchase does not equip');

const stale=shop('b'); await stale.refresh();
assert.equal((await a.purchase(truck,accept)).status,'PURCHASED');
assert.equal(a.view().coins,500);
assert.equal((await stale.syncEquip(tiger)).status,'APPLIED');
assert.equal(stale.view().current,tiger);
const fresh=shop('b'); await fresh.refresh();
assert(fresh.view().owned[tiger]&&fresh.view().owned[truck]);
assert.equal(fresh.view().coins,500);assert.equal(fresh.view().current,tiger);
assert.equal(project(fresh).current,'moto');assert.deepEqual(project(fresh).owned.moto,local.owned.moto);
assert.equal((await fresh.purchase(tiger,accept)).status,'UNAVAILABLE');
pass('4000 purchase, revision conflict refresh/retry, second device reloads receipts and equipment');

const direct=await fetch(base+'/coin/catalog',{method:'POST',headers:{'content-type':'application/json','x-r5-device':'coin-v19-demo-b'},body:'{}'}).then(r=>r.json());
assert(direct.catalog.every(row=>row.owned===false));
let catalog=createCoinShop({...opts('b'),fetchImpl:(url,init)=>url.endsWith('/state')?
  Response.json({error:'R5_RACING_SAVE_UNAVAILABLE'},{status:502}):fetch(url,init)});
await catalog.refresh();
assert.equal(catalog.view().catalog.get(tiger).price,2000);
assert.equal(Object.keys(catalog.view().owned).length,0);
assert.equal(catalog.view().coins,null);
pass('catalog fallback reads price but cannot grant ownership');

let flaky=shop('flaky');await flaky.refresh();
const lost=await flaky.purchase(tiger,accept);
assert.equal(lost.status,'ALREADY_OWNED');
assert.equal(lost.deducted,0);assert.equal(flaky.view().coins,4500);
assert(flaky.view().owned[tiger]);
pass('response lost after commit retries the same ID without a second debit');

let bad=createCoinShop({...opts('a'),fetchImpl:()=>Response.json({status:'OK',ok:true,family_id:'foreign'})});
await bad.refresh();
assert.equal(bad.view().status,'FAMILY_MISMATCH');assert.deepEqual(project(bad),local);
pass('foreign family and malformed data cannot overwrite local save');

assert.equal(mergeGarageOwnership(local.owned,{moto:{price:1},[tiger]:{source:'cloud'}}).moto,local.owned.moto);
assert(mergeGarageOwnership(local.owned,{[tiger]:{source:'cloud'}})[tiger]);
pass('local records win same-ID collisions and cloud grants are additive');

const testState={status:'OK',ok:true,family_id:family,coins_balance:6500,owned:{},
  revision:6,current_vehicle:'red',coin_gate_enabled:true,
  catalog:[{vehicle_id:tiger,currency:'coin',price:2000,owned:false}]};
for (const [name,reply] of [
  ['purchase gate closed after state',()=>Response.json({status:'PURCHASE_DISABLED',ok:false})],
  ['device denied after state',()=>Response.json({status:'DEVICE_NOT_AUTHORIZED',ok:false,coins_balance:0,owned:{}})],
  ['HTTP 403 after state',()=>Response.json({error:'R5_FAMILY_NOT_ALLOWED'},{status:403})],
  ['network drops after confirmation',()=>Promise.reject(new Error('offline'))],
]) {
  let calls=0;
  const target=createCoinShop({...opts('a'),fetchImpl:(url)=>{
    if(url.endsWith('/purchase')) { calls++; return reply(); }
    return Response.json(testState);
  }});
  await target.refresh();
  await target.purchase(tiger,accept);
  assert.equal(calls,name.startsWith('network')?2:1);
  assert.deepEqual(project(target),local);
  assert.equal(JSON.stringify(local),frozen);
  pass(name+' leaves local wallet, transactions and ownership intact');
}

let blocked=createCoinShop({...opts('a'),allowEquipSync:false});
await blocked.refresh();
assert.equal((await blocked.syncEquip(tiger)).status,'LOCAL_ONLY');
assert.equal(JSON.stringify(local),frozen);
pass('sync disabled without explicit opt-in; original wallet, vehicles, equipment, story and study unchanged');

const game=readFileSync(new URL('./site/assets/index-Cam3Integrated.js',import.meta.url),'utf8');
assert.match(game,/return;\s*\}let n=Ao\(e,t.unlock.price\)/);
assert.match(game,/Q.update\(Co\(\),\{storyState:Ud\(\)\.state\}\),Q.flashCoins\(-t.unlock.price\)/);
assert.match(game,/void coin.syncCloudVehicle\(e\)/);
pass('game still calls original debit and equip for legacy cards; new cards exit before legacy debit');
console.log(count+'/'+count+' passed');
