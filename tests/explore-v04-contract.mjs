/* 小小赛车 V2 · 自由探索地图 V0.4 静态契约
   运行: node --experimental-vm-modules tests/explore-v04-contract.mjs */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';

const candidates = [
  new URL('../docs/explore-v04.html', import.meta.url),
  new URL('../explore-v04.html', import.meta.url)
];
const htmlPath = candidates.find(p => fs.existsSync(p));
assert(htmlPath, 'explore-v04.html missing');
const html = fs.readFileSync(htmlPath, 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert(script, 'V0.4 module code missing');
new vm.SourceTextModule(script.replace(/^import \* as T from .*?;$/m, ''));

let n = 0;
const t = (label, cond) => { assert(cond, label); console.log('PASS ' + label); n++; };
const roadsSrc = script.match(/const roads=(\[[\s\S]*?\]);/)?.[1];
assert(roadsSrc, 'road layout declared');
const roads = vm.runInNewContext(roadsSrc);
const ROAD_SHA_V03 = 'f4333d99a1151a9e20a1ce5373c9e59db2a8bbf4ee64d42d86c498ee5bfcde0b';

/* ---- 1. 路线结构零改动 ---- */
t('3km × 3km world bounds unchanged', script.includes('worldSize=3000,HALF=1500'));
t('road layout is byte-identical to V0.3', crypto.createHash('sha256').update(roadsSrc).digest('hex') === ROAD_SHA_V03);
t('all 10 districts preserved', roads.length === 10);
t('road paths keep 3D elevation', roads.every(r => r.pts.every(p => p.length === 3)));
t('road paths stay in bounds', roads.every(r => r.pts.every(p => Math.abs(p[0]) <= 1450 && Math.abs(p[1]) <= 1450)));
t('mountain ascends to 320 m and descends from 320 m',
  roads.find(r => r.name === '盘山公路·上山')?.pts.at(-1)?.[2] === 320 &&
  roads.find(r => r.name === '盘山公路·下山')?.pts[0]?.[2] === 320);
t('lake gravel route preserved', roads.some(r => r.kind === 'gravel' && r.name.includes('湖畔')));
t('catmull-rom curve and elevation sampling unchanged',
  script.includes("'centripetal',.4") && script.includes('p.y+DECK_LIFT'));

/* ---- 2. 隧道结构修复 ---- */
t('two tunnels at the original road indices',
  script.includes("carveTunnel") === false &&
  script.includes("road:'盘山公路·上山',a:7.08,b:7.78") &&
  script.includes("road:'乡村支线',a:3.24,b:3.77"));
t('tunnel axis shares the road curve and aligned sample boundary',
  script.includes('iA=Math.round(td.a/seg*m.n)') && script.includes('iB=Math.round(td.b/seg*m.n)'));
t('inner and outer shells have real thickness (no coplanar surfaces)',
  script.includes('SHELL=3.2') && script.includes('function profile(expand)') &&
  script.includes('profIn=profile(false),profOut=profile(true)'));
t('portal end faces close the shell volume',
  script.includes("ringFace(ax[0],profIn,profOut") && script.includes("ringFace(ax[ax.length-1],profIn,profOut"));
t('roadway mesh is cut out inside tunnels',
  script.includes('const skip=!!tun&&i>=tun.iA&&i<tun.iB') && script.includes('AUDIT.deckGaps++'));
t('separate tunnel deck / shoulders / edge lines sit at distinct heights',
  script.includes('ribbon(deck,') && script.includes('a.y0+.26') && script.includes('a.y0+.075'));
t('all mountain slopes are clipped against the tunnel clearance box',
  script.includes('const nearVol=k=>tunnelVolumeNear') && script.includes('if(ids.some(nearVol))continue'));
t('portal rocks and roof rock cap embed the tunnel in the mountain',
  script.includes('portalRocks.push') && script.includes('capRocks.push'));
t('tunnel lighting, ribs, edge lines and reflectors',
  script.includes('tunnelLampBoxes') && script.includes('ribMat') && script.includes('tunnelReflectors'));
t('tunnel light/dark transition', script.includes('function updateAtmosphere(b)') && script.includes("style.opacity=(b*.42)"));

/* ---- 3. 碰撞与相机 ---- */
t('hard lateral collision keeps the car inside the bore',
  script.includes('function clampIntoTunnel') && script.includes('const lim=ti.W/2-3.1'));
t('airborne disabled and roof height clamped inside tunnels',
  script.includes('if(inTunnelNow){state.airborne=false') && script.includes('ti.y0+ti.top-5.4'));
t('camera is clamped both at target and after interpolation',
  script.includes('function clampCamera(pos)') && script.includes('clampCamera(camera.position)'));
t('camera follows the tunnel centreline at bends',
  script.includes('pos.lerp(ap,b*.92)'));
t('soft guardrail pushes back instead of freezing the car',
  script.includes('nx=next.px+(nx-next.px)*k'));

/* ---- 4. 道路障碍净空 ---- */
t('unified clearance with bend / mountain / gravel margins',
  script.includes('function clearance(x,z,y,r,margin=3)') && script.includes('c.bend*7'));
t('every static prop is registered through place()/clearance()',
  script.includes('function place(x,z,y,r,kind,build,margin=3)') &&
  ['house', 'tree', 'lamp', 'pebble', 'reed', 'shore-tree', 'windmill', 'fountain', 'viewpoint']
    .every(k => script.includes("'" + k + "'")));
t('props cannot intrude into the tunnel bore or lake',
  script.includes('function intrudesTunnel') && script.includes('inWater=Math.hypot'));
t('runtime audit exposes violations for automated acceptance',
  script.includes('window.__V04_AUDIT__') && script.includes('violations:AUDIT.obstacles.filter'));

/* ---- 5. 驾驶手感保持不变 ---- */
t('gravel keeps the four physical crests',
  script.includes('for(const center of [150,350,580,790])') && script.includes('p.y+=4.2'));
t('gravel gains fine irregular undulation',
  script.includes('.42*Math.sin(meters*.071)'));
t('launch is locked to crest positions by arc length',
  script.includes('const crests=[150,350,580,790]') && script.includes('afterCrest'));
t('gravity and landing compression preserved',
  script.includes('state.verticalVelocity-=26*dt') && script.includes('state.landingCompression=1.1'));
t('steering and chassis bump preserved',
  script.includes('state.heading-=state.steer*dt') && script.includes('chassis.position.y=state.shake'));
t('all four touch controls present',
  ['left', 'right', 'gas', 'brake'].every(k => html.includes('data-key="' + k + '"')));
t('preview never reads or writes formal saves',
  !/(localStorage|r5_racing_saves|r5-gateway|familySync|window\.R5|coin_balance)/.test(script));

/* ---- 6. 美化元素 ---- */
t('mountain guardrails, stone retaining walls and slope vegetation',
  script.includes('railPosts') && script.includes('wallBlocks') && script.includes('mtnPines'));
t('viewpoints and bend warning signs',
  script.includes('viewpoint(505,505') && script.includes("roadSign(760,190"));
t('lake pebbles, reeds, shore trees and boardwalk',
  script.includes('pebbles.push') && script.includes('reeds.push') && script.includes('shoreTrees.push') && script.includes('planks.push'));
t('gravel road uses speckled texture and vertex tint',
  script.includes('speckleTex(') && script.includes('vertexColors:true'));
t('villages are consolidated and use one house style',
  script.includes('const villages=[') && script.includes('function house(x,z,gy,wall,roof)'));
t('exit scenery creates a visual reveal',
  script.includes('exitFlowers.push') && script.includes('exitTrees.push'));

console.log('PASS ' + n + '/' + n + ' V0.4 contract checks');
