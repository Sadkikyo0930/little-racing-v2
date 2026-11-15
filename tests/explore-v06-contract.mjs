/* 小小赛车 V2 · 自由探索 V0.6 精品样板区静态契约
   运行: node --experimental-vm-modules tests/explore-v06-contract.mjs */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';

const candidates = [
  new URL('../docs/explore-v06.html', import.meta.url),
  new URL('../explore-v06.html', import.meta.url)
];
const htmlPath = candidates.find(p => fs.existsSync(p));
assert(htmlPath, 'explore-v06.html missing');
const html = fs.readFileSync(htmlPath, 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert(script, 'V0.6 module code missing');
new vm.SourceTextModule(script.replace(/^import \* as T from .*?;$/m, ''));

let n = 0;
const t = (label, cond) => { assert(cond, label); console.log('PASS ' + label); n++; };
const roadsSrc = script.match(/const roads=(\[[\s\S]*?\]);/)?.[1];
assert(roadsSrc, 'compact showcase road layout declared');
const roads = vm.runInNewContext(roadsSrc);

/* ---- 1. 独立预览页，不碰正式赛车主版本 ---- */
t('V0.6 is a standalone single-file module page', html.includes('<title>小小赛车 V2 · 自由探索 V0.6') && script.includes('three@0.160.1/build/three.module.js'));
t('no save-game / account / network writes', !/localStorage|sessionStorage|serviceWorker|indexedDB|fetch\(|XMLHttpRequest|\.postMessage/.test(script));
t('no modification of earlier version pages', !script.includes("explore-v05.html'") && !script.includes("index.html'"));
t('favicon inline to avoid 404', html.includes('rel="icon" href="data:,"'));
t('page keeps its own audit namespace', script.includes('window.__V06_AUDIT__') && script.includes('window.__V06_DEBUG__'));

/* ---- 2. 少而精：紧凑精品岛，四区都在出生点附近 ---- */
t('compact island instead of the 3 km x 3 km open world', script.includes('worldRadius:600') && !script.includes('worldSize=3000'));
t('exactly 7 short routes serving the four showcase zones', roads.length === 7);
t('all road points have 3D elevation', roads.every(r => r.pts.every(p => p.length === 3)));
t('all road points stay inside the compact island', roads.every(r => r.pts.every(p => Math.abs(p[0]) <= 400 && Math.abs(p[1]) <= 400)));
t('central ring road is the spawn hub', roads.some(r => r.name === '中央环线' && r.kind === 'asphalt'));
t('four showcase routes exist', ['湖畔精品公路', '盘山隧道公路', '小镇主街', '灯塔海崖路'].every(name => roads.some(r => r.name === name)));
t('gravel lake route and mountain tunnel route kept', roads.some(r => r.kind === 'gravel') && roads.some(r => r.kind === 'mountain'));
t('mountain road climbs above 90 m', roads.find(r => r.kind === 'mountain').pts.some(p => p[2] >= 90));

/* ---- 3. 四个精品样板区 ---- */
t('lake showcase: shader water, stone beach, reeds, boardwalk',
  script.includes('function lakeZone()') && script.includes("lake.name='lake-water'") &&
  script.includes('lake-pebble') && script.includes('lake-reed') && script.includes('lake-boardwalk'));
t('tunnel showcase: full rock mass around the portal',
  script.includes('hillRocks') && script.includes('portalRocks') && script.includes('capRocks') && script.includes('mountain-slope'));
t('town showcase: shopfronts, awnings, flower boxes, bunting, fountain, market stalls',
  script.includes('function house(') && script.includes('awnMat') && script.includes('town-house') &&
  script.includes('flags.push') && script.includes('town-square') && script.includes('market-stall'));
t('lighthouse showcase: striped tower, lantern room, plaza, balustrade, rotating beam, sea',
  script.includes('function lighthouseZone()') && script.includes('stripeTex') && script.includes('beaconBeam') &&
  script.includes('light-planter') && script.includes("sea.name='sea-water'"));
t('central spawn plaza is a crafted landmark', script.includes('function centralPlaza()') && script.includes('plaza-tree'));

/* ---- 4. 快速查看：A 传送 + B 紧凑布局 + C 预设机位 ---- */
t('four teleport buttons plus home', (html.match(/data-zone="/g) || []).length === 5);
t('four preset camera buttons', (html.match(/data-view="/g) || []).length === 4);
t('teleport and preset functions are wired', script.includes('function teleport(key)') && script.includes('function preset(key)') &&
  script.includes('[data-zone]') && script.includes('[data-view]'));
t('keyboard shortcuts 1/2/3/4/0', script.includes("'Digit1':'lake'") && script.includes("'Digit4':'light'") && script.includes("'Digit0':'home'"));
t('every zone has a preset camera', (script.match(/view:\[\[/g) || []).length === 5);
t('resume-drive button returns from free camera', script.includes('function resumeDrive()') && html.includes('id="drive"'));
t('quick-look capability declared in runtime audit', script.includes('quickLook:{teleport:true,compactLayout:true'));

/* ---- 5. 隧道与道路净空修复成果不回退 ---- */
t('tunnel axis shares the road curve with aligned sample boundaries',
  script.includes('iA=Math.round(td.a/seg*m.n)') && script.includes('iB=Math.round(td.b/seg*m.n)'));
t('closed inner/outer shells with 3.2 m real thickness',
  script.includes('SHELL=3.2') && script.includes('function profile(expand)') && script.includes('profIn=profile(false),profOut=profile(true)'));
t('portal end faces seal the shell volume',
  script.includes('ringFace(ax[0],profIn,profOut') && script.includes('ringFace(ax[ax.length-1],profIn,profOut'));
t('main road mesh cut out under tunnels', script.includes('const skip=!!tun&&i>=tun.iA&&i<tun.iB') && script.includes('AUDIT.deckGaps++'));
t('deck, edge lines and walkways sit at distinct heights',
  script.includes('ribbon(deck,') && script.includes('a.y0+.26') && script.includes('a.y0+.075'));
t('tunnel lights, ribs, edge lines and reflectors',
  script.includes('tunnelLampBoxes') && script.includes('ribMat') && script.includes('tunnelReflectors') && script.includes('reflectors.push'));
t('per-quad slope clipping against the tunnel clearance box (V0.4 fix)',
  script.includes('const nearVol=k=>tunnelVolumeNear') && script.includes('if(ids.some(nearVol))continue') &&
  script.includes('if(tunnelVolumeNear(cx,cz,cy))continue'));
t('car collision clamp keeps vehicle inside the tunnel', script.includes('function clampIntoTunnel(') && script.includes('lim=ti.W/2-3.1'));
t('camera target and interpolated position are both clamped', script.includes('function clampCamera(') && script.includes('clampCamera(camera.position)'));
t('in-tunnel camera pulls back along the tunnel axis', script.includes('state.x-dirx*20*sg'));
t('unified clearance for every static obstacle', script.includes('function clearance(x,z,y,r,margin=3)') && script.includes('function place('));
t('clearance adds bend / mountain / gravel margins and bans tunnel + water',
  script.includes("c.bend*7") && script.includes("c.kind==='mountain'?4:0") && script.includes('intrudesTunnel(x,y,z,r)') && script.includes('inWater(x,z,r)'));
t('runtime obstacle audit is exported', script.includes('violations:AUDIT.obstacles.filter') && script.includes('obstacles:AUDIT.obstacles'));

/* ---- 6. 驾驶功能完整保留 ---- */
t('original accel / brake / steering physics preserved', script.includes('state.speed=Math.max(-10,Math.min(30,state.speed+dt*(accel-brake)))') && script.includes('T.MathUtils.damp(state.steer'));
t('soft guardrail on mountain road (no hard pin)', script.includes("before.kind==='mountain'&&before.y>15") && script.includes('state.speed*=.72'));
t('gravel shoulder guidance keeps the car on the bump route', script.includes("before.kind==='gravel'&&before.distance<20"));
t('four main crests + per-arc-length launch trigger', script.includes('GRAVEL_CRESTS') && script.includes('onSlope=lakeBump') && script.includes('afterCrest&&state.wasClimbing'));
t('gravity, landing compression and suspension shake', script.includes('state.verticalVelocity-=26*dt') && script.includes('state.landingCompression=1.1') && script.includes('state.shake=T.MathUtils.damp'));
t('all four touch controls intact', ['left','right','gas','brake'].every(k => html.includes(`data-key="${k}"`)));
t('three camera modes and tunnel light transition', script.includes('state.cam=(state.cam+1)%3') && script.includes('function updateAtmosphere(') && script.includes('tunnelLights.forEach'));

/* ---- 7. 美术升级：不再靠方盒子 / 锥体堆地图 ---- */
t('gradient sky dome replaces flat background', script.includes('new T.ShaderMaterial({side:T.BackSide') && script.includes('uniform vec3 top,mid,low'));
t('animated shader water with gradient, ripples, fresnel-ish edge and foam',
  script.includes('uniform float uTime') && script.includes('uShallow') && script.includes('glint') && script.includes('foam'));
t('animated water uniform is driven by the render loop', script.includes('waterUniforms.uTime.value+=dt'));
t('soft shadows and ACES tone mapping', script.includes('renderer.shadowMap.enabled=true') && script.includes('T.ACESFilmicToneMapping'));
t('rounded multi-sphere canopy trees instead of plain cones', script.includes('new T.IcosahedronGeometry(1,2)') && script.includes('TREES.length*4'));
t('instanced pebbles, rocks and flowers for density without clutter', script.includes('InstancedMesh') && script.includes('setColorAt'));
t('layered mountain slope with vertex colours', script.includes('slopeCols=') && script.includes('vertexColors:true'));
t('white guardrails, stone retaining walls and warning signs', script.includes('guardAlong(') && script.includes('wallBlocks') && script.includes('function warnSign('));
t('lighthouse landmark has a glass lantern and rotating light', script.includes('MeshPhysicalMaterial') && script.includes('beaconBeam.rotation.y+=dt'));
t('references to the four AI-generated target images recorded', script.includes("references:['湖边公路目标图'") && script.includes("'灯塔广场目标图'"));

console.log(`\nV0.6 CONTRACT: ${n}/${n} PASS`);
console.log('ROAD_SHA256 ' + crypto.createHash('sha256').update(roadsSrc).digest('hex'));
