import {d as BufferGeometry,u as BufferAttribute,G as Group,bt as Mesh,
  Bn as ShaderMaterial,Yn as Texture} from './BufferGeometryUtils-B1nfbDRm.js';
import {clamp} from './vehicle-feel.mjs';
import {createExhaustEvents} from './backfire-events.mjs';

const artTextures=new Map();
function authoredTexture(name){
  if(artTextures.has(name))return artTextures.get(name);
  const texture=new Texture(),loaded={value:0};
  texture.generateMipmaps=false;
  texture.minFilter=1006;
  const image=new Image();
  image.decoding='async';
  image.onload=()=>{texture.image=image;texture.needsUpdate=true;loaded.value=1;};
  image.src=new URL('./vfx40/'+name,import.meta.url).href;
  const result={texture:{value:texture},loaded};
  artTextures.set(name,result);
  return result;
}
const motionPreference=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

// Rear apertures measured in the transformed Body frame. +Z is forward.
export const rearOutlets=Object.freeze({
  'tiger-kart':Object.freeze({x:.49,y:.58,z:-1.325,radius:.17}),
  'monster-truck':Object.freeze({x:.65,y:.89,z:-1.248,radius:.215}),
});

function strips(count,steps){
  const shape=[],positions=[],indices=[];
  for(let strip=0;strip<count;strip++){
    const start=positions.length/3;
    for(let i=0;i<=steps;i++)for(const edge of [-1,1]){
      shape.push(i/steps,edge,strip);
      positions.push(0,0,0);
    }
    for(let i=0;i<steps;i++){
      const j=start+2*i;
      indices.push(j,j+1,j+2,j+1,j+3,j+2);
    }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));
  geometry.setAttribute('shape',new BufferAttribute(new Float32Array(shape),3));
  geometry.setIndex(indices);
  return geometry;
}

function pressureColumns(){
  const shape=[],positions=[],indices=[],rings=10,sides=8,stride=sides+1;
  for(const sign of [-1,1]){
    const start=positions.length/3;
    for(let row=0;row<=rings;row++)for(let side=0;side<=sides;side++){
      shape.push(row/rings,2*Math.PI*side/sides,sign);
      positions.push(0,0,0);
    }
    for(let row=0;row<rings;row++)for(let side=0;side<sides;side++){
      const a=start+row*stride+side,b=a+stride;
      indices.push(a,b,a+1,a+1,b,b+1);
    }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));
  geometry.setAttribute('shape',new BufferAttribute(new Float32Array(shape),3));
  geometry.setIndex(indices);
  return geometry;
}

const jets=pressureColumns(), bodyLines=strips(6,14);
const lightning=strips(2,4), embers=strips(8,1);
const sharedVertex=`
attribute vec3 shape;
uniform vec3 mount;
uniform float age, lengthWorld, widthWorld, burst, power, variant;
varying vec2 profile;
void project(vec3 p){gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}
`;
const jetVertex=sharedVertex+`
uniform vec2 jetPower,jetLength,jetAge;
varying vec3 jetNormal,jetView;
varying float nozzlePower;
void main(){
 float t=shape.x,a=shape.y,side=shape.z;
 float energy=side<0.0?jetPower.x:jetPower.y;
 float lengthScale=side<0.0?jetLength.x:jetLength.y;
 float pulseAge=side<0.0?jetAge.x:jetAge.y;
 float phase=t*18.0-pulseAge*8.0+side*2.37;
 float outline=mix(.82,1.18,smoothstep(0.0,.26,t))*pow(max(.002,1.0-t),.80);
 float irregular=1.0+sin(phase+a*3.0)*.20*smoothstep(.16,.60,t);
 float radius=widthWorld*outline*irregular*(.76+.24*lengthScale);
 vec3 radial=vec3(cos(a),sin(a),0.0);
 vec3 p=vec3(side*(mount.x+t*.052),mount.y+t*t*.065,mount.z-t*lengthWorld*max(.01,lengthScale));
 p+=radial*radius*vec3(1.0,.84,1.0);
 p.x+=sin(phase*.75)*t*.031;
 nozzlePower=energy;
 profile=vec2(t,a);
 jetNormal=mat3(modelViewMatrix)*radial;
 jetView=-(modelViewMatrix*vec4(p,1.0)).xyz;
 project(p);
}`;
const jetFragment=`
uniform vec3 hot,mainColor,edgeColor;
uniform float age,variant,fluxReady;
uniform sampler2D flux;
varying vec2 profile;
varying vec3 jetNormal,jetView;
varying float nozzlePower;
void main(){
 float t=profile.x,a=profile.y;
 float face=abs(dot(normalize(jetNormal),normalize(jetView)));
 vec2 flowUV=vec2(fract(t*mix(1.23,.94,variant)-age*mix(1.37,1.74,variant)),fract(a/6.2831853));
 vec4 art=mix(vec4(.42,.5,.3,.8),texture2D(flux,flowUV),fluxReady);
 float core=smoothstep(.16,.71,face)*(1.0-.19*t);
 float rimShape=smoothstep(.06,.58,face+.12*art.b);
 vec3 rim=mix(edgeColor,mainColor,rimShape);
 float highlight=core*.77+(art.r*.31+art.g*.10)*(.45+.55*core);
 vec3 col=mix(rim,hot,clamp(highlight,0.0,1.0));
 col=mix(col,hot,.30*pow(art.r,3.0)*pow(core,.7));
 float edges=1.0-smoothstep(.85,1.0,t);
 float heat=.82+.18*art.a;

 gl_FragColor=vec4(col,edges*nozzlePower*heat);
 #include <colorspace_fragment>
}`;

