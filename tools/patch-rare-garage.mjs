#!/usr/bin/env node
/**
 * tools/patch-rare-garage.mjs —— AE86「秋名疾影」车库陈列增强（严格 AE86 作用域）
 *
 * 三处补丁，每一处都必须精确命中一次，否则 fail-closed 退出：
 *   A. stage-*.js 构造函数  → 额外构建一个「摄影棚环境」场景（供 PMREM 使用）
 *   B. stage-*.js show()    → 稀有车专属：更慢的转台、更近的机位、更亮的灯、环境贴图
 *   C. 主包 GarageStage 创建处 → 用 PMREMGenerator 把 A 的环境烘成 envMap
 *
 * 其它车（雷霆 / 海龟 / 摩托 / 红车 / 生日车）走原分支，参数一字未改。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);

const stagePath = args.stage
  ? path.resolve(args.stage)
  : path.join(repoRoot, 'docs', 'assets', 'stage-DtUJQvYs.js');
const mainPath = args.main
  ? path.resolve(args.main)
  : path.join(repoRoot, 'docs', 'assets', 'index-Cam3Integrated.js');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const ENV_METHODS = `
  _buildEnvScene(){
    const sc=new C();
    const add=(w,h,col,power,pos,rot)=>{
      const m=new p(new n(w,h),new x({color:new S(col).multiplyScalar(power),side:2}));
      m.position.set(pos[0],pos[1],pos[2]);
      if(rot)m.rotation.set(rot[0],rot[1],rot[2]);
      sc.add(m);return m;
    };
    add(60,60,0x0a0f16,1,[0,-9,0],[-Math.PI/2,0,0]);
    add(60,24,0x0d141d,1,[0,10,0],[Math.PI/2,0,0]);
    add(60,30,0x101822,1,[0,1,-18],[0,0,0]);
    add(9.5,9.5,0xfff4e2,2.9,[0,8.2,2.8],[Math.PI/2,0,0]);
    add(2.8,9,0xdfeaff,2.3,[-6.8,3.6,1.8],[0,Math.PI/2,0]);
    add(2.4,8,0xffe4bd,2.0,[6.6,3.2,2.4],[0,-Math.PI/2,0]);
    add(8,1.3,0xc4d8ff,2.6,[0,2.8,-6.8],[0,0,0]);
    return sc;
  }
  _applyRareEnv(){
    if(!this._rare||!this._envTex)return;
    let n=0;
    this._car&&this._car.traverse(o=>{
      if(!o.isMesh)return;
      const mats=Array.isArray(o.material)?o.material:[o.material];
      for(const m of mats){
        if(!m||!(m.isMeshStandardMaterial||m.isMeshPhysicalMaterial))continue;
        m.envMap=this._envTex;
        m.envMapIntensity=1.45;
        m.needsUpdate=true;
        n++;
      }
    });
    this._envApplied=n;
  }
`;

const REPLACEMENTS = [
  {
    file: stagePath,
    name: 'stage-constructor-env-scene',
    find: 'this._buildRoom(),this._buildStage(),this._buildLights(),this.fit()}',
    make: 'this._buildRoom(),this._buildStage(),this._buildLights(),this.fit(),this.envScene=this._buildEnvScene()}',
  },
  {
    file: stagePath,
    name: 'stage-rare-show-tuning',
    find:
      'this.spin=e===`turtle`?.26:.22,this._distMul=e===`frag_rare`?.78:1,' +
      'this._setLightScale(e===`frag_common`||e===`frag_rare`?.62:1),',
    make:
      'this._rare=e===`frag_rare`,' +
      'this.spin=this._rare?.13:(e===`turtle`?.26:.22),' +
      'this._distMul=this._rare?.72:1,' +
      'this._setLightScale(this._rare?1.06:(e===`frag_common`?.62:1)),' +
      'this._camLift=this._rare?.44:.26,' +
      'this._rare&&(this.turntable.rotation.y=-.62),this._applyRareEnv(),',
  },
  {
    file: stagePath,
    name: 'stage-camera-lift',
    find: 'let u=l/Math.sqrt(1.338);this._camHome=new g(u*.52,n*.46+u*.26,u)',
    make:
      'let u=l/Math.sqrt(1.338);this._camHome=new g(u*(this._rare?.44:.52),' +
      'n*.46+u*(this._camLift||.26),u)',
  },
  {
    file: stagePath,
    name: 'stage-env-methods',
    find: 'dispose(){this.carRoot.clear()',
    make: ENV_METHODS + 'dispose(){this.carRoot.clear()',
  },
  {
    file: mainPath,
    name: 'main-pmrem-env',
    find: 'GarageStage(sp);return im=e,e}',
    make:
      'GarageStage(sp);' +
      'try{const _pm=new un(sp.renderer);e._envTex=_pm.fromScene(e.envScene,0,.1,200).texture;_pm.dispose();}' +
      'catch(_err){console.warn(`[garage] AE86 环境贴图烘焙失败：`,_err&&_err.message||_err);}' +
      'return im=e,e}',
  },
];

const report = [];
const cache = new Map();
for (const r of REPLACEMENTS) {
  if (!cache.has(r.file)) cache.set(r.file, fs.readFileSync(r.file, 'utf8'));
  const src = cache.get(r.file);
  const hits = src.split(r.find).length - 1;
  if (hits !== 1) {
    console.error(`[patch] ${r.name}: expected exactly 1 match, found ${hits} in ${r.file}`);
    process.exit(1);
  }
  cache.set(r.file, src.replace(r.find, r.make));
  report.push({ step: r.name, file: path.relative(repoRoot, r.file) });
}

for (const [file, content] of cache) {
  fs.writeFileSync(file, content, 'utf8');
  report.push({ file: path.relative(repoRoot, file), sha256: sha(fs.readFileSync(file)) });
}

console.log(JSON.stringify({ ok: true, patched: report }, null, 2));
