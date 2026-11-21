// Both recordings and their edits are documented in fx-audio/LICENSE.md.
const assets=new WeakMap(), playing=new WeakMap(), lastCue=new WeakMap(), bytes=new Map();
const cues={
  launch:{file:'tiger-garage.mp3',length:.38,gain:.42,fade:.11},
  garage:{file:'tiger-garage.mp3',length:.89,gain:.63,fade:.13},
  boost:{file:'tiger-boost.mp3',length:2.27,gain:.84,fade:.18},
};

export function prepareTigerRoar(ctx,file=cues.boost.file){
  if(!ctx || ctx.state==='closed') return Promise.resolve(null);
  if(!assets.has(ctx))assets.set(ctx,new Map());
  const decoded=assets.get(ctx);
  if(!decoded.has(file)){
    if(!bytes.has(file))bytes.set(file,fetch(new URL('./fx-audio/'+file,import.meta.url)).then(r=>{
      if(!r.ok)throw Error('Tiger recording unavailable');
      return r.arrayBuffer();
    }).catch(error=>{bytes.delete(file);throw error;}));
    decoded.set(file,bytes.get(file).then(buffer=>ctx.decodeAudioData(buffer.slice(0))).catch(()=>{
      decoded.delete(file);
      return null;
    }));
  }
  return decoded.get(file);
}
export const tigerRoarPlaying=ctx=>Boolean(playing.get(ctx)?.source);

export function stopTigerRoar(ctx){
  if(!ctx)return;
  const active=playing.get(ctx);
  if(!active)return;
  playing.delete(ctx);
  if(active.source){
    const time=ctx.currentTime;
    active.gain.gain.setTargetAtTime(0,time,.014);
    try{active.source.stop(time+.065);}catch{}
  }
}

export function playTigerRoar(ctx,dest,event){
  if(!ctx || !dest || !cues[event] || ctx.state==='closed')return;
  const previous=playing.get(ctx);
  const prior=lastCue.get(ctx);
  if(previous?.event==='boost'||(prior?.event===event&&ctx.currentTime-prior.time<(event==='boost'?2.65:1.1)))return;
  stopTigerRoar(ctx);
  const ticket={event};
  playing.set(ctx,ticket);
  const p=cues[event];
  void prepareTigerRoar(ctx,p.file).then(buffer=>{
    if(playing.get(ctx)!==ticket)return;
    if(!buffer || ctx.state==='closed'){playing.delete(ctx);return;}
    const current=ctx.currentTime;
    lastCue.set(ctx,{event,time:current});
    const source=ctx.createBufferSource(), envelope=ctx.createGain();
    ticket.source=source;ticket.gain=envelope;
    source.buffer=buffer;
    const duration=Math.min(p.length,buffer.duration);
    envelope.gain.setValueAtTime(0,current);
    envelope.gain.linearRampToValueAtTime(p.gain,current+.035);
    envelope.gain.setValueAtTime(p.gain,current+Math.max(.04,duration-p.fade));
    envelope.gain.linearRampToValueAtTime(0,current+duration);
    source.connect(envelope).connect(dest);
    source.onended=()=>{
      if(playing.get(ctx)===ticket)playing.delete(ctx);
      source.disconnect();envelope.disconnect();
    };
    source.start(current,0,duration);
  });
}
