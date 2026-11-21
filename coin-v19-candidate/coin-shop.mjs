// v1.9 contract adapter. An endpoint and a device identity must be injected.
export const COIN_CARS = ['tiger-kart','monster-truck'];
const grantIds = new Map([
  ['moto','moto'], ['turtle','turtle'], ['frag_common','frag_common'], ['frag_rare','frag_rare'],
  ['frag_car_common_01','frag_common'], ['frag_car_rare_01','frag_rare'],
  ...COIN_CARS.map(id => [id,id]),
]);
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const validNum = v => Number.isSafeInteger(v) && v >= 0;
const auth = new Set(['HTTP_401','HTTP_403','DEVICE_REQUIRED','DEVICE_NOT_AUTHORIZED','FAMILY_MISMATCH']);
const retryable = new Set(['NETWORK','HTTP_502','HTTP_503','ERROR']);

export function mergeGarageOwnership(local, cloud) {
  return {...cloud, ...local};
}

function decodeCatalog(rows) {
  if (!Array.isArray(rows)) return null;
  const found = new Map();
  for (const row of rows) {
    if (!record(row) || !COIN_CARS.includes(row.vehicle_id) || !validNum(row.price) ||
        row.price === 0 || row.currency !== 'coin' || found.has(row.vehicle_id)) continue;
    found.set(row.vehicle_id, {id:row.vehicle_id, price:row.price, owned:row.owned === true});
  }
  return found;
}

