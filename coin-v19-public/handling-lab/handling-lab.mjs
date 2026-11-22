import * as T from './assets/vendor/three.module.js';
import {n as stockModel} from './assets/model-MAgXfVWW.js';
import {KartPhysics,stockCar} from './assets/handling-engine.mjs';
import {createRiggedKart,loadRiggedKart} from './assets/rigged-karts.mjs';
import {handling,groundTypes,damp,clamp} from './assets/vehicle-feel.mjs';
import {SignatureAudio,playSignature} from './assets/vehicle-audio.mjs';
import {updateSignatureVisual} from './assets/vehicle-effects.mjs';
import {zones,length,width,center,elevation,surfaceColor,makeTrack} from './handling-terrain.mjs';
import {benchmark,vehicles} from './handling-benchmark.mjs';

const $=id=>document.getElementById(id);
const canvas=$('scene'), scene=new T.Scene(), camera=new T.PerspectiveCamera(61,1,.1,220);
scene.background=new T.Color(0x9abfdf);scene.fog=new T.Fog(0x9abfdf,75,195);
let renderer;
try{renderer=new T.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});}
catch(error){$('status').textContent='无法启动 3D，请确保 Safari 已启用 WebGL。';throw error;}
const lite=matchMedia('(pointer:coarse)').matches || navigator.hardwareConcurrency<=4;
renderer.setPixelRatio(Math.min(devicePixelRatio,lite?1:1.5));
renderer.outputColorSpace=T.SRGBColorSpace;
scene.add(new T.HemisphereLight(0xf3faff,0x71614b,2.75));
const sun=new T.DirectionalLight(0xffe8c8,2.3);sun.position.set(-16,30,12);scene.add(sun);
const track=makeTrack();
const floor=new T.Mesh(new T.PlaneGeometry(260,length+130),new T.MeshStandardMaterial({color:0x354f47,roughness:.96}));
floor.rotation.x=-Math.PI/2;floor.position.set(0,-.58,length/2);scene.add(floor);

function ribbon(left,right,color,zStart=-12,zEnd=length) {
  const positions=[], colors=[], indices=[], colorValue=new T.Color();
  const segments=Math.ceil((zEnd-zStart)*4), across=7;
  for(let iz=0;iz<=segments;iz++){
    const z=zStart+(zEnd-zStart)*iz/segments, c=center(z);
    for(let i=0;i<=across;i++){
      const x=c+left+(right-left)*i/across;
      positions.push(x,elevation(x,z)+.009,z);
      colorValue.setHex(color(z)).multiplyScalar(.95+.08*Math.sin(z*2.61+i*2.2));
      colors.push(colorValue.r,colorValue.g,colorValue.b);
    }
  }
  for(let j=0;j<segments;j++)for(let i=0;i<across;i++){
    const a=j*(across+1)+i, b=a+across+1;
    indices.push(a,b,a+1,b,b+1,a+1);
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  scene.add(new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:.94})));
}
ribbon(-width,width,surfaceColor);
ribbon(-11.12,-width,()=>0x707c83);ribbon(width,11.12,()=>0x707c83);

const box=new T.BoxGeometry(1,1,1), white=new T.MeshStandardMaterial({color:0xf3e1b8});
const dark=new T.MeshStandardMaterial({color:0x273e53});
const flags=new T.InstancedMesh(box,white,114), rails=new T.InstancedMesh(box,dark,106);
const pose=new T.Object3D();
function instance(mesh,index,x,y,z,sx,sy,sz){
  pose.position.set(x,y,z);pose.scale.set(sx,sy,sz);pose.updateMatrix();mesh.setMatrixAt(index,pose.matrix);
}
for(let i=0;i<57;i++){
  const z=i*9-5;
  for(let side=0;side<2;side++){
    const x=center(z)+(side?width+.16:-width-.16);
    instance(flags,i*2+side,x,elevation(x,z)+.18,z,.19,.36,1.18);
  }
}
for(let i=0;i<53;i++){
  const z=i*10-5;
  for(let side=0;side<2;side++){
    const x=center(z)+(side?11.12:-11.12);
    instance(rails,i*2+side,x,elevation(x,z)+.27,z,.25,.5,2.1);
  }
}
scene.add(flags,rails);

