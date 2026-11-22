import * as Three from './three/three.module.js';

const canvas=document.querySelector('canvas'), info=document.querySelector('#info');
const renderer=new Three.WebGLRenderer({canvas,antialias:false});
renderer.setSize(480,270,false);
const target=new Three.WebGLRenderTarget(480,270,{depthBuffer:true});
const scene=new Three.Scene();
scene.background=new Three.Color(0x0b1726);
const camera=new Three.PerspectiveCamera(37,480/270,.1,70);
const panel=new Three.Mesh(new Three.BoxGeometry(1.7,1.25,.28),new Three.MeshBasicMaterial({color:0x195172}));
panel.position.set(.18,.50,.35);scene.add(panel);
scene.add(new Three.GridHelper(16,16,0x234860,0x20374b));
const display=new Three.Scene();
const fullScreen=new Three.Mesh(new Three.PlaneGeometry(2,2),new Three.MeshBasicMaterial({map:target.texture,depthTest:false}));
display.add(fullScreen);
const flatCamera=new Three.Camera();
let context,effect,handle,paused=false,released=false,running=true;
let frames=0;
function draw(){
  const t0=performance.now();
  renderer.setRenderTarget(target);
  renderer.render(scene,camera);
  const base=performance.now();
  if(context&&!released){
    if(running&&!paused) context.update(1);
    context.setProjectionMatrix(camera.projectionMatrix.elements);
    context.setCameraMatrix(camera.matrixWorldInverse.elements);
    context.draw();
    renderer.resetState();
  }
  const elapsed=performance.now()-base;
  renderer.setRenderTarget(null);
  renderer.render(display,flatCamera);
  frames++;
  return {total:performance.now()-t0,effectMs:elapsed};
}
function pixels(){
  const out=new Uint8Array(480*270*4);
  renderer.readRenderTargetPixels(target,0,0,480,270,out);
  return out;
}
function diff(a,b,x0=0,x1=480,y0=0,y1=270){
  let changed=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const i=(y*480+x)*4;
    if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>24)changed++;
  }
  return changed;
}
function play(){if(released)return;context.stopAll();handle=context.play(effect,0,.60,0);handle.setScale(.76,.76,.76);paused=false;}
function stop(){paused=false;context?.stopAll();context?.update(1);handle=null;}
function lock(flag){paused=flag;handle?.setPaused(flag);}
function release(){
  if(released)return;
  stop();context.releaseEffect(effect);effekseer.releaseContext(context);released=true;
  info.textContent='特效与运行时上下文已释放';
}
function orient(x){camera.position.set(x,3.6,9.1);camera.lookAt(0,.58,0);}
orient(1.2);
document.querySelector('#play').onclick=play;
document.querySelector('#pause').onclick=()=>lock(!paused);
document.querySelector('#stop').onclick=stop;
document.querySelector('#release').onclick=release;
effekseer.initRuntime('./effekseer.wasm',()=>{
  context=effekseer.createContext();context.init(renderer.getContext());
  context.setRestorationOfStatesFlag(true);
  const url=new URL(location.href).searchParams.has('custom')?'./v4-spark.efk':'./Resources/Simple_Ring_Shape1.efk';
  effect=context.loadEffect(url,1,()=>{
    info.textContent='同一 WebGL 上下文，含 3D 挡板与渲染目标';
    window.efkReady=true;
  },error=>{window.efkError=String(error);info.textContent=String(error);});
},error=>{window.efkError=String(error);info.textContent=String(error);});
function loop(){requestAnimationFrame(loop);if(!location.search.includes('test'))draw();}
loop();
window.probe=()=>{
  running=false;stop();draw();
  const baseline=pixels();
  play();running=true;
  const elapsed=[];
  for(let i=0;i<20;i++)elapsed.push(draw().effectMs);
  const active=pixels();
  lock(true);draw();const p=pixels();draw();const pauseDelta=diff(p,pixels());
  orient(-2.3);draw();const altered=pixels();
  stop();draw();const stopped=pixels();
  orient(1.2);draw();const returned=pixels();
  release();draw();const freed=pixels();
  return {activeDelta:diff(baseline,active),pauseDelta,cameraDelta:diff(p,altered),
    stoppedDelta:diff(returned,baseline),releasedDelta:diff(returned,freed),
    panelDelta:diff(baseline,active,229,266,113,149),noEffectOtherAngle:diff(altered,stopped),
    webgl2:renderer.capabilities.isWebGL2,elapsed,frames};
};

