import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const race = '/little-racing-v2/';
const learn = '/little-growth-workbench/v6/';
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.mp3':'audio/mpeg', '.png':'image/png', '.webp':'image/webp', '.svg':'image/svg+xml'};
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://localhost').pathname;
  const prefix = url.startsWith(race) ? race : learn;
  const root = prefix === race ? 'docs' : 'v6-stage/v6';
  const file = path.join(root, url.slice(prefix.length) + (url.endsWith('/') ? 'index.html' : ''));
  try {
    if (!url.startsWith(prefix)) throw Error('unknown route');
    const body = await fs.readFile(file);
    res.writeHead(200, {'content-type': mime[path.extname(file)] || 'application/octet-stream'});
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--mute-audio']});
const results = [];
const pass = name => { results.push(name); console.log('PASS',name); };
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const page = await browser.newPage();
let allowed = false, startAllowed = true, active = false, used = 315, pendingStop = false;
const events = [];
const errors = [];
const networkDiagnostics = [];
const device = 'fixture-device';
const saves = {'lrv2.garage.coins':{coins:3456,appliedRewards:[]},'littleRacingV2.story.chapter1':{state:'done',updatedAt:1},'lrv2.garage.owned':{red:{unlocked:true},turtle:{unlocked:true},moto:{unlocked:true}}};
try {
 await page.setViewport({width:844,height:390,isMobile:true,hasTouch:true});
 await page.setCacheEnabled(false);
 await page.setRequestInterception(true);
 page.on('pageerror', e => errors.push(e.message));
 page.on('requestfailed', req => {if(req.url().includes('/v1/game/')) networkDiagnostics.push(req.failure()?.errorText);});
 page.on('console', msg => {if(msg.text().includes('CORS') || msg.text().includes('[r5]')) networkDiagnostics.push(msg.text());});
 page.on('request', async req => {
   try {
     const url = new URL(req.url());
     if (url.origin === origin || ['data:','blob:'].includes(url.protocol)) {
       if (url.pathname === race+'assets/index-C359oddP.js') events.push('main');
       return await req.continue();
     }
     if (!url.pathname.endsWith('/v1/child/entry') && !url.pathname.endsWith('/v1/game/action')) return await req.abort();
     const headers = {'access-control-allow-origin':origin,'access-control-allow-headers':'content-type,x-r5-device','access-control-allow-methods':'POST,OPTIONS'};
     if (req.method()==='OPTIONS') return await req.respond({status:204,headers});
     const body = JSON.parse(req.postData());
     assert.equal(body.family_id,'little-growth-family-001');
     assert.equal(req.headers()['x-r5-device'],device);
     const action = body.action || 'status';
     events.push(action);
     if (action==='start') active = allowed && startAllowed;
     if (action==='tick' && active) used += 5;
     if (action==='stop') {
       pendingStop = true;
       await sleep(500);
       active = false;
       pendingStop = false;
       events.push('stop-complete');
     }
     return await req.respond({status:200,headers,contentType:'application/json',body:JSON.stringify({api:'r5_status',allowed:allowed && (action!=='start'||startAllowed),reason:allowed?'OK':'STUDY_INCOMPLETE_OR_SCORE_UNVERIFIED',active,used_seconds:used,remaining_seconds:1800-used,heartbeat_seconds:5})});
   } catch(e) { errors.push(e.message); await req.abort().catch(()=>{}); }
 });
 await page.evaluateOnNewDocument(() => {
   const raf = requestAnimationFrame.bind(window);
   window.requestAnimationFrame = cb => setTimeout(()=>raf(cb),80);
   Object.defineProperty(document,'visibilityState',{get:()=>window.testHidden ? 'hidden' : 'visible'});
 });
 await page.goto(origin+race);
 await page.waitForSelector('#st-nodevice.on');
 assert.ok(!events.includes('main'));
 await page.goto(origin+race+'gate.html?d='+device);
 await page.waitForSelector('#st-lock.on');
 assert.equal(new URL(page.url()).search,'');
 assert.deepEqual(events,['status']);
 pass('Unbound and under-target devices do not request the game bundle');
 await page.evaluate(token => sessionStorage.setItem('r5.grant',JSON.stringify({device:token,exp:Date.now()+300000})),device);
 await page.goto(origin+race+'index.html');
 await page.waitForFunction(()=>window.__R5_GUARD__?.state.phase==='blocked');
 assert.ok(!events.includes('start') && !events.includes('main'));
 pass('Forged local grant cannot bypass cloud preflight');
 allowed = true;
 startAllowed = false;
 await page.evaluate(token => sessionStorage.setItem('r5.grant',JSON.stringify({device:token,exp:Date.now()+300000})),device);
 await page.reload();
 await page.waitForFunction(()=>window.__R5_GUARD__?.state.phase==='blocked');
 assert.ok(events.includes('start') && !events.includes('main'));
 pass('Rejected start cannot request game bundle');
 startAllowed = true;
 await page.evaluate(entries=>{for(const [key,value] of Object.entries(entries))localStorage.setItem(key,JSON.stringify(value));},saves);
 await page.goto(origin+race+'gate.html');
 await page.waitForSelector('#playBtn',{timeout:60000});
 assert.equal(events[events.indexOf('main')-1],'start');
 await page.waitForFunction(()=>window.__R5_GUARD__?.state.last.used_seconds>315);
 pass('Approved device loads the actual WebGL game and ticks');
 const visible = hidden => page.evaluate(hidden => {window.testHidden=hidden;document.dispatchEvent(new Event('visibilitychange'));},hidden);
 await visible(true);
 for(let i=0;i<30 && !pendingStop;i++) await sleep(20);
 assert.ok(pendingStop);
 const eventOffset = events.length;
 await visible(false);
 await page.waitForFunction(()=>window.__R5_GUARD__?.state.last.active===true);
 for(let i=0;i<150 && !events.slice(eventOffset).includes('start');i++) await sleep(100);
 assert.deepEqual(events.slice(eventOffset,eventOffset+2),['stop-complete','start']);
 pass('Rapid foreground return waits for the background stop response');
 await visible(true);
 await page.waitForFunction(()=>window.__R5_GUARD__?.state.last.active===false);
 const paused = used;
 await sleep(5400);
 assert.equal(used,paused);
 await visible(false);
 await page.waitForFunction(()=>window.__R5_GUARD__?.state.last.active===true);
 await page.reload();
 await page.waitForSelector('#playBtn',{timeout:60000});
 assert.ok(await page.evaluate(()=>window.__R5_GUARD__.state.last.used_seconds)>=paused);
 pass('Background does not tick, foreground resumes, refresh preserves cumulative time');
 for(const id of ['storyBtn','storyBtn2']) await page.waitForSelector('#'+id);
 const preserved=await page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,JSON.parse(localStorage.getItem(key))])),Object.keys(saves));
 assert.equal(preserved['lrv2.garage.coins'].coins,3456);
 assert.equal(preserved['littleRacingV2.story.chapter1'].state,'done');
 assert.ok(preserved['lrv2.garage.owned'].turtle.unlocked);
 const manifest = JSON.parse(await fs.readFile('production-sha256.json','utf8'));
 const audio = Object.keys(manifest).filter(name=>name.endsWith('.mp3'));
 assert.equal(audio.filter(name=>/c2-/.test(name)).length,21);
 await page.evaluate(async urls => {
   const ctx = new AudioContext();
   try { await Promise.all(urls.map(async url=>{
     const response=await fetch(url);
     if (!response.ok || !(await ctx.decodeAudioData(await response.arrayBuffer())).duration) throw Error(url);
   })); } finally {await ctx.close();}
 },audio.map(file=>race+file));
 pass('Both chapters, legacy saves and all '+audio.length+' MP3s available');
 await page.goto(origin+learn);
 await page.waitForFunction(()=>!!window.R5Bridge);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#home .home-artwork')).backgroundImage.includes('v6-home-clean.jpg'));
 assert.equal(await page.$('#home .v6-native-live'),null);
 await page.click('#goLearning');
 await page.waitForSelector('.v6-daily-launch');
 pass('V6 clean home, daily learning entry and bridge render');
 assert.deepEqual(errors.filter(msg=>!msg.startsWith('R5_ENTRY_REDIRECT')),[]);
} catch(e) {
 console.log('BROWSER DIAGNOSTIC',page.url(),events,errors,networkDiagnostics,await page.evaluate(()=>document.body.innerText.slice(0,600)).catch(()=>null));
 throw e;
} finally {
 await fs.writeFile('rc2-browser-report.json',JSON.stringify({browser:await browser.version(),scope:'Staging candidates on localhost, simulated gateway, external requests blocked',passed:results},null,2));
 await browser.close();
 server.close();
}
