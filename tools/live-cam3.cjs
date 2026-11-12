const {chromium,request}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const url='https://little-racing-v2-cam3-preview-20261112.sadkikyo.chatgpt.site/';
const report={url,checks:[],errors:[],badResources:[],cloudRequests:[]};
const ok=(name,data)=>{report.checks.push({name,result:'PASS',data});console.log('PASS',name,JSON.stringify(data??''));};
(async()=>{
 fs.mkdirSync('/tmp/cam3-evidence',{recursive:true});
 const api=await request.newContext();
 const mr=await api.get(url+'production-sha256.json');assert.equal(mr.status(),200);
 const manifest=await mr.json(),entries=Object.entries(manifest);
 for(let i=0;i<entries.length;i+=8)await Promise.all(entries.slice(i,i+8).map(async([path,hash])=>{
  const r=await api.get(url+path);assert.equal(r.status(),200,path);
  assert.equal(crypto.createHash('sha256').update(await r.body()).digest('hex'),hash,path);
 }));ok('deployed resource SHA256',entries.length);
 const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
 const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const page=await context.newPage();
 page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('request',r=>{if(r.url().includes('tcloudbase.com'))report.cloudRequests.push(r.url());});
 page.on('response',r=>{if(r.url().startsWith(url)&&r.status()>=400)report.badResources.push([r.status(),r.url()]);});
 page.on('requestfailed',r=>{if(r.url().startsWith(url))report.badResources.push(['failed',r.url(),r.failure()]);});
 try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#playBtn',{timeout:120000});
  await page.waitForFunction(()=>!document.getElementById('boot')||document.getElementById('boot').classList.contains('done'),{timeout:120000});
  await page.waitForSelector('dialog[aria-label="生日惊喜"]',{timeout:60000});
  const frame=page.frameLocator('iframe[title="生日开箱"]');
  await frame.locator('#play').click();
  await page.waitForTimeout(2500);
  assert.equal(await frame.locator('#progress').getAttribute('max'),'40');
  ok('birthday claim, dialog and 40 second show');
  await page.screenshot({path:'/tmp/cam3-evidence/birthday.png'});
  await page.getByRole('button',{name:'返回游戏',exact:true}).click();
  assert(await page.locator('#scene').evaluate(c=>!!c.getContext('webgl2')));ok('real WebGL startup');
  await page.locator('#garageBtn').click();
  await page.waitForSelector('#garage:not(.hidden)',{timeout:30000});
  const birthday=page.locator('.gCard[data-id="birthday-star-6"]');assert.equal(await birthday.count(),1);
  await birthday.click();await page.waitForTimeout(2500);ok('six star garage card and selection');
  await page.locator('.gCard[data-id="frag_common"]').click();await page.waitForTimeout(2500);
  ok('Thunder Cam3 garage selection');
  await page.screenshot({path:'/tmp/cam3-evidence/thunder.png'});
  await page.locator('#garageBack').click();
  await page.locator('#storyModeBtn').click();
  assert.match(await page.locator('#scsCh1').innerText(),/海滨赛车节开幕/);
  assert.match(await page.locator('#scsCh2').innerText(),/阳光沙滩大冒险/);ok('both chapter entries');
  await page.locator('#scsBack').click();
  await page.locator('#playBtn').click();await page.waitForTimeout(1500);
  ok('normal race selection',await page.locator('body').innerText().then(x=>x.slice(-300)));
  await page.screenshot({path:'/tmp/cam3-evidence/mobile.png'});
  // Gate backup uses the preview namespace and cannot read production storage.
  await page.evaluate(()=>localStorage.setItem('lrv2.garage.coins',JSON.stringify({coins:123})));
  await page.goto(url+'gate.html',{waitUntil:'domcontentloaded'});
  await page.locator('#parent-backup-link').click();
  await page.waitForFunction(()=>!document.getElementById('parent-backup-export').disabled);
  ok('parent backup reads nonempty isolated save');
  for(const scenario of ['denied','quota','network']) {
   await page.goto(url+'?scenario='+scenario,{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#r5-veil',{timeout:30000});
   await page.waitForFunction(()=>!document.querySelector('#r5-veil .spin'),{timeout:30000});
   assert.equal(await page.locator('#playBtn').count(),0);ok('R5 fail-closed '+scenario);
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResources,[]);assert.deepEqual(report.cloudRequests,[]);
  ok('no runtime errors, no resource failures, zero CloudBase requests');
 } finally {
  report.body=await page.locator('body').innerText().catch(()=> '');
  await page.screenshot({path:'/tmp/cam3-evidence/final.png'}).catch(()=>{});
  fs.writeFileSync('/tmp/cam3-evidence/report.json',JSON.stringify(report,null,2));await browser.close();await api.dispose();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
