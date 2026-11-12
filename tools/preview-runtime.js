/* Standalone demo only. Not imported by the production candidate. */
(() => {
  'use strict';
  const prefix='lrv2.cam3.selftest.20261112:';
  const rawLocal=window.localStorage, rawSession=window.sessionStorage;
  function scoped(raw) {
    const api={getItem:k=>raw.getItem(prefix+k),setItem:(k,v)=>raw.setItem(prefix+k,String(v)),
      removeItem:k=>raw.removeItem(prefix+k),
      key:i=>Object.keys(raw).filter(k=>k.startsWith(prefix))[i]?.slice(prefix.length)??null,
      clear:()=>Object.keys(raw).filter(k=>k.startsWith(prefix)).forEach(k=>raw.removeItem(k))};
    Object.defineProperty(api,'length',{configurable:true,get:()=>Object.keys(raw).filter(k=>k.startsWith(prefix)).length});
    return new Proxy(api,{get:(o,k)=>k in o?o[k]:o.getItem(k),set:(o,k,v)=>(o.setItem(k,v),true),
      ownKeys:()=>Object.keys(raw).filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length)),
      getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});
  }
  Object.defineProperty(window,'localStorage',{value:scoped(rawLocal)});
  Object.defineProperty(window,'sessionStorage',{value:scoped(rawSession)});
  // Only demo-owned keys can be read, exported, restored or cleared.
  localStorage.setItem('r5_device','cam3-selftest-device');
  if (location.pathname.endsWith('/') || location.pathname.endsWith('/index.html')) sessionStorage.setItem('r5.grant',JSON.stringify({device:'cam3-selftest-device',at:Date.now(),exp:Date.now()+300000}));
  localStorage.removeItem('r5.family-sync.migration-confirmed.v1');
  const nativeFetch=window.fetch.bind(window),family='r5-selftest-family';
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.hostname.endsWith('tcloudbase.com')) throw new Error('PREVIEW_CLOUDBASE_BLOCKED');
    if(url.origin===location.origin && url.pathname.includes('/demo-r5/')) {
      const body=JSON.parse(options.body||'{}');
      if(body.family_id!==family) return Response.json({error:'R5_FAMILY_NOT_ALLOWED'},{status:403});
      const mode=new URLSearchParams(location.search).get('scenario')||'allowed';
      if(mode==='network') throw new TypeError('Isolated simulated network failure');
      if(url.pathname.endsWith('/birthday/claim')) {
        const newly=!localStorage.getItem('preview.birthday.claimed');
        localStorage.setItem('preview.birthday.claimed','true');
        return Response.json({api:'r5_birthday',status:newly?'CLAIMED':'ALREADY_CLAIMED',newly_claimed:newly,
          claim:{family_id:family,gift_id:'six-star-supercar-2026',permanent:true,claimed_at:'2026-11-12T00:00:00Z'}});
      }
      const allowed=mode==='allowed';
      return Response.json({api:'r5_status',allowed,active:allowed&&body.action!=='stop',remaining_seconds:mode==='quota'?0:1800,
        heartbeat_seconds:10,reason:mode==='quota'?'TIME_LIMIT_REACHED':allowed?'STUDY_PASSED':'STUDY_INCOMPLETE_OR_SCORE_UNVERIFIED'});
    }
    return nativeFetch(input,options);
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const a=document.createElement('a');a.id='cam3-preview-note';a.href='./gate.html';
    a.textContent='隔离试玩 · 本机存档 · 模拟学习闸门';
    a.style.cssText='position:fixed;bottom:3px;right:5px;z-index:2147483647;color:#fff;background:#13253bdc;padding:5px 8px;border-radius:8px;font:11px system-ui;text-decoration:none';
    document.body.append(a);
  });
})();
