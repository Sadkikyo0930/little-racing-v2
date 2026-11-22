import * as T from './three/three.module.js';
import {GLTFLoader} from './three/GLTFLoader.js';

const canvas=document.querySelector('canvas');
const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.outputColorSpace=T.SRGBColorSpace;
renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.13;
const scene=new T.Scene();scene.background=new T.Color(0x142236);
const camera=new T.PerspectiveCamera(35,1,.1,60);
const stage=new T.Mesh(new T.CircleGeometry(3.5,64),new T.MeshStandardMaterial({color:0x273c53,roughness:.88}));
stage.rotation.x=-Math.PI/2;stage.position.y=-.025;scene.add(stage);
const grid=new T.GridHelper(7,14,0x5e7896,0x384e67);grid.position.y=-.012;scene.add(grid);
scene.add(new T.HemisphereLight(0xd6eaff,0x66563f,2.4));
for(const [color,intensity,position] of [
  [0xffd997,3.4,[4,6,2]],[0x77caff,2.4,[-5,4,-3]],[0xffb660,1.2,[0,3,-5]],
]){
  const light=new T.DirectionalLight(color,intensity);light.position.fromArray(position);scene.add(light);
}
let yaw=1.37,pitch=.20,distance=6.9,drag=null;
const aim=new T.Vector3(0,1.12,-.15);
function cameraPose(){
  camera.position.set(Math.sin(yaw)*distance*Math.cos(pitch),aim.y+Math.sin(pitch)*distance,Math.cos(yaw)*distance*Math.cos(pitch));
  camera.lookAt(aim);
}
function resize(){
  const width=Math.min(canvas.clientWidth,1100),height=Math.round(width*.50);
  renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
}
cameraPose();resize();addEventListener('resize',resize);
canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{
  if(!drag)return;
  yaw-=.013*(e.clientX-drag[0]);pitch=Math.max(-.12,Math.min(.78,pitch+.008*(e.clientY-drag[1])));
  drag=[e.clientX,e.clientY];cameraPose();
});
canvas.addEventListener('pointerup',()=>{drag=null;});
canvas.addEventListener('pointercancel',()=>{drag=null;});
const $=id=>document.getElementById(id);
const loader=new GLTFLoader();
try{
  const data=await loader.loadAsync('./spirit-tiger.glb');
  const clip=data.animations.find(a=>a.name==='SpiritPounce')??data.animations[0];
  if(!clip)throw Error('Missing skeletal animation');
  scene.add(data.scene);
  const mixer=new T.AnimationMixer(data.scene),action=mixer.clipAction(clip);
  action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;
  let current=0,last=performance.now(),playing=!matchMedia('(prefers-reduced-motion: reduce)').matches,rate=1;
  const slider=$('time');slider.max=clip.duration;
  const bones=new Map();
  data.scene.traverse(n=>{if(n.isBone)bones.set(n.name,n);});
  function pose(time){
    current=Math.max(0,Math.min(clip.duration,time));action.time=current;mixer.update(0);
    slider.value=current;
    $('status').textContent=current.toFixed(2)+' 秒';
  }
  function toggle(){
    $('freeze').textContent=playing?'暂停':'继续';
    $('freeze').setAttribute('aria-pressed',String(!playing));
  }
  $('replay').onclick=()=>{pose(0);playing=true;toggle();};
  $('freeze').onclick=()=>{if(!playing&&current>=clip.duration)pose(0);playing=!playing;toggle();};
  $('slow').onclick=()=>{rate=rate===1?.35:1;$('slow').setAttribute('aria-pressed',String(rate<1));};
  $('angle').onclick=()=>{yaw=yaw>1?.66:1.51;pitch=.23;cameraPose();};
  slider.oninput=()=>{playing=false;toggle();pose(Number(slider.value));};
  window.inspectTiger=(t,angle=1.37)=>{
    playing=false;toggle();yaw=angle;cameraPose();pose(t);
    data.scene.updateMatrixWorld(true);renderer.render(scene,camera);
    const transformed={};
    for(const [name,bone] of bones)transformed[name]=bone.getWorldPosition(new T.Vector3()).toArray();
    return {bones:bones.size,duration:clip.duration,tracks:clip.tracks.length,pose:transformed};
  };
  toggle();
  function animate(now){
    if(playing){pose(current+Math.min(.10,(now-last)/1000)*rate);if(current>=clip.duration){playing=false;toggle();}}
    last=now;renderer.render(scene,camera);requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}catch(error){$('status').textContent='金虎加载失败';window.tigerPreviewError=String(error);throw error;}
