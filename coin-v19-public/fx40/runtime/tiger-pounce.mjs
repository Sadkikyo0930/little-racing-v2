import {G as Group} from './BufferGeometryUtils-B1nfbDRm.js';
import {t as GLTFLoader} from './GLTFLoader-BaXP2m-J.js';

const smooth=(a,b,v)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
let depot;
export function warmSpiritTiger(){
  if(!depot){
    const url=new URL('./vfx40/spirit-tiger.glb',import.meta.url);
    depot=Promise.all([
      new GLTFLoader().loadAsync(url.href),
      import('./vendor/three.core.js'),
    ]).then(([asset,{AnimationMixer,LoopOnce}])=>{
      const clip=asset.animations.find(clip=>clip.name==='SpiritPounce');
      if(!clip)throw Error('SpiritPounce animation missing');
      return {asset,clip,AnimationMixer,LoopOnce};
    }).catch(error=>{depot=null;throw error;});
  }
  return depot;
}

function mountSkinnedClone(source,uniforms){
  const model=source.clone(true),from=[],to=[];
  source.traverse(n=>from.push(n));model.traverse(n=>to.push(n));
  const map=new Map(from.map((source,i)=>[source,to[i]]));
  const skeletons=new Map(),surfaces=new Map();
  for(let i=0;i<from.length;i++){
    const original=from[i],mesh=to[i];
    mesh.userData.sharedAsset=true;
    if(!mesh.isSkinnedMesh)continue;
    let skeleton=skeletons.get(original.skeleton);
    if(!skeleton){
      skeleton=original.skeleton.clone();
      skeleton.bones=original.skeleton.bones.map(bone=>map.get(bone));
      skeletons.set(original.skeleton,skeleton);
    }
    mesh.bind(skeleton,original.bindMatrix);
    mesh.frustumCulled=false;
    mesh.castShadow=false;mesh.receiveShadow=false;
    let material=surfaces.get(original.material);
    if(!material){
      material=original.material.clone();
      material.roughness=.51;
      material.customProgramCacheKey=()=> 'little-racing-spirit-tiger-v4';
      material.onBeforeCompile=shader=>{
        Object.assign(shader.uniforms,uniforms);
        shader.vertexShader=shader.vertexShader
          .replace('#include <common>','#include <common>\nvarying vec3 vSpirit;')
          .replace('#include <begin_vertex>','#include <begin_vertex>\nvSpirit=position;');
        shader.fragmentShader=shader.fragmentShader
          .replace('#include <common>',`#include <common>
            varying vec3 vSpirit;
            uniform float uSpiritTime, uSpiritAlpha, uSpiritDissolve;`)
          .replace('#include <color_fragment>',`#include <color_fragment>
            vec3 ash=floor(vSpirit*vec3(67.0,83.0,67.0));
            float grain=fract(sin(dot(ash,vec3(71.674,39.217,93.121)))*43158.43);
            float fade=clamp(uSpiritDissolve*(1.45-vSpirit.z*.30),0.0,1.0);
            if(grain<max(1.0-uSpiritAlpha,fade))discard;
            diffuseColor.rgb*=vec3(1.035,.94,.75);`)
          .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
            float rim=pow(1.0-clamp(dot(normalize(normal),normalize(vViewPosition)),0.0,1.0),2.0);
            float luma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
            float sweep=smoothstep(.87,.99,.5+.5*cos(vSpirit.z*6.3-vSpirit.y*2.5-uSpiritTime*18.0));
            totalEmissiveRadiance+=vec3(.95,.66,.23)*(rim*.73+sweep*.36+.057)*(luma*.72+.13);
            totalEmissiveRadiance+=vec3(.83,.27,.034)*(fade*.20);`);
      };
      surfaces.set(original.material,material);
    }
    mesh.material=material;
  }
  return {model,dispose(){
    for(const skeleton of skeletons.values())skeleton.dispose();
    for(const material of surfaces.values())material.dispose();
  }};
}

export function createTigerPounce(){
  const root=new Group();
  root.name='Skinned spirit tiger';root.userData.sharedAsset=true;root.visible=false;
  const uniforms={uSpiritTime:{value:0},uSpiritAlpha:{value:0},uSpiritDissolve:{value:1}};
  let stopped=false,rig,mixer,action,clip,active=false;
  const ready=warmSpiritTiger().then(({asset,clip:animation,AnimationMixer,LoopOnce})=>{
    if(stopped)return;
    rig=mountSkinnedClone(asset.scene,uniforms);
    root.add(rig.model);
    clip=animation;
    mixer=new AnimationMixer(rig.model);
    action=mixer.clipAction(clip);
    action.setLoop(LoopOnce,1);
    action.clampWhenFinished=true;
  }).catch(error=>console.warn('[spirit tiger]',error));
  return {root,ready,update(age,reduced){
    const alpha=smooth(.05,.23,age), dissolve=smooth(.89,1.42,age);
    const visible=!!action&&alpha>.035&&dissolve<.995;
    root.visible=visible;
    if(!visible){
      if(active){action.stop();active=false;}
      return;
    }
    if(!active){action.reset().play();action.paused=true;active=true;}
    action.time=Math.min(clip.duration,age*1.04);mixer.update(0);
    uniforms.uSpiritAlpha.value=alpha*(reduced?.79:.95);
    uniforms.uSpiritDissolve.value=dissolve;
    uniforms.uSpiritTime.value=reduced?0:age;
    const travel=smooth(.19,.98,age);
    const stride=reduced?.48:travel;
    root.position.set(2.82-.30*stride,.26+(reduced?0:Math.sin(travel*Math.PI)*.27),.72+stride*2.63);
    root.rotation.y=-1.16+.19*stride;
    root.scale.setScalar(reduced?.86:1.02);
  },dispose(){
    stopped=true;root.visible=false;
    if(mixer){mixer.stopAllAction();mixer.uncacheRoot(rig.model);root.remove(rig.model);rig.dispose();}
  }};
}
