// Recorded at the Louisville Zoo by lauramellis. Freesound 263115, CC0 1.0.
const file=new URL('./fx-audio/tiger-louisville-cc0.mp3',import.meta.url);
const assets=new WeakMap(), playing=new WeakMap();
let bytes;
const cues={
  launch:{offset:.025,length:.46,gain:.44,fade:.14,rate:.93},
  garage:{offset:.19,length:.72,gain:.64,fade:.16,rate:1.02},
  boost:{offset:0,length:1.30,gain:.87,fade:.12,rate:.965},
};

export function prepareTigerRoar(ctx){
  if(!ctx || ctx.state==='closed') return Promise.resolve(null);
  if(!assets.has(ctx)){
    bytes??=fetch(file).then(r=>{
      if(!r.ok)throw Error('Tiger recording unavailable');
      return r.arrayBuffer();
    }).catch(error=>{bytes=null;throw error;});
    const decoded=bytes.then(buffer=>ctx.decodeAudioData(buffer.slice(0))).catch(()=>{
      assets.delete(ctx);
      return null;
    });
    assets.set(ctx,decoded);
  }
  return assets.get(ctx);
}

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
  if(previous?.event==='boost' && event!=='boost')return;
  stopTigerRoar(ctx);
  const ticket={event};
  playing.set(ctx,ticket);
  void prepareTigerRoar(ctx).then(buffer=>{
    if(playing.get(ctx)!==ticket)return;
    if(!buffer || ctx.state==='closed'){playing.delete(ctx);return;}
    const p=cues[event], current=ctx.currentTime;
    const source=ctx.createBufferSource(), envelope=ctx.createGain();
    ticket.source=source;ticket.gain=envelope;
    source.buffer=buffer;source.playbackRate.value=p.rate;
    const length=Math.min(p.length,buffer.duration-p.offset), duration=length/p.rate;
    envelope.gain.setValueAtTime(0,current);
    envelope.gain.linearRampToValueAtTime(p.gain,current+.035);
    envelope.gain.setValueAtTime(p.gain,current+Math.max(.04,duration-p.fade));
    envelope.gain.linearRampToValueAtTime(0,current+duration);
    source.connect(envelope).connect(dest);
    source.onended=()=>{
      if(playing.get(ctx)===ticket)playing.delete(ctx);
      source.disconnect();envelope.disconnect();
    };
    source.start(current,p.offset,length);
  });
}