const forkVertex=sharedVertex+`
varying vec2 vDischarge;
void main(){
   float t=shape.x,e=shape.y,side=shape.z*2.0-1.0;
   float spread=mix(.32,.94,smoothstep(0.0,.86,t));
   float drift=.17+.60*t+.15*t*t;
   vec3 p=vec3(side*(mount.x+drift)-e*spread*.76,mount.y+.27+t*.15+e*spread*.65,
     mount.z-.11-lengthWorld*t*1.04);
   vDischarge=vec2(t,e*.5+.5);
   project(p);
}`;
const forkFragment=`
uniform sampler2D discharge;
uniform vec3 hot,mainColor;
uniform float age,power,atlasReady;
varying vec2 vDischarge;
float frameAlpha(float n,vec2 uv){
   vec2 tile=vec2(mod(n,4.0),3.0-floor(n*.25));
   return texture2D(discharge,(tile+mix(vec2(.013),vec2(.987),uv))*.25).a;
}
void main(){
   float frame=mod(age*15.0,16.0);
   float cur=frameAlpha(floor(frame),vDischarge);
   float next=frameAlpha(mod(floor(frame)+1.0,16.0),vDischarge);
   float path=max(cur*(1.0-.55*fract(frame)),next*(.23+.77*fract(frame)));
   vec3 col=mix(mainColor,hot,smoothstep(.24,.87,path));
   gl_FragColor=vec4(col,path*power*atlasReady);
   #include <colorspace_fragment>
}`;

const emberVertex=sharedVertex+`
uniform vec2 jetPower,jetAge;
varying vec2 vCinder;
varying float vLife;
void main(){
 float seed=shape.z,t=shape.x,e=shape.y;
 float side=mod(seed,2.0)*2.0-1.0;
 float progress=clamp((side<0.0?jetAge.x:jetAge.y)*(.60+.055*seed)+seed*.037,0.0,1.0);
 float streak=.17+.13*fract(seed*.339);
 float x=side*(mount.x+.02+progress*(.038+.045*seed));
 float y=mount.y+.022+progress*(.07+.018*seed);
 float z=mount.z-progress*.65-(1.0-t)*streak;
 vec3 p=vec3(x+e*.027,y+e*.026,z);
 vCinder=vec2(t,e*.5+.5);
 vLife=(side<0.0?jetPower.x:jetPower.y)*(1.0-smoothstep(.28,1.0,progress));
 project(p);
}`;
const emberFragment=`
uniform sampler2D cinder;
uniform vec3 hot,mainColor;
uniform float power,cinderReady;
varying vec2 vCinder;
varying float vLife;
void main(){
 vec4 brush=texture2D(cinder,vCinder);
 gl_FragColor=vec4(mix(mainColor,hot,brush.g),brush.a*power*vLife*cinderReady);
 #include <colorspace_fragment>
}`;
const linesVertex=sharedVertex+`
uniform float mode;
void main(){
 float t=shape.x,e=shape.y,i=shape.z;
 float side=mod(i,2.0)*2.0-1.0,branch=floor(i*.5);
 float taper=.25+.75*sin(t*3.14159);
 vec3 p,offset;
 float x=mount.x+.12+.077*branch;
 float sweep=sin(t*3.14159);
 p=vec3(side*(x+.105*sweep+.10*t),
   mount.y+.16+branch*.095+sweep*.18,mix(.73,mount.z+.065,t));
 offset=vec3(.44,.80,0.0)*(.069-.014*branch);
 profile=vec2(t,e);
 project(p+offset*e*taper);
}`;
const linesFragment=`
uniform vec3 hot,mainColor,edgeColor;
uniform float age,power,mode;
varying vec2 profile;
void main(){
 float t=profile.x,e=abs(profile.y);
 float point=smoothstep(0.0,.065,t)*(1.0-smoothstep(.73,1.0,t));
 float moving=.38+.62*pow(.5+.5*cos(t*15.0-age*24.0),3.0);
 vec3 color=mix(mainColor,hot,1.0-smoothstep(.29,.72,e));
 gl_FragColor=vec4(color,point*(1.0-smoothstep(.73,1.0,e))*power*moving);
 #include <colorspace_fragment>
}`;

