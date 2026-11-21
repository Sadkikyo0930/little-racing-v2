import {SignatureAudio,playSignature} from './assets/vehicle-audio.mjs';
const playback=new SignatureAudio();
let ctx, bus, frame, generation=0;
const status=document.getElementById('status');
function stop(){
  generation++;cancelAnimationFrame(frame);playback.stop();
  if(bus)bus.gain.setTargetAtTime(0,ctx.currentTime,.02);
  status.textContent='';
}
function start(button){
  stop();
  const C=window.AudioContext||window.webkitAudioContext;
  if(!C){status.textContent='此浏览器不支持 Web Audio。';return;}
  if(!ctx){ctx=new C();bus=ctx.createGain();bus.connect(ctx.destination);}
  bus.gain.setTargetAtTime(.78,ctx.currentTime,.02);
  const id=button.closest('section').dataset.vehicle, clip=button.dataset.clip;
  const current=generation;
  ctx.resume().then(()=>{
    if(current!==generation)return;
    status.textContent='播放中 · '+button.textContent;
    if(!['engine','mud','gravel'].includes(clip)){
      playSignature(ctx,bus,id,clip);
      setTimeout(()=>{if(current===generation)stop();},1080);
      return;
    }
    const began=performance.now();
    function loop(now){
      if(current!==generation)return;
      const time=(now-began)/1000, ground=clip==='engine'?'asphalt':clip;
      const throttle=clip==='engine'?time<.75||time>3.1?0:1:.63;
      const speed=clip==='engine'?time<.75?0:Math.max(0,Math.min(26,(time-.75)*12,(4.9-time)*15)):19;
      playback.update(ctx,bus,{id,terrain:ground,throttle,effectBoost:0},speed);
      if(time<4.9)frame=requestAnimationFrame(loop);else stop();
    }
    frame=requestAnimationFrame(loop);
  }).catch(()=>{if(current===generation)status.textContent='无法启动音频，请重新轻点播放。';});
}
for(const btn of document.querySelectorAll('[data-clip]'))btn.addEventListener('click',()=>start(btn));
document.getElementById('stop').addEventListener('click',stop);
addEventListener('pagehide',stop);
