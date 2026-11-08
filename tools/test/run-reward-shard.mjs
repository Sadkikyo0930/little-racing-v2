import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const original = new URL('./reward.mjs', import.meta.url);
const bytes = fs.readFileSync(original);
const gitHash = crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
assert.equal(gitHash, 'a1974467c84f65a8399b47154e35e736447244ea', 'Original reward assertions must remain byte-identical');
const source = bytes.toString('utf8');
const at = text => { const i = source.indexOf(text); assert(i >= 0, text); return i; };
const head = name => at("console.log('\\n=== " + name);
const sharedStart = at('const _RID =');
const importStart = at('function buildImportSave(extra)');
const cleanup = at("report.check('Z1 ");
const ranges = {
  'first-clear': [head('S1.'), head('S6.')],
  'write-failures': [head('S6.'), head('S6e.')],
  'migration': [head('S6e.'), sharedStart],
  'recovery-abc': [head('A.'), head('D.')],
  'recovery-def': [head('D.'), importStart],
  'imports': [importStart, head('S7.')],
  'legacy-vehicles': [head('S7.'), head('S10.')],
  'isolation-ui': [head('S10.'), cleanup],
};
const prelude = source.slice(0, head('S1.'));
const shared = source.slice(sharedStart, head('A.'));
const ending = source.slice(cleanup);
function generate(name) {
  assert(Object.hasOwn(ranges, name), name);
  const [start, end] = ranges[name];
  assert(start < end);
  const file = new URL('./reward-' + name + '-generated.mjs', import.meta.url);
  fs.writeFileSync(file, prelude + '\n' + shared + '\n' + source.slice(start, end) + '\n' + ending);
  return file;
}
if (process.argv.includes('--generate-only')) {
  for (const name of Object.keys(ranges)) generate(name);
  console.log('Generated all eight unchanged-assertion shards');
} else {
  const name = process.argv[2];
  const file = generate(name);
  const puppeteer = (await import('puppeteer-core')).default;
  const launch = puppeteer.launch.bind(puppeteer);
  puppeteer.launch = async (...args) => {
    const browser = await launch(...args);
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async (...pageArgs) => {
      const page = await newPage(...pageArgs);
      const goto = page.goto.bind(page);
      page.goto = (url, options) => {
        const target = new URL(url);
        target.searchParams.set('quality', 'low');
        return goto(target.href, options);
      };
      return page;
    };
    return browser;
  };
  process.argv = [process.argv[0], file.pathname, '--no-build'];
  console.log('Running original reward assertions:', name, 'with supported quality=low');
  await import(file.href);
}