export function createRearFx(id,garage=false){
  const truck=id==='monster-truck',root=new Group(),anchor=rearOutlets[id];
  const flow=authoredTexture(truck?'thunder-flow.png':'gold-flow.png');
  const arcAtlas=truck?authoredTexture('electric-forks.png'):null;
  const emberAtlas=garage?null:authoredTexture('cinder.png');
  const common={
    mount:{value:[anchor.x,anchor.y,anchor.z]},age:{value:0},lengthWorld:{value:1},
    widthWorld:{value:anchor.radius*.91},burst:{value:0},variant:{value:Number(truck)},
    jetPower:{value:[0,0]},jetAge:{value:[1,1]},jetLength:{value:[0,0]},
    flux:flow.texture,fluxReady:flow.loaded,
    ...(arcAtlas?{discharge:arcAtlas.texture,atlasReady:arcAtlas.loaded}:{}),
    ...(emberAtlas?{cinder:emberAtlas.texture,cinderReady:emberAtlas.loaded}:{}),
    hot:{value:truck?[.79,.97,1]:[1,.91,.59]},
    mainColor:{value:truck?[.014,.48,1]:[1,.26,.012]},
    edgeColor:{value:truck?[.015,.11,.85]:[.91,.08,.003]},
  };
  function attach(geometry,vertexShader,fragmentShader,order,mode=0,side=2){
    const material=new ShaderMaterial({
      uniforms:{...common,power:{value:0},mode:{value:mode}},
      vertexShader,fragmentShader,side,transparent:true,depthWrite:false,
      forceSinglePass:true,toneMapped:false,
    });
    const mesh=new Mesh(geometry,material);
    mesh.userData.sharedAsset=true;
    mesh.frustumCulled=false;
    mesh.renderOrder=order;
    root.add(mesh);
    return mesh;
  }
  const flameLength={value:truck?.76:.67};
  const jet=garage?null:attach(jets,jetVertex,jetFragment,25,0,0);
  if(jet)jet.material.uniforms.lengthWorld=flameLength;
  const contour=attach(bodyLines,linesVertex,linesFragment,26,4);
  const arcs=garage||!truck?null:attach(lightning,forkVertex,forkFragment,27);
  const cinders=garage?null:attach(embers,emberVertex,emberFragment,27);
  const events=garage?null:createExhaustEvents();
  const power=(mesh,value)=>{
    if(!mesh)return;
    mesh.visible=value>.032;
    mesh.material.uniforms.power.value=value;
  };
  root.visible=false;
  return {
    root,
    get exhaust(){return events;},
    resetExhaust(sequence,launch,speed,throttle){events?.reset(sequence,launch,speed,throttle);},
    update(boost,accent,time,{drive=0,burst=0,distance=8.6,speed=0,throttle=0,sequence=0,launch=0,dt=0}={}){
      const reduced=motionPreference?.matches??false;
      const thrust=clamp(drive,0,1),active=clamp(boost,0,1),attack=clamp(burst,0,1);
      events?.update(dt,{speed,throttle,sequence,launch,boost:Math.max(active,attack),reduced});
      const left=events?.left,right=events?.right;
      const flame=Math.max(left?.energy||0,right?.energy||0);
      const contourPower=garage?accent*.76:Math.min(.98,attack+active*.53);
      const arcPower=Math.min(reduced?.40:.96,thrust*.16+active*.83+attack*.51);
      if(left){
        const jp=common.jetPower.value,jl=common.jetLength.value,ja=common.jetAge.value;
        jp[0]=left.energy;jp[1]=right.energy;
        jl[0]=left.length;jl[1]=right.length;
        ja[0]=left.age;ja[1]=right.age;
        flameLength.value=(truck?.76:.67)*(events.event==='nitro'?1.16:1);
      }
      root.visible=Math.max(flame,contourPower,arcs?arcPower:0)>.032;
      if(!root.visible)return;
      const screen=clamp(1+(distance-9)*.021,.95,1.11);
      common.age.value=reduced?0:time;
      common.lengthWorld.value=(.28+thrust*1.35+active*2.57+attack*.25)*screen;
      power(jet,flame);
      power(cinders,reduced?0:flame*.81);
      power(contour,contourPower);
      power(arcs,arcPower);
    },
    dispose(){for(const mesh of root.children)mesh.material.dispose();},
  };
}
