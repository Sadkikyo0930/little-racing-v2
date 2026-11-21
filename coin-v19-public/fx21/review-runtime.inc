if(fxReview){
 const reviewSky={zenith:up.skyMat.uniforms.uZenith.value.clone(),horizon:up.skyMat.uniforms.uHorizon.value.clone(),
  ground:up.skyMat.uniforms.uGround.value.clone(),fog:sp.scene.fog.color.clone(),
  sun:up.sun.intensity,hemi:up.hemi.intensity,fill:up.fill.intensity,environment:sp.scene.environmentIntensity};
 const snapshot=()=>{
  const p=$.player;
  return {id:p?.model.group.name,speed:p?.speed,boost:p?.boostTime,distance:p?.position.distanceTo(sp.camera.position),
   chase:yp.mode,fx:p?.model.signatureFx?.root.children.filter(n=>n.visible&&n.parent.visible).length||0,
   active:p?.model.signatureFx?.root.visible??false,time:fxRun,
   fps:sp.fps,geometries:sp.renderer.info.memory.geometries,textures:sp.renderer.info.memory.textures,
   particles:vp.additive.life.reduce((n,x)=>n+(x>0),0)+vp.alpha.life.reduce((n,x)=>n+(x>0),0)};
 };
 window.readFxReview=snapshot;
 if(fxCapture)window.captureFxReview=()=>new Promise(resolve=>{fxFramePending=resolve;});
 createReview(snapshot,async id=>{
  X.init();X.resume();fxRun=0;signatureAudio.stop();stopTigerRoar(X.ctx);
  await Zp(Ep,id);
  if($.player?.model.group.name!==id)return;
  $.player.model.cam=$.player.model.camShort=comparisonCamera;
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
 },boost=>{
  const p=$.player;
  if(!p||$.state!=='race')return;
  X.resume();
  const start=fp.startPose(0), position=fp.pointAt(start.index,0);
  p.placeAt(position,fp.getTangent(start.index));p.trackIndex=start.index;
  p.speed=18;p.lateral=p.vy=p.boostPower=p.boostTime=p._steerSmooth=0;p.grounded=true;p.groundY=position.y;
  if(p.signature){p.signature.effectBoost=p.signature.visualDrive=p.signature.boostFlash=0;}
  $.race.raceTime=0;yp._init=false;
  yp.look.copy(p.position).addScaledVector(p.forward,comparisonCamera.lookAhead);yp.look.y+=comparisonCamera.lookY;
  fxRun=2.65;
  if(boost)p.applyBoost(12,1.6);
 });
}
