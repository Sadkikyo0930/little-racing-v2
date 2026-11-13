const {chromium,request}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const url=process.env.CAM3_PREVIEW_URL||'https://little-racing-v2-cam3-preview-20261112.sadkikyo.chatgpt.site/';
const report={url,checks:[],errors:[],badResources:[],cloudRequests:[]};
const ok=(name,data)=>{report.checks.push({name,result:'PASS',data});console.log('PASS',name,JSON.stringify(data??''));};
(async()=>{
 fs.mkdirSync('/tmp/cam3-evidence',{recursive:true});
 const api=await request.newContext(process.env.HTTPS_PROXY ? {proxy:{server:process.env.HTTPS_PROXY}} : {});
 const mr=await api.get(url+'production-sha256.json');assert.equal(mr.status(),200);
 const manifest=await mr.json(),entries=Object.entries(manifest);
 for(let i=0;i<entries.length;i+=8)await Promise.all(entries.slice(i,i+8).map(async([path,hash])=>{
  const r=await api.get(url+path+'?qa='+Date.now());assert.equal(r.status(),200,path);
  const body=await r.body();let checked=body;
  if(path.endsWith('.html'))checked=Buffer.from(body.toString().replace(/<script>\(function\(\)\{function c\(\)\{[\s\S]*?<\/script>/g,tag=>tag.includes('window.__CF$cv$params')&&tag.includes('/cdn-cgi/challenge-platform/')?'':tag));
  assert.equal(crypto.createHash('sha256').update(checked).digest('hex'),hash,path);

 }));ok('deployed resource SHA256',entries.length);
 const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{}),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
 const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:0.5});
 let page=await context.newPage();
 function observe(page) { page.on('pageerror',e=>{report.errors.push(String(e));console.log('PAGE ERROR',String(e));});
 page.on('request',r=>{if(r.url().includes('tcloudbase.com'))report.cloudRequests.push(r.url());});
 page.on('response',r=>{if(r.url().startsWith(url)&&r.status()>=400)report.badResources.push([r.status(),r.url()]);});
 page.on('requestfailed',r=>{if(r.url().startsWith(url)&&!(r.resourceType()==='media'&&r.failure()?.errorText==='net::ERR_ABORTED'))report.badResources.push(['failed',r.url(),r.failure()]);});
 }
 observe(page);
 try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
  await page.waitForSelector('#playBtn',{timeout:120000});
  await page.waitForFunction(()=>!document.getElementById('boot')||document.getElementById('boot').classList.contains('done'),{timeout:120000});
  await page.waitForSelector('dialog[aria-label="生日惊喜"]',{timeout:60000});
  const frame=page.frameLocator('iframe[title="生日开箱"]');
  assert.equal(await frame.locator('#progress').getAttribute('max'),'40');
  assert.equal(await frame.locator('#play').count(),1);
  ok('birthday claim, dialog, 40 second timeline and playback control');
  await page.evaluate(()=>document.querySelector('dialog[aria-label="生日惊喜"]').close());
  assert(await page.locator('#scene').evaluate(c=>!!c.getContext('webgl2')));ok('real WebGL startup');
  await page.locator('#garageBtn').dispatchEvent('click');
  await page.waitForSelector('#garage:not(.hidden)',{timeout:30000});
  const birthday=page.locator('.gCard[data-id="birthday-star-6"]');assert.equal(await birthday.count(),1);
  await birthday.dispatchEvent('click');await page.waitForTimeout(2500);ok('six star garage card and selection');
  await page.locator('.gCard[data-id="frag_common"]').dispatchEvent('click');await page.waitForTimeout(2500);
  ok('Thunder Cam3 garage selection');
  await page.locator('#garageBack').dispatchEvent('click');
  await page.locator('#storyModeBtn').dispatchEvent('click');
  assert.match(await page.locator('#scsCh1').innerText(),/海滨赛车节开幕/);
  assert.match(await page.locator('#scsCh2').innerText(),/阳光沙滩大冒险/);ok('both chapter entries');
  await page.locator('#scsBack').dispatchEvent('click');
  assert(await page.locator('#playBtn').isVisible());assert(await page.locator('#playBtn').isEnabled());
  await page.locator('#playBtn').dispatchEvent('click');await page.waitForTimeout(1500);
  ok('normal race selection',await page.locator('body').innerText().then(x=>x.slice(-300)));
  // Gate backup uses the preview namespace and cannot read production storage.
  await page.evaluate(()=>localStorage.setItem('lrv2.garage.coins',JSON.stringify({coins:123})));
  await page.close(); page=await context.newPage(); observe(page);
  await page.goto(url+'gate.html?scenario=denied',{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('#parent-backup-link').dispatchEvent('click');
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
  await page.screenshot({path:'/tmp/cam3-evidence/final.png',timeout:10000}).catch(()=>{});
  fs.writeFileSync('/tmp/cam3-evidence/report.json',JSON.stringify(report,null,2));await browser.close();await api.dispose();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