function makeParticles(limit){
  const pool=Array.from({length:limit},()=>({x:0,y:0,z:0,vx:0,vy:0,vz:0,r:0,life:0,total:0,color:new T.Color()}));
  const material=new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.74,depthWrite:false});
  const mesh=new T.InstancedMesh(new T.IcosahedronGeometry(.64,0),material,limit);
  mesh.count=0;mesh.frustumCulled=false;scene.add(mesh);
  let cursor=0;
  function spawn(x,y,z,vx,vy,vz,color,r,life){
    const p=pool[cursor++%limit];
    p.x=x;p.y=y;p.z=z;p.vx=vx;p.vy=vy;p.vz=vz;p.r=r;p.life=life;p.total=life;p.color.copy(color);
  }
  return {alpha:{spawn},additive:{spawn},reset(){for(const p of pool)p.life=0;mesh.count=0;},update(dt){
    let count=0;
    for(const p of pool){
      if((p.life-=dt)<=0)continue;
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vy-=6*dt;
      const f=p.r*Math.min(1,p.life/p.total*1.5);
      instance(mesh,count,p.x,p.y,p.z,f,f,f*1.6);
      mesh.setColorAt(count++,p.color);
    }
    mesh.count=count;mesh.instanceMatrix.needsUpdate=true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  }};
}
const particles=makeParticles(lite?90:180);
const audio=new SignatureAudio();
let ctx, bus, muted=false, player, id='red', zone='straight', generation=0, boostCooldown=0;
const trialChaseScale=vehicle=>vehicle==='red'?1:.86;
const held=new Set(), keys={ArrowUp:'gas',KeyW:'gas',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowDown:'brake',KeyS:'brake',ShiftLeft:'drift'};
function unlock(){
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio||muted)return;
  if(!ctx){ctx=new Audio();bus=ctx.createGain();bus.gain.value=.75;bus.connect(ctx.destination);}
  if(ctx.state==='suspended')void ctx.resume().catch(()=>{});
}
function reset(next=zone){
  zone=next;
  if(!player)return;
  held.clear();particles.reset();audio.stop();
  const z=zones[zone].z, p=new T.Vector3(center(z),0,z), sample=track.surfaceAt(p);
  p.y=sample.y;
  player.placeAt(p,track.getTangent(sample.loc.index));
  player.speed=player.lateral=player.vy=player.boostTime=player.boostPower=player.airTime=player._steerSmooth=0;
  player.groundY=sample.y;player.grounded=true;player.offroad=false;player.trackIndex=sample.loc.index;
  player.drifting=false;player.driftTier=0;player.driftCharge=0;player.surfaceGrip=1;player.surfaceLateral=1;
  if(player.signature){
    player.signature.terrain=zones[zone].surface;
    player.signature.effectBoost=player.signature.boostFlash=player.signature.visualDrive=0;
    player.model.signatureFx?.clearPounce();
  }
  boostCooldown=0;
  const scale=trialChaseScale(id);
  camera.position.set(p.x,p.y+4.6*scale,p.z-8.2*scale);camera.lookAt(p.x,1.35+p.y,p.z+4);
  for(const b of document.querySelectorAll('[data-zone]'))b.setAttribute('aria-pressed',String(b.dataset.zone===zone));
}
async function select(next){
  const current=++generation;
  $('status').textContent='载入车辆…';
  try {
    if(next!=='red')await loadRiggedKart(next);
    if(current!==generation)return;
    const model=next==='red'?stockModel(stockCar,1):createRiggedKart(next);
    const old=player;
    player=new KartPhysics(scene,stockCar,{model:next==='red'?{...model}:model,mode:'normal',isPlayer:true});
    // All stock model instances use their generated default name.
    old?.dispose();id=next;reset();
    if(!muted&&next!=='red')playSignature(ctx,bus,next,'garage');
    for(const b of document.querySelectorAll('[data-car]'))b.setAttribute('aria-pressed',String(b.dataset.car===id));
    $('status').textContent='';
  }catch(error){if(current===generation)$('status').textContent='模型载入失败，请再试一次。';console.error(error);}
}
function boost(){
  if(!player||boostCooldown>0)return;
  player.applyBoost(12,1.6);boostCooldown=3.4;
}
document.addEventListener('pointerdown',unlock,{passive:true,capture:true});
document.querySelectorAll('[data-car]').forEach(btn=>btn.onclick=()=>select(btn.dataset.car));
document.querySelectorAll('[data-zone]').forEach(btn=>btn.onclick=()=>reset(btn.dataset.zone));
document.querySelectorAll('[data-hold]').forEach(btn=>{
  const name=btn.dataset.hold;
  btn.onpointerdown=e=>{e.preventDefault();held.add(name);btn.setPointerCapture(e.pointerId);btn.classList.add('on');};
  btn.onpointerup=btn.onpointercancel=btn.onlostpointercapture=()=>{held.delete(name);btn.classList.remove('on');};
});
$('boost').onclick=boost;
$('mute').onclick=()=>{
  muted=!muted;
  $('mute').textContent=muted?'开启声音':'静音';
  $('mute').setAttribute('aria-pressed',String(muted));
  if(muted)audio.stop();else unlock();
};
addEventListener('keydown',e=>{
  if(e.repeat)return;
  if(keys[e.code]){held.add(keys[e.code]);e.preventDefault();unlock();}
  if(e.code==='Space'){e.preventDefault();unlock();boost();}
});
addEventListener('keyup',e=>held.delete(keys[e.code]));
const pause=()=>{held.clear();audio.stop();};
addEventListener('blur',pause);addEventListener('pagehide',pause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
function size(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/Math.max(1,innerHeight);camera.updateProjectionMatrix();}
addEventListener('resize',size);size();

const measureLabels={acceleration:'0–60 km/h（秒）',top:'直线极速（km/h）',turn:'连续反打累计转角（度）',
  grassLoss:'草地速度损失（%）',mudLoss:'泥地速度损失（%）',peak:'氮气峰值（km/h）',
  duration:'氮气时长（秒）',impact:'受击保留速度（%）',spin:'受击失控（秒）',airborne:'坡道滞空（秒）'};
$('compare').onclick=()=>{
  const rows=benchmark();
  $('measurements').innerHTML=`<table><thead><tr><th>项目</th>${rows.map(row=>`<th>${row.name}</th>`).join('')}</tr></thead>
    <tbody>${Object.entries(measureLabels).map(([key,label])=>`<tr><td>${label}</td>${rows.map(row=>`<td>${row[key]}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  $('results').showModal();
};
let last=performance.now(), acc=0, wasDrifting=false;
const desired=new T.Vector3(), target=new T.Vector3(), look=new T.Vector3();
const step=lite?1/60:1/120;
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min(.06,(now-last)/1000);last=now;
  if(player&&!document.hidden){
    acc+=dt;
    while(acc>=step){
      const drift=held.has('drift'), input={gas:held.has('gas'),brake:held.has('brake'),steer:Number(held.has('right'))-Number(held.has('left'))};
      player.update(step,{throttle:+input.gas,brake:+input.brake,steer:input.steer,drift,driftPressed:drift&&!wasDrifting},track);
      wasDrifting=drift;boostCooldown=Math.max(0,boostCooldown-step);acc-=step;
    }
    if(player.position.z>length||player.position.z<-12||player.position.y<-5) reset();
    player.syncVisual(dt);updateSignatureVisual(player,dt,particles,lite?1:2);particles.update(dt);
    if(!muted&&ctx?.state==='running'&&player.signature)audio.update(ctx,bus,player.signature,player.speed);
    const p=player.position,yaw=player.visualYaw,fx=player.signature?.effectBoost||0;
    const distance=(id==='monster-truck'?8.4:7.6)+fx*(id==='tiger-kart'?1.7:1.0), height=id==='monster-truck'?4.9:4.6;
    const scale=trialChaseScale(id), follow=distance*scale;
    desired.set(p.x-Math.sin(yaw)*follow,p.y+height*scale,p.z-Math.cos(yaw)*follow);
    target.set(p.x+Math.sin(yaw)*4,p.y+1.23,p.z+Math.cos(yaw)*4);
    camera.position.lerp(desired,1-Math.exp(-6*dt));look.lerp(target,1-Math.exp(-8*dt));camera.lookAt(look);
    const surface=track.groundTypeAt(track.surfaceAt(p).loc);
    $('speed').textContent=`${Math.round(Math.abs(player.speed)*3.6)} km/h`;
    $('ground').textContent=groundTypes[surface].name;
    $('skill').textContent=fx>.2?handling[id]?.name||'氮气加速':'';
    $('boost').disabled=boostCooldown>0;
  }
  renderer.render(scene,camera);
}
void select('red');requestAnimationFrame(frame);
