import {dr as Vector, y as Color} from './BufferGeometryUtils-B1nfbDRm.js';
import {clamp,damp,groundTypes} from './vehicle-feel.mjs';
import {rearOutlets} from './rear-effects.mjs';
export {createRearFx as createVehicleFx} from './rear-effects.mjs';

const tint=new Color();
const contact=new Vector(), localUp=new Vector();
export function updateSignatureVisual(kart,dt,particles,quality=1,camera=null) {
  const s=kart.signature;
  if(!s) return;
  const truck=s.id==='monster-truck', model=kart.model;
  if(truck && kart.grounded && s.track){
    kart.object.updateMatrixWorld(true);
    for(const w of model.wheels){
      w.pivot.getWorldPosition(contact);
      const actual=s.track.surfaceAt(contact,kart.trackIndex).y;
      const matrix=w.pivot.parent.matrixWorld.elements;
      localUp.set(matrix[4],matrix[5],matrix[6]);
      const scale=localUp.length();
      // The wheel center is solved in world space; steering and spin remain local.
      const correction=clamp(actual+w.radius-contact.y,-.27,.27);
      w.contactShift=damp(w.contactShift||0,correction/Math.max(.1,Math.abs(localUp.y)),21,dt);
      w.pivot.position.y+=w.contactShift;
      w.travel=Math.min(.27,Math.abs(w.contactShift)*scale);
    }
    model.body.position.y=damp(model.body.position.y,-s.landing*.092,20,dt);
  } else if(truck) {
    for(const w of model.wheels) w.contactShift=0;
    model.body.position.y=damp(model.body.position.y,0,12,dt);
  }
  const boost=s.effectBoost, speed=Math.abs(kart.speed), launch=s.launchTime>0;
  const burst=s.boostFlash||0;
  const driveTarget=kart.speed>=-.4?(s.throttle||0)*(.56+.44*clamp(speed/22,0,1)):0;
  s.visualDrive=damp(s.visualDrive||0,driveTarget,driveTarget>0?11:6,dt);
  const accent=truck?Math.min(.75,boost*.42+burst*.22):Math.max(s.claws/.42,burst);
  const distance=camera?.position.distanceTo(kart.position)??8.6;
  model.signatureFx?.update(boost,accent,s.age,{drive:s.visualDrive,burst,distance,low:quality<=1});
  s.boostFlash=damp(burst,0,3.8,dt);
  if(!particles) return;
  const surface=groundTypes[s.terrain]||groundTypes.asphalt;
  const sin=Math.sin(kart.visualYaw),cos=Math.cos(kart.visualYaw);
  const landed=truck&&s.landSequence&&s.landSequence!==s.dustLanding;
  if(landed){
    s.dustLanding=s.landSequence;
    tint.setHex(surface.color);
    for(let i=0;i<(quality>1?10:6);i++){
      const a=i*.618*Math.PI*2;
      particles.alpha.spawn(kart.position.x+Math.cos(a)*.8,kart.groundY+.12,kart.position.z+Math.sin(a)*.8,
        Math.cos(a)*4,1.10,Math.sin(a)*4,tint,.42,.48,{gravity:-1,drag:2,opacity:.48,grow:1.7});
    }
  }
  s.emission+=dt*(quality>1?31:18);
  if(s.emission<1) return;
  s.emission%=1;
  const anchor=rearOutlets[s.id];
  for(const side of [-1,1]){
    if(boost>.15 || (!truck&&(kart.drifting||launch))){
      const x=kart.position.x+sin*anchor.z+cos*side*anchor.x;
      const z=kart.position.z+cos*anchor.z-sin*side*anchor.x;
      tint.setHex(boost>.53?s.tune.core:s.tune.color);
      particles.additive.spawn(x,kart.position.y+anchor.y,z,-sin*(4+boost*6)+cos*side,
        .95+(kart.drifting?1.6:0),-cos*(4+boost*6)-sin*side,tint,.115+boost*.22,.31,
        {gravity:-3,drag:1.1});
    }
    if(truck && kart.grounded && speed>4 && (s.terrain!=='asphalt'||boost>.22||(s.throttle>.68&&speed>9))){
      const back=model.wheels[side<0?2:3];
      if(!back)continue;
      back.pivot.getWorldPosition(contact);
      const ground=s.track?.surfaceAt(contact,kart.trackIndex)?.y??kart.groundY;
      const asphalt=s.terrain==='asphalt',gravel=s.terrain==='gravel',grass=s.terrain==='grass';
      tint.setHex(surface.color);
      particles.alpha.spawn(contact.x,ground+.12,contact.z,-sin*(3+boost*3)+cos*side*1.7,
        gravel?2.6:1.32,-cos*(3+boost*3)-sin*side*1.7,tint,grass?.23:gravel?.16:asphalt?.33:.47,
        gravel?.36:.55,{gravity:gravel?-12:-2.4,drag:2,opacity:asphalt?.25:.49,grow:grass||gravel?1:1.7});
    }
  }
}
