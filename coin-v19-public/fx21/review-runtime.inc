if(fxReview){
 const reviewSky={zenith:up.skyMat.uniforms.uZenith.value.clone(),horizon:up.skyMat.uniforms.uHorizon.value.clone(),
  ground:up.skyMat.uniforms.uGround.value.clone(),fog:sp.scene.fog.color.clone(),
  sun:up.sun.intensity,hemi:up.hemi.intensity,fill:up.fill.intensity,environment:sp.scene.environmentIntensity};
 let nativeCamera=null,fixed=false;
 const snapshot=()=>{
  const p=$.player;
  const exhaust=p?.model.signatureFx?.exhaust;
  return {id:p?.model.group.name,speed:p?.speed,boost:p?.boostTime,distance:p?.position.distanceTo(sp.camera.position),
   chase:yp.mode,fx:p?.model.signatureFx?.root.children.filter(n=>n.visible&&n.parent.visible).length||0,
   bloom:sp.bloom.enabled,fixed,clock:$.race?.raceTime??0,
   fire:exhaust?{kind:exhaust.event,serial:exhaust.serial,left:exhaust.left.energy,right:exhaust.right.energy}:null,
   steer:p?._steerSmooth,heading:p?.visualYaw,active:p?.model.signatureFx?.root.visible??false,time:fxRun,
   fps:sp.fps,geometries:sp.renderer.info.memory.geometries,textures:sp.renderer.info.memory.textures,
   particles:vp.additive.life.reduce((n,x)=>n+(x>0),0)+vp.alpha.life.reduce((n,x)=>n+(x>0),0)};
 };
 const setFixed=enabled=>{
  fixed=enabled;
  const p=$.player;
  if(!p||!nativeCamera)return;
  p.model.cam=fixed?comparisonCamera:nativeCamera.cam;
  p.model.camShort=fixed?comparisonCamera:nativeCamera.camShort;
  yp.mode=0;yp._init=false;
 };
 window.readFxReview=snapshot;
 if(fxCapture)window.captureFxReview=()=>new Promise(resolve=>{fxFramePending=resolve;});
 createReview(snapshot,async id=>{
  X.init();X.resume();fxRun=0;signatureAudio.stop();stopTigerRoar(X.ctx);
  await Zp(Ep,id);
  if($.player?.model.group.name!==id)return;
  nativeCamera={cam:$.player.model.cam,camShort:$.player.model.camShort};
  setFixed(fixed);
  $.race.state=Wu.RACING;yp.mode=0;yp._init=false;
 },night=>{
  const u=up.skyMat.uniforms;
  if(night){
   u.uZenith.value.setHex(0x101a41);u.uHorizon.value.setHex(0x414c80);u.uGround.value.setHex(0x182142);
   sp.scene.fog.color.setHex(0x2d325a);up.sun.intensity=.48;up.hemi.intensity=.36;up.fill.intensity=.35;sp.scene.environmentIntensity=.33;
  }else{
   u.uZenith.value.copy(reviewSky.zenith);u.uHorizon.value.copy(reviewSky.horizon);u.uGround.value.copy(reviewSky.ground);
   sp.scene.fog.color.copy(reviewSky.fog);up.sun.intensity=reviewSky.sun;up.hemi.intensity=reviewSky.hemi;
   up.fill.intensity=reviewSky.fill;sp.scene.environmentIntensity=reviewSky.environment;
  }
 },(boost,turn=false,mode="hard")=>{
  const p=$.player;
  if(!p||$.state!=='race')return;
  X.resume();
  const start=fp.startPose(0);
  const index=turn?findTurn(start.index):start.index;
  const position=fp.pointAt(index,0);
  p.placeAt(position,fp.getTangent(index));p.trackIndex=index;
  fxCruise=mode==="cruise";
  p.speed=mode==="shift"?11.4:18;p.lateral=p.vy=p.boostPower=p.boostTime=p._steerSmooth=0;p.grounded=true;p.groundY=position.y;
  if(p.signature){p.signature.effectBoost=p.signature.visualDrive=p.signature.boostFlash=0;}
  p.model.signatureFx?.resetExhaust(p.signature?.boostSequence,p.signature?.launchSequence,p.speed,mode==="shift"?1:0);
  $.race.raceTime=0;yp._init=false;
  const preset=fixed?comparisonCamera:p.model.camShort??p.model.cam??comparisonCamera;
  yp.look.copy(p.position).addScaledVector(p.forward,preset.lookAhead??4.5);yp.look.y+=preset.lookY??1.18;
  fxRun=2.65;
  if(boost)p.applyBoost(12,1.6);
 },enabled=>{sp.bloom.enabled=enabled;},setFixed);
 function findTurn(start){
  const spacing=fp.length/fp.n;
  const look=Math.max(3,Math.round(9/spacing));
  const stride=Math.max(1,Math.round(1.8/spacing));
  let best=fp.sampleAt(start+look),score=Infinity;
  for(let advance=look;advance<fp.n;advance+=stride){
   const here=fp.sampleAt(start+advance);
   const a=fp.getTangent(here),b=fp.getTangent(fp.sampleAt(here+look));
   const bend=Math.acos(Math.max(-1,Math.min(1,(a.x*b.x+a.z*b.z)/Math.max(.001,Math.hypot(a.x,a.z)*Math.hypot(b.x,b.z)))));
   const error=Math.abs(bend-.44)+(bend<.20?.45:0);
   if(error<score){best=here;score=error;}
  }
  return best;
 }
}
