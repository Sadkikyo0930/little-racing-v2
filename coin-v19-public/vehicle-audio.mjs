import {clamp, groundTypes} from './vehicle-feel.mjs';
import {playTigerRoar,prepareTigerRoar,stopTigerRoar} from './tiger-roar.mjs';
export {prepareTigerRoar,stopTigerRoar} from './tiger-roar.mjs';

const noiseCache=new WeakMap();
function noise(ctx) {
  if(noiseCache.has(ctx)) return noiseCache.get(ctx);
  const buffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
  const data=buffer.getChannelData(0);
  let seed=731299;
  for(let i=0;i<data.length;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    data[i]=seed/2147483648-1;
  }
  noiseCache.set(ctx,buffer);
  return buffer;
}

function voice(ctx,dest,type,frequency,gain) {
  const oscillator=ctx.createOscillator(), level=ctx.createGain();
  oscillator.type=type;
  oscillator.frequency.value=frequency;
  level.gain.value=gain;
  oscillator.connect(level).connect(dest);
  oscillator.start();
  return oscillator;
}

export function playSignature(ctx,dest,id,event) {
  if(!ctx || !dest || !id || ctx.state==='closed') return;
  const tiger=id==='tiger-kart', boost=event==='boost', land=event==='land';
  if(tiger){playTigerRoar(ctx,dest,event);return;}
  const time=ctx.currentTime, length=land?.27:boost?.94:.44;
  const gain=ctx.createGain(), filter=ctx.createBiquadFilter();
  filter.type=tiger&&!land?'bandpass':'lowpass';
  filter.Q.value=tiger?1.55:.55;
  filter.frequency.setValueAtTime(land?250:tiger?420:155,time);
  filter.frequency.exponentialRampToValueAtTime(land?95:tiger?215:320,time+length*.45);
  filter.frequency.exponentialRampToValueAtTime(land?70:tiger?128:90,time+length);
  gain.gain.setValueAtTime(.0001,time);
  gain.gain.exponentialRampToValueAtTime(land?.13:boost?.30:.135,time+.045);
  gain.gain.exponentialRampToValueAtTime(.0001,time+length);
  filter.connect(gain).connect(dest);
  const motor=voice(ctx,filter,tiger?'sawtooth':'triangle',land?59:tiger?88:36,.43);
  motor.frequency.exponentialRampToValueAtTime(land?29:tiger?51:72,time+length*.42);
  motor.frequency.exponentialRampToValueAtTime(tiger?36:29,time+length);
  const grit=ctx.createBufferSource(), gritGain=ctx.createGain();
  grit.buffer=noise(ctx);
  gritGain.gain.value=tiger?.73:.36;
  grit.connect(gritGain).connect(filter);
  const pulse=voice(ctx,gritGain.gain,'triangle',tiger?31:18,tiger?.22:.14);
  grit.start(time,boost?.38:0);
  for(const source of [motor,grit,pulse]) source.stop(time+length+.01);
  grit.onended=()=>{grit.disconnect();gritGain.disconnect();filter.disconnect();gain.disconnect();motor.disconnect();pulse.disconnect();};
}

export class SignatureAudio {
  constructor() {this.loop=null;this.last={};}
  stop() {
    if(!this.loop)return;
    stopTigerRoar(this.loop.ctx);
    for(const source of this.loop.sources){source.stop();source.disconnect();}
    for(const node of this.loop.nodes) node.disconnect();
    this.loop=null;
    this.last={};
  }
  update(ctx,dest,state,speed,finished=false) {
    if(!ctx || !dest || !state || finished){this.stop();return;}
    if(this.loop?.id!==state.id || this.loop?.ctx!==ctx) this.start(ctx,dest,state.id);
    const loop=this.loop,tiger=state.id==='tiger-kart', time=ctx.currentTime;
    const rpm=clamp(Math.abs(speed)/32,0,1.45), throttle=state.throttle||0, boost=state.effectBoost||0;
    const hz=(tiger?57:29)+(tiger?148:66)*rpm+(tiger?27:19)*throttle+boost*(tiger?29:13);
    loop.sources[0].frequency.setTargetAtTime(hz,time,.075);
    loop.sources[1].frequency.setTargetAtTime(hz*(tiger?2.006:.507),time,.08);
    loop.filter.frequency.setTargetAtTime((tiger?550:205)+rpm*(tiger?1020:510)+throttle*(tiger?280:260)+(tiger?0:110*boost),time,.09);
    loop.volume.gain.setTargetAtTime(.052+throttle*.043+rpm*.036+boost*(tiger?.02:.055),time,.09);
    const surface=groundTypes[state.terrain]||groundTypes.asphalt;
    loop.roadFilter.frequency.setTargetAtTime((tiger?460:155)+surface.rumble*680,time,.08);
    loop.roadVolume.gain.setTargetAtTime(Math.min(1,rpm)*(.007+surface.rumble*(tiger?.035:.10)),time,.08);
    for(const [key,event] of [['launchSequence','launch'],['boostSequence','boost'],['landSequence','land']]){
      const fresh=event==='launch'?state.launchTime>.15:event==='boost'?(state.boostFlash||0)>.35:(state.landing||0)>.3;
      if(fresh&&state[key]&&state[key]!==this.last[key]&&(event!=='land'||!tiger)) playSignature(ctx,dest,state.id,event);
      this.last[key]=state[key];
    }
  }
  start(ctx,dest,id) {
    this.stop();
    const tiger=id==='tiger-kart';
    if(tiger)void prepareTigerRoar(ctx);
    const volume=ctx.createGain(),filter=ctx.createBiquadFilter();
    volume.gain.value=0;filter.type='lowpass';filter.Q.value=.65;
    filter.connect(volume).connect(dest);
    const a=voice(ctx,filter,tiger?'sawtooth':'triangle',tiger?65:34,.47);
    const b=voice(ctx,filter,tiger?'triangle':'sawtooth',tiger?128:18,.25);
    const road=ctx.createBufferSource(),roadFilter=ctx.createBiquadFilter(),roadVolume=ctx.createGain();
    road.buffer=noise(ctx);road.loop=true;roadFilter.type='bandpass';roadFilter.Q.value=.6;
    roadVolume.gain.value=0;road.connect(roadFilter).connect(roadVolume).connect(dest);road.start();
    this.loop={id,ctx,sources:[a,b,road],nodes:[filter,volume,roadFilter,roadVolume],filter,volume,roadFilter,roadVolume};
  }
}
