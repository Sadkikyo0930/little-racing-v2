import {createFamilySync, readLocalSave, writeLocalSave, eventsFromTx, buildPatch,
  SYNC_KEYS, QUEUE_KEY} from './r5-family-sync.mjs';

// The production family's ID is not a test fixture. Tests must inject the isolated family.
export const PRODUCTION_FAMILY = 'little-growth-family-001';
export const TEST_FAMILY = 'r5-selftest-family';
export const JOURNAL = 'lrv2.sync.journal.v1';
const parse = (s, fallback) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };
const copy = x => JSON.parse(JSON.stringify(x));
const memory = initial => {
  const m = new Map(Object.entries(initial));
  return {getItem: k => m.get(k) ?? null, setItem: (k,v) => m.set(k,String(v)), removeItem: k => m.delete(k)};
};
export function hasOldProgress(storage) {
  const l = readLocalSave(storage);
  return Number(l.coins.coins || 0) !== 0 || l.tx.length > 0 || Object.keys(l.owned).length > 0 ||
    l.claims.length > 0 || Object.keys(l.achievements).length > 0 || Object.keys(l.rewardLedger).length > 0 ||
    Object.keys(l.items).length > 0 || Object.keys(l.fragments).length > 0 ||
    Object.keys(l.story).length > 0 || Object.keys(l.study).length > 0 ||
    [l.chapter1.state, l.chapter2.state].some(s => s && s !== 'idle') ||
    !!storage.getItem('lrv2.vehicle') || !!storage.getItem('lrv2.driverSkin');
}

