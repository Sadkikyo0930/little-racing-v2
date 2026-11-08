import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const base = 'https://sadkikyo0930.github.io/little-racing-v2/';
const manifest = JSON.parse(fs.readFileSync('production-sha256.json', 'utf8'));
fs.mkdirSync('live-results', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
page.on('requestfailed', r => { if (r.url().startsWith(base)) errors.push(r.failure()?.errorText + ' ' + r.url()); });
const seed = {
  'lrv2.garage.meta': { version: 3, createdAt: 100, migratedAt: 200 },
  'lrv2.garage.coins': { coins: 3456, updatedAt: 100 },
  'lrv2.garage.owned': { turtle: { at: 1, source: 'story-chapter1' }, moto: { at: 2, source: 'purchase' } },
  'lrv2.garage.current': { vehicle: 'moto', updatedAt: 100 },
  'lrv2.garage.tx': [{ id: 'existing-transaction', delta: 120, at: 1 }],
  'lrv2.garage.claims': ['existing-claim'],
  'lrv2.garage.rewards.story': { chapter1: { granted: true, at: 1, vehicleId: 'turtle' } },
  'lrv2.garage.rewards.study': { existing: { granted: true } },
  'littleRacingV2.story.chapter1': { state: 'done', updatedAt: 100 },
  'littleRacingV2.story.chapter2': { state: 'done', updatedAt: 200 },
};
// This is a new automated browser profile, never a player's browser or account.
await page.evaluateOnNewDocument(seed => {
  if (!localStorage.getItem('release.qa.seeded')) {
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('release.qa.seeded', '1');
  }
}, seed);
const ready = async () => {
  await page.waitForFunction(() => document.querySelector('#garageBtnCoinsNum')?.textContent === '3,456', { timeout: 300000 });
  await page.waitForSelector('#storyBtn', { visible: true, timeout: 120000 });
};
try {
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(base + '?release=fc50907f', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await ready();
  assert((await page.title()).includes('小小赛车'));
  assert((await page.url()).startsWith(base));
  assert.equal(await page.$eval('#storyBtn2', e => e.disabled), false);
  const exposed = await page.evaluate(() => ['__sim', '__garage', '__game', '__story', '__RaceState'].filter(k => typeof window[k] !== 'undefined'));
  assert.deepEqual(exposed, []);
  await page.screenshot({ path: 'live-results/production-home-desktop.png' });
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
  await page.screenshot({ path: 'live-results/production-home-mobile.png' });
  console.log('PASS: live homepage, desktop/mobile menu, 3456 coins and no debug interfaces');

  const audioPaths = Object.keys(manifest).filter(p => p.endsWith('.mp3'));
  const audio = await page.evaluate(async paths => {
    const ctx = new AudioContext();
    const results = [];
    for (const path of paths) {
      const response = await fetch('/little-racing-v2/' + path);
      if (!response.ok) throw new Error(path + ': HTTP ' + response.status);
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      if (!(buffer.duration > 0)) throw new Error(path + ': empty audio');
      results.push({ path, status: response.status, duration: buffer.duration });
    }
    await ctx.close(); return results;
  }, audioPaths);
  assert.equal(audio.filter(a => /\/c1-/.test(a.path)).length, 5);
  assert.equal(audio.filter(a => /\/c2-/.test(a.path)).length, 21);
  assert.equal(audio.length, 29);
  fs.writeFileSync('live-results/audio-decode.json', JSON.stringify(audio, null, 2));
  console.log('PASS: all 29 live MP3 resources fetched and decoded, including 5+21 chapter voices');

  await page.click('#storyBtn');
  await page.waitForFunction(() => !document.querySelector('#story').classList.contains('hidden') && document.querySelector('#storyText').textContent.length > 0, { timeout: 180000 });
  assert((await page.$eval('#storyChapter', e => e.textContent)).includes('第一章'));
  console.log('PASS: live first-chapter entry renders story text');
  await page.screenshot({ path: 'live-results/production-chapter1.png' });

  await page.goto(base + '?course=beach&chapter=chapter-02&release=fc50907f', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !document.querySelector('#story')?.classList.contains('hidden') && document.querySelector('#storyChapter')?.textContent.includes('第二章') && document.querySelector('#storyText')?.textContent.length > 0, { timeout: 300000 });
  console.log('PASS: live second-chapter entry renders story text');
  await page.screenshot({ path: 'live-results/production-chapter2.png' });
  const saved = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
  for (const key of Object.keys(seed).filter(k => !k.endsWith('.meta') && !k.endsWith('.current'))) assert.deepEqual(JSON.parse(saved[key]), seed[key], key);
  assert.equal(JSON.parse(saved['lrv2.garage.current']).vehicle, 'moto');
  assert(!Object.keys(saved).some(k => k.includes('lrv2test') || k.includes('littleRacingV2test')));
  assert.deepEqual(errors, []);
  console.log('PASS: live legacy save retains coins, owned vehicles, selected moto, rewards, transactions, claims and both done chapters; no runtime errors or site 404s');
  fs.writeFileSync('live-results/result.json', JSON.stringify({ ok: true, audioFiles: audio.length, viewports: ['1280x720', '844x390'], preservedSave: true, runtimeErrors: errors }, null, 2));
} finally {
  await browser.close();
}
