const $ = id => document.getElementById(id);
const stage = $('stage');
const beats = [
  [0, '一份藏着星光的礼物', '六颗星，守着一个生日秘密。', '嘘，星星给你带来了一份礼物。'],
  [6.7, '今天，你六岁啦！', '一颗、两颗……六颗星都为你亮起来。', '今天，你六岁啦！每一颗星，都在为你闪亮。'],
  [16.8, '六星闪耀 · 生日限定超跑', '蓝白金车身，从星光里驶出来。', '看，六星闪耀！这是专为六岁的你准备的生日赛车。'],
  [22.2, '准备出发，小小赛车手', '星形轮毂、金色尾翼，车尾还有一个闪亮的 6。', '看那星形轮毂，还有车尾闪亮的六。小小赛车手，准备出发！'],
  [31, '六岁生日快乐！', '愿你一路勇敢、一路开心。六岁的星光，永久珍藏。', '六岁生日快乐！愿你每一次出发，都勇敢，都开心。']
];
const stars = [[26,32],[36,18],[49,13],[63,18],[73,32],[50,60]].map(([x,y],i)=>{
  const el=document.createElement('i');el.textContent='✦';
  el.style.cssText=`left:${x}%;top:${y}%;animation-delay:${i*-.3}s`;
  $('stars').append(el);return el;
});
let frame, scene=-1, live3d;
function safely(fn) { try { fn(); } catch (error) { console.warn(error); } }
const soundtrack = new Audio(new URL('./birthday-mix.mp3', import.meta.url));
soundtrack.preload = 'auto';
let playback = 0;
function stopSound() {
  soundtrack.pause();
  soundtrack.currentTime = 0;
}
function particles(){
  for(let i=0;i<30;i++){
    const p=document.createElement('span');p.className='confetti';p.textContent=i%3?'✦':'★';
    const a=i/30*Math.PI*2;
    p.style.cssText=`left:50%;top:46%;--x:${Math.cos(a)*(17+i%6*3)}vw;--y:${Math.sin(a)*(19+i%5*4)}vh`;
    stage.append(p);p.addEventListener('animationend',()=>p.remove(),{once:true});
  }
}
function setScene(i) {
  scene=i;stage.dataset.scene=i;
  const [,title,caption]=beats[i];$('title').textContent=title;$('caption').textContent=caption;
  $('gift').classList.toggle('open',i>=2);$('gift').classList.toggle('vanish',i>=3);
  $('poster').src=i>=3?'./chase.png':'./car.png';
  if(i>=2){$('flash').classList.remove('flash');void $('flash').offsetWidth;$('flash').classList.add('flash');particles();}
}
function draw(){
  const t=Math.min(soundtrack.currentTime,40);
  const i=t>=31?4:t>=22.2?3:t>=16.8?2:t>=6.7?1:0;
  if(i!==scene)setScene(i);
  const count=i===0?0:i===1?Math.min(6,1+Math.floor((t-6.7)/1.65)):6;
  stars.forEach((star,j)=>star.classList.toggle('lit',j<count));
  const showing=i>=2&&(i>=3||t>=17.25);
  $('poster').classList.toggle('show',showing&&!live3d);
  try { live3d?.draw(t,i,showing); } catch (error) {
    stage.querySelector("canvas")?.remove();
    live3d=null;
    $('poster').classList.toggle('show',showing);
  }
  $('progress').value=t;
  if(t<40)frame=requestAnimationFrame(draw);
  else finish();
}
function finish(){
  playback++;cancelAnimationFrame(frame);safely(stopSound);$('play').textContent='重播';$('skip').hidden=true;
}
$('play').onclick=()=>{
  cancelAnimationFrame(frame);
  stage.querySelectorAll('.confetti').forEach(p=>p.remove());
  $('flash').classList.remove('flash');
  $('poster').classList.remove('show');
  $('skip').hidden=false;
  $('play').textContent='从头重播';
  $('progress').value=0;
  scene=-1;
  const attempt = ++playback;
  stopSound();
  setScene(0);
  soundtrack.play().then(()=>{
    if(attempt===playback) draw();
  }).catch(()=>{
    if(attempt===playback) $('play').textContent='声音未启动 · 点此重试';
  });
};
soundtrack.addEventListener('ended',()=>{
  if (!$('skip').hidden) {
    $('progress').value=40;
    finish();
  }
});

$('skip').onclick=()=>{
  finish();
  setScene(4);$('progress').value=40;
  $('poster').classList.toggle('show',!live3d);live3d?.draw(40,4,true);
};
$('full').onclick=()=>stage.requestFullscreen?.().catch(()=>{});
if(!stage.requestFullscreen)$('full').hidden=true;

// Presentation only. A future host may map its authenticated response to this predicate.
export function canPresentServerAward(response){
  return response?.status==='CLAIMED'||response?.status==='ALREADY_CLAIMED';
}
import('./vehicle-voice.mjs').then(async module=>{live3d=await module.loadVehicle(stage);if(scene===4&&$('skip').hidden){$('poster').classList.remove('show');live3d.draw(40,4,true);}}).catch(()=>{});
