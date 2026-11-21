import {G as Group, l as Box, x as Cone, bt as Mesh, xt as Material,
  dr as Vector, y as Color} from './BufferGeometryUtils-B1nfbDRm.js';
import {clamp, damp, groundTypes, handling} from './vehicle-feel.mjs';

// Shared geometry survives vehicle disposal. Each live car owns only its materials.
const beam=new Box(1,1,1), flame=new Cone(1,1,7);
const tint=new Color();
export function createVehicleFx(id, garage=false) {
  const p=handling[id], root=new Group(), tiger=id==='tiger-kart';
  const glow=new Material({color:p.color,transparent:true,depthWrite:false,blending:2,opacity:0});
  const core=new Material({color:p.core,transparent:true,depthWrite:false,blending:2,opacity:0});
  const make=(geometry,material,x,y,z)=>{
    const mesh=new Mesh(geometry,material);
    mesh.position.set(x,y,z);
    mesh.userData.sharedAsset=true;
    root.add(mesh);
    return mesh;
  };
  const jets=[], streaks=[], marks=[];
  if(!garage){
    for(const x of [-.32,.32]){
      const jet=make(flame,glow,x,tiger?.51:1.04,-1.46);
      jet.rotation.x=-Math.PI/2;jets.push(jet);
      const tip=make(flame,core,x,tiger?.51:1.04,-1.54);
      tip.rotation.x=-Math.PI/2;jets.push(tip);
    }
  }
  const xSide=tiger?.87:1.24;
  for(const side of [-1,1]){
    const strip=make(beam,glow,side*xSide,tiger?.57:1.28,garage?.12:-.1);
    strip.scale.set(.035,.048,garage?1.12:2.1);
    streaks.push(strip);
  }
  for(let i=0;i<3;i++){
    const mark=make(beam,core,(i-1)*.35,tiger?.38:1.22,-1.83-i*.16);
    mark.scale.set(tiger?.043:.037,.045,tiger?.73:.52);
    mark.rotation.y=tiger?-.66:(i%2?-.71:.83);
    marks.push(mark);
  }
  function update(boost,accent,time){
    root.visible=Math.max(boost,accent)>.018;
    if(!root.visible) return;
    glow.opacity=Math.min(.70,boost*.57+accent*.36);
    core.opacity=Math.min(.84,accent*.84+boost*.35);
    for(let i=0;i<jets.length;i++){
      const jet=jets[i], inner=i%2, pulse=.92+.08*Math.sin(time*46+i*2);
      jet.visible=boost>.025;
      const length=(inner?.65:1.15)*boost*pulse;
      jet.scale.set((inner?.088:.175)*boost,length,(inner?.088:.175)*boost);
      jet.position.z=-1.43-length*.4;
    }
    for(const strip of streaks) strip.position.z=garage?.48-accent*.94:-.12-boost*.72;
    for(let i=0;i<marks.length;i++){
      const mark=marks[i];
      mark.visible=accent>.025;
      mark.rotation.y=tiger?-.66:(i%2?-1:1)*(.57+.22*Math.sin(time*28+i));
    }
  }
  root.visible=false;
  return {root,update,dispose(){glow.dispose();core.dispose();}};
}

const contact=new Vector(), localUp=new Vector();
export function updateSignatureVisual(kart,dt,particles,quality=1) {
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
  const boost=s.effectBoost, accent=truck?boost*(.40+.33*Math.sin(s.age*26)**2):Math.max(s.claws/.42,s.boostFlash||0);
  model.signatureFx?.update(boost,accent,s.age);
  s.boostFlash=damp(s.boostFlash||0,0,5,dt);
  if(!particles) return;
  s.emission+=dt*(quality>1?30:16);
  if(s.emission<1) return;
  s.emission%=1;
  const surface=groundTypes[s.terrain]||groundTypes.asphalt;
  const speed=Math.abs(kart.speed), drift=kart.drifting, launch=s.launchTime>0;
  const sin=Math.sin(kart.visualYaw),cos=Math.cos(kart.visualYaw);
  for(const side of [-1,1]){
    const x=kart.position.x-sin*1.21+cos*side*.78;
    const z=kart.position.z-cos*1.21-sin*side*.78;
    if(boost>.07 || (!truck&&(drift||launch))){
      tint.setHex(boost>.55?s.tune.core:s.tune.color);
      particles.additive.spawn(x,kart.position.y+(boost>.1?.54:.23),z,-sin*(3+boost*5)+cos*side,
        .8+(drift?1.5:0),-cos*(3+boost*5)-sin*side,tint,.16+boost*.2,.28,{gravity:-4,drag:1.5});
    }
    if(truck && kart.grounded && speed>3 && (s.terrain!=='asphalt' || boost>.48)){
      tint.setHex(surface.color);
      const gravel=s.terrain==='gravel', grass=s.terrain==='grass';
      particles.alpha.spawn(x,kart.groundY+.19,z,-sin*(3+boost*3)+cos*side*1.7,
        gravel?2.6:1.35,-cos*(3+boost*3)-sin*side*1.7,tint,grass?.22:gravel?.15:.43,
        gravel?.36:.53,{gravity:gravel?-12:-3,drag:2,opacity:.53,grow:grass||gravel?1:1.5});
    }
  }
}