export function createCoinShop({base, device, expectedFamily, allowEquipSync = false,
    fetchImpl = globalThis.fetch.bind(globalThis), timeoutMs = 8000,
    retryDelays = [300,800,2000], notify = () => {}}) {
  let snapshot = {coins:null, revision:null, enabled:false, current:null, owned:{}, catalog:new Map(), status:'IDLE'};
  let refreshFlight, mutation = false;

  function view() { return {...snapshot,busy:mutation}; }
  function set(patch) {
    snapshot = {...snapshot,...patch};
    notify(view());
  }

  async function request(route, payload = {}) {
    if (!device) return {status:'DEVICE_REQUIRED'};
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const raw = await fetchImpl(base+route,{method:'POST',cache:'no-store',redirect:'error',
        headers:{'content-type':'application/json','x-r5-device':device},
        body:JSON.stringify(payload),signal:controller.signal});
      if (!raw.ok) return {status:'HTTP_'+raw.status};
      let data;
      try { data=await raw.json(); } catch { return {status:'BAD_RESPONSE'}; }
      if (!record(data) || typeof data.status !== 'string') return {status:'BAD_RESPONSE'};
      if ('family_id' in data && data.family_id !== expectedFamily) return {status:'FAMILY_MISMATCH'};
      return data;
    } catch { return {status:'NETWORK'}; }
    finally { clearTimeout(timer); }
  }

  function applyState(data) {
    const catalog = decodeCatalog(data.catalog);
    if (data.status !== 'OK' || data.ok !== true || data.family_id !== expectedFamily ||
        !validNum(data.coins_balance) || !validNum(data.revision) || typeof data.coin_gate_enabled !== 'boolean' ||
        !record(data.owned) || !catalog) return false;
    if (snapshot.revision !== null && data.revision < snapshot.revision) return false;
    const owned = {};
    for (const [raw,value] of Object.entries(data.owned)) {
      const id = grantIds.get(raw);
      if (id && !COIN_CARS.includes(id) && record(value)) owned[id] = value;
    }
    // Catalog-only never grants entitlement. For these two cars use state.catalog.
    for (const [id,row] of catalog) {
      if (row.owned) owned[id] = record(data.owned[id]) ? data.owned[id] : {source:'verified-cloud'};
    }
    const current = grantIds.get(data.current_vehicle);
    set({coins:data.coins_balance,revision:data.revision,enabled:data.coin_gate_enabled,
      current:current && owned[current] ? current : null,owned,catalog,status:'OK'});
    return true;
  }

  function fail(status) {
    set({status, coins:null, enabled:false, ...(auth.has(status) ?
      {owned:{},current:null,revision:null,catalog:new Map()} : {})});
  }

  async function fetchState() {
    const data = await request('/coin/state');
    if (applyState(data)) return data;
    fail(data.status === 'OK' ? 'BAD_RESPONSE' : data.status);
    // Price-only downgrade. It can neither grant nor revoke a vehicle.
    if (!auth.has(data.status) && data.status !== 'HTTP_404') {
      const prices = await request('/coin/catalog');
      const catalog=decodeCatalog(prices.catalog);
      if (prices.status === 'OK' && prices.ok === true && prices.family_id === expectedFamily && catalog) {
        set({catalog:new Map([...catalog].map(([id,row]) => [id,{...row,owned:false}]))});
      }
    }
    return data;
  }

  function refresh() {
    if (refreshFlight) return refreshFlight;
    if (mutation) return Promise.resolve({status:'BUSY'});
    refreshFlight=fetchState().finally(()=>{refreshFlight=null;});
    return refreshFlight;
  }

  async function purchase(id, confirm, hasLocal = () => false) {
    if (mutation || refreshFlight) return {status:'BUSY'};
    const offer=snapshot.catalog.get(id);
    if (!snapshot.enabled || !offer || offer.owned || snapshot.owned[id] || hasLocal()) return {status:'UNAVAILABLE'};
    if (snapshot.coins < offer.price) return {status:'INSUFFICIENT_COINS',deficit:offer.price-snapshot.coins};
    mutation=true;
    notify(view());
    try {
      if (!await confirm(offer.price) || hasLocal()) return {status:'CANCELLED'};
      let result=await request('/coin/purchase',{vehicle_id:id});
      for (const delay of retryDelays) {
        if (!retryable.has(result.status)) break;
        await new Promise(resolve=>setTimeout(resolve,delay));
        result=await request('/coin/purchase',{vehicle_id:id});
      }
      if (['PURCHASED','ALREADY_OWNED'].includes(result.status)) {
        const deductedOk=result.status==='PURCHASED' ? result.deducted===result.price && result.price>0 : result.deducted===0;
        const owned=result.owned ?? result.save?.owned;
        if (result.ok === true && result.vehicle_id === id && result.family_id === expectedFamily &&
            validNum(result.coins_balance) && validNum(result.revision) && deductedOk && record(owned?.[id])) {
          const catalog = [...snapshot.catalog.values()].map(row=>({vehicle_id:row.id,currency:'coin',price:row.price,
            owned:row.id===id || record(owned[row.id]) || row.owned}));
          if (applyState({...result,status:'OK',owned,catalog,coin_gate_enabled:snapshot.enabled})) return result;
        }
        // A damaged/unknown reply may follow a server commit. Only state can reconcile it.
        await fetchState();
        return {status:'UNCONFIRMED'};
      }
      if (retryable.has(result.status) || result.status === 'BAD_RESPONSE') {
        await fetchState();
        return {status:'UNCONFIRMED'};
      }
      if (auth.has(result.status) || ['HTTP_404','PURCHASE_DISABLED','SYNC_DISABLED_PROD','SAVE_NOT_INITIALIZED'].includes(result.status)) fail(result.status);
      if (['INSUFFICIENT_COINS','VEHICLE_DISABLED','VEHICLE_NOT_FOUND'].includes(result.status)) await fetchState();
      return result;
    } finally {
      mutation=false;
      notify(view());
    }
  }

  async function syncEquip(id) {
    if (!allowEquipSync || mutation || refreshFlight || snapshot.status !== 'OK' ||
        !snapshot.owned[id] || snapshot.revision === null) {
      return {status:'LOCAL_ONLY'};
    }
    mutation=true;
    notify(view());
    try {
      const submit=()=>request('/save/sync',{expected_revision:snapshot.revision,events:[],patch:{current_vehicle:id}});
      let result=await submit();
      if (result.status === 'REVISION_CONFLICT') {
        const fresh=await fetchState();
        if (fresh.status === 'OK' && snapshot.status === 'OK' && snapshot.owned[id]) result=await submit();
      }
      if (result.status === 'APPLIED' && result.save?.family_id === expectedFamily &&
          result.save?.current_vehicle === id && validNum(result.save.revision) &&
          result.save.revision >= snapshot.revision && !(result.warnings || []).length) {
        set({revision:result.save.revision,current:id});
      }
      return result;
    } finally {
      mutation=false;
      notify(view());
    }
  }
  return {view,refresh,purchase,syncEquip};
}
