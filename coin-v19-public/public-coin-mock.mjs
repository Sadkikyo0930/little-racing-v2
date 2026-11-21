// Demo-only ledger. IndexedDB serializes requests across tabs on the same browser.
const family='r5-selftest-coin-v19';
const offers={
  'tiger-kart':{display_name:'虎啸流星',price:2000},
  'monster-truck':{display_name:'雷霆巨兽',price:4000},
};
const aliases=new Set(['a','b','zero','disabled','denied','flaky','offline','missing']);
const prefix='/coin-preview-r5/v1/racing/';
const reply=(status,body)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
});

let db;
function openLedger() {
  if (!db) {
    db=new Promise((resolve,reject)=>{
      const request=indexedDB.open('little-racing-preview-coin-v19',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('demo');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    db.catch(()=>{db=null;});
  }
  return db;
}

async function transact(profile, action) {
  const database=await openLedger();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('demo','readwrite');
    const ledger=tx.objectStore('demo');
    const request=ledger.get(profile);
    let result;
    request.onsuccess=()=>{
      const record=request.result ?? {coins:profile==='zero'?0:6500,owned:{},current:'red',
        revision:6,enabled:profile!=='disabled',lost:{}};
      try {
        const outcome=action(record);
        result=outcome.result;
        if (outcome.changed) ledger.put(record,profile);
      } catch { tx.abort(); }
    };
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error ?? Error('Demo ledger aborted'));
  });
}

function evaluate(data, alias, route, body) {
  function save() {return {family_id:family,coins_balance:data.coins,owned:structuredClone(data.owned),
    current_vehicle:data.current,revision:data.revision};}
  const outcome=(status,body,changed=false)=>({result:reply(status,body),changed});
  const catalog=owned=>Object.entries(offers).map(([id,offer])=>({vehicle_id:id,...offer,
    currency:'coin',owned:owned&&Object.hasOwn(data.owned,id)}));

  if (route==='coin/catalog' || route==='coin/state') {
    if (Object.keys(body).length) return outcome(400,{error:'BAD_REQUEST'});
    if(route==='coin/catalog') return outcome(200,{status:'OK',ok:true,family_id:family,catalog:catalog(false)});
    return outcome(200,{status:'OK',ok:true,...save(),catalog:catalog(true),coin_gate_enabled:data.enabled});
  }
  if (route==='coin/purchase') {
    const id=body.vehicle_id;
    if (Object.keys(body).join()!=='vehicle_id'||!Object.hasOwn(offers,id))
      return outcome(200,{status:'VEHICLE_NOT_FOUND',ok:false,zero_write:true,deducted:0});
    const price=offers[id].price;
    let status='PURCHASE_DISABLED',deducted=0;
    if (data.enabled) {
      if (Object.hasOwn(data.owned,id)) status='ALREADY_OWNED';
      else if (data.coins<price) status='INSUFFICIENT_COINS';
      else {
        status='PURCHASED';deducted=price;
        data.coins-=price;data.revision++;
        data.owned[id]={currency:'coin',source:'coins',price};
        if (alias==='flaky'&&!data.lost[id]) {
          data.lost[id]=true;
          return outcome(502,{error:'SIMULATED_RESPONSE_LOST_AFTER_COMMIT'},true);
        }
      }
    }
    const ok=status==='PURCHASED'||status==='ALREADY_OWNED';
    return outcome(200,{status,ok,...save(),vehicle_id:id,deducted,price,zero_write:!deducted,
      deficit:status==='INSUFFICIENT_COINS'?price-data.coins:null,save:ok?save():null},!!deducted);
  }
  if (route==='save/sync') {
    if(Object.keys(body).sort().join()!=='events,expected_revision,patch'||!Array.isArray(body.events)||
       body.events.length||!body.patch||Object.keys(body.patch).join()!=='current_vehicle')
      return outcome(400,{error:'BAD_PATCH'});
    if (body.expected_revision!==data.revision)
      return outcome(200,{status:'REVISION_CONFLICT',revision:data.revision,zero_write:true});
    const id=body.patch.current_vehicle;
    if (!Object.hasOwn(data.owned,id))
      return outcome(200,{status:'APPLIED',save:save(),warnings:['CURRENT_VEHICLE_NOT_OWNED']});
    const changed=data.current!==id;
    if(changed){data.current=id;data.revision++;}
    return outcome(200,{status:'APPLIED',save:save(),warnings:[]},changed);
  }
  return outcome(404,{error:'R5_NOT_FOUND'});
}

export async function mockCoinFetch(input,init) {
  const url=new URL(input,location.href);
  const device=new Headers(init.headers).get('x-r5-device')??'';
  const alias=device.slice('coin-v19-demo-'.length);
  if(url.origin!==location.origin||!url.pathname.startsWith(prefix)||init.method!=='POST')
    return reply(404,{error:'R5_NOT_FOUND'});
  if(!device.startsWith('coin-v19-demo-')||!aliases.has(alias)) return reply(401,{error:'R5_MEMBER_DENIED'});
  if(alias==='missing') return reply(404,{error:'R5_NOT_FOUND'});
  if(alias==='offline') return reply(503,{error:'R5_RACING_SAVE_UNAVAILABLE'});
  if(alias==='denied') return reply(200,{status:'DEVICE_NOT_AUTHORIZED',ok:false,
    family_id:family,coins_balance:0,owned:{},current_vehicle:'red',revision:0,coin_gate_enabled:false,catalog:[]});
  let body;
  try {body=JSON.parse(init.body);if(!body||typeof body!=='object'||Array.isArray(body)) throw Error('BAD_REQUEST');}
  catch{return reply(400,{error:'BAD_REQUEST'});}
  const profile=alias==='a'||alias==='b'?'shared':alias;
  try { return await transact(profile,record=>evaluate(record,alias,url.pathname.slice(prefix.length),body)); }
  catch { return reply(503,{error:'DEMO_LEDGER_UNAVAILABLE'}); }
}
