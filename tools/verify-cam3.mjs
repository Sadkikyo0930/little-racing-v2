import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root = process.argv[2] || 'docs';
const manifest = JSON.parse(readFileSync(`${root}/production-sha256.json`));
assert.equal(Object.keys(manifest).length,121);
for (const [path, hash] of Object.entries(manifest)) {
  assert.equal(createHash('sha256').update(readFileSync(`${root}/${path}`)).digest('hex'),hash,path);
}
const html=readFileSync(`${root}/index.html`,'utf8');
assert.match(html,/race-guard\.mjs.*await ready.*family-preview\.mjs.*await prepareFamilyPreview\(\).*await import\("\.\/assets\/index-/s);
for (const dir of ['assets','r5','icons']) assert(existsSync(`${root}/${dir}`));
const voices=readdirSync(`${root}/assets`);
assert.equal(voices.filter(p=>/^c1-.*mp3$/.test(p)).length,5);
assert.equal(voices.filter(p=>/^c2-.*mp3$/.test(p)).length,21);
assert.equal(readdirSync(`${root}/assets/birthday`).filter(p=>/^birthday-voice-.*mp3$/.test(p)).length,5);
assert(existsSync(`${root}/assets/frag-car-common-01-D7R-vU1J.glb`));
assert(existsSync(`${root}/assets/karts/birthday-star-6.glb`));
assert.match(readFileSync(`${root}/gate.html`,'utf8'),/parent-backup-export/);
console.log('PASS: 121 SHA256 hashes, startup order, Thunder GLB, birthday GLB, 31 voices, backup entry');
