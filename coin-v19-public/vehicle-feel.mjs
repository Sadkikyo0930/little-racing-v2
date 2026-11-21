const profile = Object.freeze;
export const handling = profile({
  'tiger-kart': profile({name:'猛虎突袭', description:'猛虎突袭——敏捷过弯，瞬间爆发。',
    speed:1.10, accel:1.25, response:1.18, steer:1.12, brake:1.08, drift:1.20,
    terrain:.90, impact:1.05, boost:1.22, duration:1.05, color:0xffa43b, core:0xffe4a1, pitch:1.32}),
  'monster-truck': profile({name:'雷霆冲锋', description:'雷霆冲锋——无惧颠簸，征服全地形。',
    speed:.98, accel:1.15, response:.80, steer:.85, brake:1.05, drift:.80,
    terrain:.35, impact:.65, boost:1.08, duration:1.30, color:0x49a8ff, core:0xe1f7ff, pitch:1.65}),
});

export const groundTypes = profile({
  asphalt:profile({name:'沥青', retention:1, lateral:1, color:0x9da7af, rumble:.06}),
  grass:profile({name:'草地', retention:.72, lateral:.88, color:0x82af49, rumble:.21}),
  mud:profile({name:'泥地', retention:.59, lateral:.78, color:0x986446, rumble:.62}),
  gravel:profile({name:'碎石', retention:.82, lateral:.91, color:0xae997e, rumble:.46}),
});
export const damp = (a,b,k,dt) => b+(a-b)*Math.exp(-k*dt);
export const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
export const retained = (base, multiplier) => 1-(1-base)*multiplier;
const trackKinds = ['grass','gravel','asphalt','asphalt','mud'];

export function classifyGround(track, sample, offroad) {
  return (track.groundTypeAt?.(sample.loc) ?? (offroad ? 'grass' :
    track.course?.scenery === 'beach' ? trackKinds[sample.loc.kind ?? track.kind[sample.loc.index]] : 'asphalt')) || 'asphalt';
}

export function signatureState(id) {
  const tune=handling[id];
  return tune ? {id,tune,terrain:'asphalt',throttle:0,launchTime:0,launchCooldown:0,
    effectBoost:0,boostSequence:0,landing:0,claws:0,driftTier:0,emission:0,age:0} : null;
}

export function prepareSignature(kart,dt,throttle,brake) {
  const state=kart.signature;
  if(!state) return;
  state.throttle=throttle;
  state.brake=brake;
  state.launchCooldown=Math.max(0,state.launchCooldown-dt);
  state.launchTime=Math.max(0,state.launchTime-dt);
  state.age+=dt;
  if(kart.grounded && kart.speed>=0 && kart.speed<1.7 && throttle>.8 && !state.launchCooldown){
    state.launchTime=.32;
    state.launchCooldown=3.2;
    state.launchSequence=(state.launchSequence||0)+1;
  }
  state.landing=damp(state.landing,0,9,dt);
  state.claws=Math.max(0,state.claws-dt);
}

export function finishSignature(kart,track,sample,dt) {
  const state=kart.signature;
  if(!state) return;
  if(kart.drifting && kart.driftTier>state.driftTier && kart.driftTier>0) state.claws=.42;
  state.driftTier=kart.driftTier;
  state.track=track;
  state.terrain=classifyGround(track,sample,kart.offroad);
  state.effectBoost=damp(state.effectBoost,kart.boostTime>0?1:0,kart.boostTime>0?16:5.5,dt);
}

export function landSignature(kart,verticalSpeed) {
  if(!kart.signature || verticalSpeed>=-2.2) return;
  const s=kart.signature;
  s.landing=clamp(-verticalSpeed/10,0,1);
  s.landSequence=(s.landSequence||0)+1;
}

export function garageMeters(id) {
  const p=handling[id];
  if (!p) return '';
  const rows=[
    ['最高速度',p.speed],['加速',p.accel],['操控',(p.response+p.steer+p.drift)/3],
    ['越野',(retained(.72,p.terrain)+retained(.59,p.terrain))/(.72+.59)],
    ['稳定性',2-p.impact],['氮气能力',p.boost*p.duration],
  ];
  return rows.map(([label,value])=>`<div class="gpStat signature-stat"><u>${label}</u><meter min="0" max="1.5" value="${value}" aria-label="${label}，普通赛车为基准"></meter></div>`).join('');
}
