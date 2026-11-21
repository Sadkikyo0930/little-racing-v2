// Run against the checked-out static bundle. Uses only in-memory fixture saves.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const assets = new URL('../docs/assets/', import.meta.url);
const entry = readFileSync(new URL('index-Cam3Integrated.js',assets),'utf8');
const source = entry.slice(entry.indexOf('function Ao('),entry.indexOf('function No('));
const store = { coins: 6500, owned: { moto: { at: 1, price: 1500 } }, current: 'moto', tx: [] };
let live = structuredClone(store);
const context = vm.createContext({
  _o: () => live,
  wo: (kind,amount,reason,balance,syncEventId) => live.tx.push({kind,amount,reason,balance,syncEventId}),
  vo: () => Object.assign(store,structuredClone(live)),
  So: () => {},
  BIRTHDAY_ID: 'birthday-star-6',
  birthdayOwned: false,
});
vm.runInContext(source,context);
const {Ao:buy,Mo:equip} = context;
assert.equal(equip('tiger-kart',{drivable:true}),false);
assert.equal(equip('monster-truck',{drivable:true}),false);
assert.equal(buy('monster-truck',4000).coins,2500);
assert.equal(buy('monster-truck',4000).reason,'already-owned');
assert.equal(buy('tiger-kart',2000).coins,500);
assert.equal(buy('tiger-kart',2000).reason,'already-owned');
const owns = Object.keys(live.owned);
assert.deepEqual(owns,['moto','monster-truck','tiger-kart']);
assert.equal(store.tx.filter(tx => tx.kind === 'purchase').length,2);
live = structuredClone(store); // Simulate recreating the in-memory save after reload.
assert.equal(buy('tiger-kart',2000).reason,'already-owned');
assert.equal(equip('tiger-kart',{drivable:true}),true);
assert.equal(equip('monster-truck',{drivable:true}),true);
assert.equal(equip('moto',{drivable:true}),true);
live.owned = {};
assert.equal(buy('tiger-kart',2000).reason,'not-enough-coins');
assert.equal(buy('monster-truck',4000).reason,'not-enough-coins');
assert.equal(live.coins,500);
assert.match(entry,/this\.vehicle=t\.includes\(e\)\|\|isRiggedKart\(e\)\?/);
assert.match(entry,/this\.speed\/\(this\.model\.wheelRadius\|\|\.42\)\*e/);
assert.match(entry,/this\.wheelSpin\*\(t\.radius\?this\.model\.wheelRadius\/t\.radius:1\)/);

for (const [name,driver] of [['tiger-kart',true],['monster-truck',false]]) {
  const glb=readFileSync(new URL('karts/'+name+'-final.glb',assets));
  assert.equal(glb.toString('ascii',0,4),'glTF');
  assert.equal(glb.readUInt32LE(8),glb.length);
  const json=JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)));
  const nodes=json.nodes;
  assert.equal(nodes.some(n=>n.name==='DriverMount'),driver);
  assert.equal(json.images.length,4);
  assert(json.images.every(i=>i.bufferView!==undefined));
  for (const code of ['FL','FR','RL','RR']) {
    const pivot=nodes.find(n=>n.name===(code.startsWith('F')?'Steer_':'Axle_')+code);
    assert(pivot);
    const wheel=pivot.children.map(i=>nodes[i]).find(n=>n.name==='Wheel_'+code);
    assert(wheel?.extras.radius>0);
    assert(wheel.children.some(i=>nodes[i].name==='Tire_'+code));
  }
}
console.log('PASS: bundled purchase, insufficient funds, duplicate, reload, equip, moto, 8 wheel joints and embedded images');
