import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const html=readFileSync('docs/gate.html','utf8');
for(const id of ['parent-entry-open','parent-entry-dialog','parent-entry-form','parent-entry-secret','parent-entry-status']) {
 assert(html.includes('id="'+id+'"'),'Missing '+id);
}
assert(html.includes("R5_CONFIG.base+'/v1/parent/game-override'"),'Missing server auth request');
assert(html.includes("'x-r5-parent':secret"),'Must authenticate to server');
assert(html.includes("payload?.authorized!==true"),'Must fail closed');
assert(html.includes("Number(payload.remaining_seconds)<=0"),'Must reject no time left');
assert(!html.includes("localStorage.setItem('parent-entry"),'Parent secret must not be cached');
const scripts=[...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
const dir=mkdtempSync(join(tmpdir(),'r5-parent-'));
try{
 for(let i=0;i<scripts.length;i++){
  const p=join(dir,i+'.mjs');writeFileSync(p,scripts[i]);
  const run=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});
  assert.equal(run.status,0,'script '+i+' syntax: '+run.stderr);
 }
}finally{rmSync(dir,{recursive:true,force:true});}
console.log('PASS: parent entry UI, strict server response gating, no local secret persistence, HTML embedded JS syntax');