// The supplied SDK handles the protocol and retry. This adapter provides durable
// observation and a frozen storage snapshot so an in-flight response cannot erase
// newer gameplay. No migration, backup upload or production-family write exists here.
export function createSyncController({storage, fetchImpl = globalThis.fetch.bind(globalThis),
  baseUrl, deviceToken, expectedFamily = PRODUCTION_FAMILY, onStatus = () => {}, onRestore = () => {}}) {
  let journal = parse(storage.getItem(JOURNAL), {joined: false, seen: [], pending: [], current: 'red', currentDirty: false});
  journal.quarantined ||= [];
  let flight, rerun = false, lastStatus;
  const persist = () => storage.setItem(JOURNAL, JSON.stringify(journal));
  const state = (status, extra = {}) => {
    lastStatus = {status, synced: status === 'SYNCED', ...extra};
    storage.setItem('lrv2.sync.state', JSON.stringify(lastStatus)); onStatus(lastStatus); return lastStatus;
  };
  async function guardedFetch(url, init) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetchImpl(url, {...init, signal: ctrl.signal});
      const text = await res.text();
      let body; try { body = JSON.parse(text); } catch { throw new Error('BAD_RESPONSE'); }
      if (!res.ok) { const error = new Error(body.error || `HTTP_${res.status}`); error.status = res.status; throw error; }
      if (body.status === 'OK' || body.save) {
        if (body.api !== 'r5_racing_save' || body.save?.family_id !== expectedFamily) throw new Error('ISOLATION_FAMILY_DENIED');
        if (!Number.isSafeInteger(Number(body.save.coins_balance)) || Number(body.save.coins_balance) < 0) throw new Error('INVALID_CLOUD_BALANCE');
      }
      return {ok: true, status: res.status, text: async () => text};
    } finally { clearTimeout(timer); }
  }
  const base = baseUrl || 'https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5';
  async function getCloud() {
    if (!deviceToken) throw new Error('R5_DEVICE_REQUIRED');
    return JSON.parse(await (await guardedFetch(base + '/v1/racing/save/get', {
      method: 'POST', headers: {'content-type': 'application/json', 'x-r5-device': deviceToken}, body: '{}',
    })).text());
  }
  function capture() {
    if (!journal.joined) return;
    const local = readLocalSave(storage), seen = new Set(journal.seen);
    for (const tx of local.tx) {
      if (seen.has(tx.id)) continue;
      seen.add(tx.id);
      const events = eventsFromTx([{...tx, id: tx.syncEventId || tx.id}]);
      if (!events.length) { journal.quarantined.push({event: copy(tx), reason:'LOCAL_EVENT_INVALID', at:Date.now()}); journal.blocked = 'REVIEW_REQUIRED'; }
      for (const event of events) if (!journal.pending.some(e => e.event_id === event.event_id)) journal.pending.push(event);
    }
    journal.seen = [...seen];
    const current = local.current.vehicle || 'red';
    if (current !== journal.current) { journal.current = current; journal.currentDirty = true; }
    persist();
  }
  async function join({confirmReplace = false} = {}) {
    if (journal.joined) return sync();
    if (hasOldProgress(storage) && !confirmReplace) return state('LOCAL_SAVE_REVIEW_REQUIRED');
    try {
      const cloud = await getCloud();
      if (cloud.status !== 'OK' || !cloud.save) return state(cloud.status || 'ERROR');
      // Local immutable safety copy precedes any restore. It never goes to cloud.
      storage.setItem('lrv2.garage.backup.cloud-restore.' + Date.now(), JSON.stringify({at:Date.now(),tag:'before-cloud-restore',keys:Object.fromEntries(SYNC_KEYS.map(k => [k, storage.getItem(k)]))}));
      const before = Object.fromEntries(SYNC_KEYS.map(k => [k, storage.getItem(k)]));
      try {
        writeLocalSave(storage, cloud.save);
        storage.setItem('lrv2.garage.meta', JSON.stringify({version:4,createdAt:Date.now(),migratedAt:Date.now()}));
        // SDK intentionally preserves .tx; history belongs to the old device,
        // and must never be replayed into the new baseline.
        journal = {joined: true, seen: readLocalSave(storage).tx.map(t => t.id), pending: [],
          current: cloud.save.current_vehicle || 'red', currentDirty: false, quarantined: []};
        persist();
      } catch (error) {
        for (const [k,v] of Object.entries(before)) v == null ? storage.removeItem(k) : storage.setItem(k,v);
        throw error;
      }
      onRestore(); return state('RESTORED', {revision: cloud.save.revision});
    } catch (error) { return state('ERROR', {error: error.message}); }
  }
  async function run(retryBlocked = false) {
    if (!journal.joined) return join();
    if (journal.blocked && (!retryBlocked || ['REVIEW_REQUIRED','EVENT_CONFLICT'].includes(journal.blocked))) return state(journal.blocked, {queued:journal.pending.length, authoritative_coins:journal.authoritativeCoins});
    // Serialize one browser's calls, including periodic refresh and reconnect.
    for (let batch = 0; batch < 20; batch++) {
      capture();
      if (journal.blocked === 'REVIEW_REQUIRED') return state('REVIEW_REQUIRED', {quarantined:journal.quarantined.length});
      const frozen = Object.fromEntries(SYNC_KEYS.map(k => [k, storage.getItem(k)]));
      const pending = copy(journal.pending);
      const frozenCurrentDirty = journal.currentDirty;
      const snapshot = memory({...frozen, 'lrv2.garage.tx': '[]', [QUEUE_KEY]: JSON.stringify({events: pending})});
      let response;
      const api = createFamilySync({storage: snapshot, deviceToken, baseUrl: base,
        fetchImpl: async (url, init) => {
          if (url.endsWith('/save/sync')) {
            const body = JSON.parse(init.body);
            if (!frozenCurrentDirty) delete body.patch.current_vehicle;
            init = {...init, body: JSON.stringify(body)};
          }
          const res = await guardedFetch(url, init);
          const text = await res.text();
          if (url.endsWith('/save/sync')) response = JSON.parse(text);
          return {ok: res.ok, status: res.status, text: async () => text};
        }});
      state('SYNCING');
      const result = await api.sync();
      const rejected = (response?.rejected_events || []).filter(r => r.reason !== 'DUPLICATE_EVENT_ID_IN_REQUEST');
      if (rejected.length) {
        for (const rejection of rejected) journal.quarantined.push({
          event: copy(journal.pending.find(e => e.event_id === rejection.event_id) || null), ...rejection, at:Date.now()});
        const dead = new Set(rejected.map(r => r.event_id));
        journal.pending = journal.pending.filter(e => !dead.has(e.event_id));
        journal.blocked = 'REVIEW_REQUIRED'; persist();
      }
      if (response?.status !== 'APPLIED' || !response?.save) {
        if (['COINS_INSUFFICIENT','EVENT_CONFLICT','DENIED'].includes(result.status)) journal.blocked = result.status;
        journal.authoritativeCoins = response?.save?.coins_balance ?? journal.authoritativeCoins;
        persist();
        return state(journal.blocked || (result.status === 'OFFLINE' && result.http ? 'ERROR' : result.status), {
          error:result.error, queued:journal.pending.length, quarantined:journal.quarantined.length,
          authoritative_coins:journal.authoritativeCoins, rejected_events:rejected,
          existing_event_conflicts:response?.existing_event_conflicts || 0});
      }
      const confirmed = new Set([...(response.applied_events || []), ...(response.duplicate_events || [])]);
      capture();
      journal.pending = journal.pending.filter(e => !confirmed.has(e.event_id)); persist();
      if (rejected.length || (response.warnings || []).length) {
        journal.blocked = 'REVIEW_REQUIRED'; persist();
        return state('REVIEW_REQUIRED', {rejected_events: response.rejected_events, warnings: response.warnings});
      }
      const changed = SYNC_KEYS.some(k => storage.getItem(k) !== frozen[k]);
      if (changed || journal.pending.length) continue;
      const before = Object.fromEntries(SYNC_KEYS.map(k => [k, storage.getItem(k)]));
      try {
        writeLocalSave(storage, response.save);
        journal.current = readLocalSave(storage).current.vehicle || 'red'; journal.currentDirty = false; delete journal.blocked; delete journal.authoritativeCoins; persist();
      } catch (error) {
        for (const [k,v] of Object.entries(before)) v == null ? storage.removeItem(k) : storage.setItem(k,v);
        return state('ERROR', {error: 'LOCAL_RESTORE_FAILED'});
      }
      onRestore();
      return state('SYNCED', {revision: result.revision, queued: 0});
    }
    return state('PENDING', {queued: journal.pending.length});
  }
  function sync({retryBlocked = false} = {}) {
    if (flight) { rerun = true; return flight; }
    flight = run(retryBlocked).catch(error => state('ERROR', {error: error.message})).finally(() => {
      flight = null;
      if (rerun) { rerun = false; queueMicrotask(() => sync()); }
    });
    return flight;
  }
  return {join, sync, capture, getState: () => lastStatus, joined: () => journal.joined,
    blocked: () => journal.blocked || null, pending: () => copy(journal.pending), quarantined: () => copy(journal.quarantined),
    queueEvent(event) { if (!journal.joined) throw new Error('RESTORE_REQUIRED'); journal.pending.push(copy(event)); persist(); state('PENDING'); },
    exportPending: () => JSON.stringify({journal, raw:Object.fromEntries(SYNC_KEYS.map(k => [k,storage.getItem(k)]))},null,2)};
}
