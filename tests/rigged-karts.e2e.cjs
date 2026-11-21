/* Browser test for the isolated --qa build. Never point it at production. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.env.DUAL_KART_QA || 'http://127.0.0.1:8767/';
if (new URL(url).hostname !== '127.0.0.1') throw new Error('Loopback QA build required');

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    chromiumSandbox: true,
    args: ['--in-process-gpu','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({viewport:{width: 1120,height: 700}});
    page.setDefaultTimeout(30000);
    const errors = [];
    const unrelated = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (/tcloudbase\.com|tencentcloudapi\.com/.test(req.url())) unrelated.push(req.url()); });
    await page.goto(url);
    const state = () => page.evaluate(() => window.__dualKartQA());
    const ready = () => page.waitForFunction(() => typeof window.__dualKartQA === 'function');
    const garage = async () => { await page.getByRole('button',{name:/我的车库/}).click(); };
    const choose = name => page.getByRole('contentinfo').getByRole('button',{name:new RegExp(name)}).click();
    const select = async (name,id) => {
      await choose(name);
      await page.waitForFunction(id => window.__dualKartQA().garage===id,id);
    };
    const confirm = value => page.getByRole('dialog',{name:'确认购买'}).getByRole('button',{name:value});
    const buy = price => page.getByRole('button',{name:price+' 金币购买',exact:true});
    await ready();
    assert.equal((await state()).save.coins,6500);
    const oldOwned = (await state()).save.owned;
    assert(oldOwned.moto);
    await garage();
    await select('雷霆巨兽','monster-truck');
    assert(!((await state()).save.owned['monster-truck']));
    assert.notEqual((await state()).selected,'monster-truck');
    await buy('4,000').click();
    await confirm('取消').click();
    assert.equal((await state()).save.coins,6500);
    await buy('4,000').click();
    await confirm('确认购买').dblclick();
    await page.waitForFunction(() => window.__dualKartQA().save.coins === 2500);
    await page.reload();
    await ready();
    assert.equal((await state()).selected,'monster-truck');
    assert.equal((await state()).save.coins,2500);
    await garage();
    await select('虎啸流星','tiger-kart');
    await buy('2,000').click();
    await confirm('确认购买').dblclick();
    await page.waitForFunction(() => window.__dualKartQA().save.coins === 500);
    const current = await state();
    assert.equal(current.save.tx.filter(t=>t.kind==='purchase').length,2);
    assert.deepEqual(current.save.owned.moto,oldOwned.moto);
    await select('雷霆巨兽','monster-truck');
    assert.equal(await buy('4,000').count(),0);
    await select('虎啸流星','tiger-kart');
    if (process.env.EVIDENCE_DIR) await page.screenshot({path:process.env.EVIDENCE_DIR+'/tiger-garage.png'});
    console.log('PASS real UI purchase/cancel/double click/refresh/equip and existing motorcycle ownership');

    for (const [id, driver, label] of [['tiger-kart',true,'虎啸流星'],['monster-truck',false,'雷霆巨兽']]) {
      if (!driver) {
        await page.reload();
        await ready();
        await garage();
        await select(label,id);
        await page.getByRole('complementary').getByRole('button',{name:/使用|换上/}).click();
      }
      await page.getByRole('button',{name:'返回首页'}).click();
      await page.getByRole('button',{name:'开始游戏'}).click();
      await page.getByRole('button',{name:/老城海滨赛道/}).click();
      await page.waitForFunction(id=>window.__dualKartQA().activeKart===id,id);
      let a=await state();
      assert.equal(a.activeDriver,driver);
      assert.equal(a.wheels.length,4);
      if (process.env.EVIDENCE_DIR) await page.screenshot({path:process.env.EVIDENCE_DIR+'/'+id+'-race.png'});
      await page.keyboard.down('ArrowUp');
      await page.waitForFunction(()=>window.__dualKartQA().speed > 2);
      await page.keyboard.down('ArrowRight');
      await page.waitForFunction(()=>Math.abs(window.__dualKartQA().wheels[0].yaw)>.03);
      const b=await state();
      await page.keyboard.up('ArrowRight');
      assert(b.wheels[0].spin > a.wheels[0].spin);
      assert.equal(b.wheels[2].yaw,0);
      assert(Math.abs((b.wheels[0].spin-a.wheels[0].spin)*b.wheels[0].radius -
                      (b.wheels[2].spin-a.wheels[2].spin)*b.wheels[2].radius)<1e-5);
      await page.keyboard.down('ArrowLeft');
      await page.waitForFunction(yaw=>window.__dualKartQA().wheels[0].yaw*yaw<-.001,b.wheels[0].yaw);
      await page.keyboard.up('ArrowLeft');
      await page.keyboard.up('ArrowUp');
      await page.keyboard.down('ArrowDown');
      await page.waitForFunction(()=>window.__dualKartQA().speed < -.3);
      const reverse1=await state();
      await page.waitForFunction(spin=>window.__dualKartQA().wheels[0].spin<spin-.08,reverse1.wheels[0].spin);
      await page.keyboard.up('ArrowDown');
      await page.waitForFunction(()=>Math.abs(window.__dualKartQA().speed)<.001);
      const parked=await state();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert(Math.abs(parked.wheels[0].spin-(await state()).wheels[0].spin)<1e-4);
      console.log('PASS race forward, both steer directions, reverse and stopped '+id,JSON.stringify(parked.render));
    }
    const low=await browser.newPage();
    await low.addInitScript(() => {
      if (location.hostname !== '127.0.0.1') return;
      const p='lrv2.dual-kart.demo.20261121:';
      localStorage.setItem(p+'preview.fixture.v1','true');
      localStorage.setItem(p+'preview.birthday.claimed','true');
      localStorage.setItem(p+'lrv2.garage.coins',JSON.stringify({coins:1999}));
    });
    await low.goto(url);
    await low.getByRole('button',{name:/我的车库/}).click();
    for (const label of ['虎啸流星','雷霆巨兽']) {
      await low.getByRole('contentinfo').getByRole('button',{name:new RegExp(label)}).click();
      await low.getByRole('button',{name:'金币不足',exact:true}).waitFor();
      assert.equal(await low.getByRole('button',{name:'金币不足',exact:true}).isEnabled(),false);
    }
    assert.equal(await low.evaluate(()=>window.__dualKartQA().save.coins),1999);
    assert.deepEqual(unrelated,[]);
    assert.deepEqual(errors,[]);
    console.log('PASS insufficient funds for both cars and zero cloud requests');
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode=1; });
