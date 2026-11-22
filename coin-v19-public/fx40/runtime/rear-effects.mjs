import {d as BufferGeometry,u as BufferAttribute,G as Group,bt as Mesh,
  Bn as ShaderMaterial,Yn as Texture} from './BufferGeometryUtils-B1nfbDRm.js';
import {clamp} from './vehicle-feel.mjs';
import {createTigerPounce} from './tiger-pounce.mjs';

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
  const shape=[],positions=[],indices=[],rings=20,sides=8,stride=sides+1;
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

const jets=pressureColumns(), rails=strips(4,12), bodyLines=strips(6,14);
const lightning=strips(2,4), embers=strips(8,1), pulse=strips(2,14);
const sharedVertex=`
attribute vec3 shape;
uniform vec3 mount;
uniform float age, lengthWorld, widthWorld, burst, power, variant;
varying vec2 profile;
void project(vec3 p){gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}
`;
const jetVertex=sharedVertex+`
varying vec3 jetNormal,jetView;
void main(){
 float t=shape.x,a=shape.y,side=shape.z;
 float phase=t*20.0-age*24.0+side*1.7;
 float taper=1.0-smoothstep(.46,1.0,t);
 float flame=(.79+.22*sin(t*3.14159))*pow(max(.001,1.0-t),.70);
 flame*=1.0+(sin(phase+a*3.0)*.13+cos(phase*1.69-a*4.0)*.047)*smoothstep(0.0,.31,t);
 float column=mix(.78,1.0,smoothstep(0.0,.17,t))*taper*(.97+.04*cos(t*34.0-age*22.0));
 float radius=widthWorld*mix(flame,column,variant);
 vec3 radial=vec3(cos(a),sin(a),0.0);
 vec3 p=vec3(side*(mount.x+t*mix(.16,.12,variant)),
   mount.y+t*mix(.17,.09,variant),mount.z-t*lengthWorld);
 p+=radial*radius*vec3(1.0,.82,1.0);
 p.x+=sin(phase*.47)*t*(1.0-variant)*.047;
 profile=vec2(t,a);
 jetNormal=mat3(modelViewMatrix)*radial;
 jetView=-(modelViewMatrix*vec4(p,1.0)).xyz;
 project(p);
}`;
const jetFragment=`
uniform vec3 hot,mainColor,edgeColor;
uniform float age,power,variant,fluxReady,boostPower;
uniform sampler2D flux;
varying vec2 profile;
varying vec3 jetNormal,jetView;
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
 float gate=clamp(.88+boostPower*.12,0.0,1.0);
 gl_FragColor=vec4(col,edges*power*heat*gate);
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
varying vec2 vCinder;
varying float vLife;
void main(){
 float seed=shape.z,t=shape.x,e=shape.y;
 float side=mod(seed,2.0)*2.0-1.0;
 float progress=fract(age*(2.1+.17*seed)+seed*.371);
 float streak=.17+.13*fract(seed*.339);
 float x=side*(mount.x+.05+progress*(.16+.12*seed));
 float y=mount.y+.045+progress*(.08+.03*seed);
 float z=mount.z-progress*(.82+lengthWorld*.45)-(1.0-t)*streak;
 vec3 p=vec3(x+e*.027,y+e*.026,z);
 vCinder=vec2(t,e*.5+.5);
 vLife=1.0-smoothstep(.39,1.0,progress);
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
 if(mode>3.5){
   float x=mount.x+.12+.077*branch;
   float sweep=sin(t*3.14159);
   p=vec3(side*(x+.105*sweep+.10*t),
     mount.y+.16+branch*.095+sweep*.18,mix(.73,mount.z+.065,t));
   offset=vec3(.44,.80,0.0)*(.069-.014*branch);
 }else if(mode>2.5){
   // Two shallow arcs, anchored behind the bumper, visible below the car.
   float angle=mix(.17,2.97,t)+i*3.14159;
   float radius=.34+(1.0-burst)*1.55;
   p=vec3(cos(angle)*radius*.9,mount.y-.30,mount.z-.54+sin(angle)*radius*.61);
   offset=vec3(cos(angle),0.0,sin(angle))*.030;
 }else{
   p=vec3(side*(mount.x+.14+branch*.21+t*.63),mount.y-.17+branch*.10+t*.12,
     mount.z-.15-t*lengthWorld*(.88+branch*.09));
   offset=vec3(.85,.38,0.0)*(.057-branch*.016);
 }
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
 float moving=mode<.5||mode>3.5?.38+.62*pow(.5+.5*cos(t*15.0-age*24.0),3.0):1.0;
 vec3 color=mix(mainColor,hot,1.0-smoothstep(.29,.72,e));
 gl_FragColor=vec4(color,point*(1.0-smoothstep(.73,1.0,e))*power*moving);
 #include <colorspace_fragment>
}`;

export function createRearFx(id,garage=false){
  const truck=id==='monster-truck',root=new Group(),anchor=rearOutlets[id];
  const flow=authoredTexture(truck?'thunder-flow.png':'gold-flow.png');
  const arcAtlas=truck?authoredTexture('electric-forks.png'):null;
  const emberAtlas=truck?null:authoredTexture('cinder.png');
  const common={
    mount:{value:[anchor.x,anchor.y,anchor.z]},age:{value:0},lengthWorld:{value:1},
    widthWorld:{value:.1},burst:{value:0},variant:{value:Number(truck)},boostPower:{value:0},
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
  const jet=garage?null:attach(jets,jetVertex,jetFragment,25,0,0);
  const streaks=garage?null:attach(rails,linesVertex,linesFragment,24);
  const contour=attach(bodyLines,linesVertex,linesFragment,26,4);
  const arcs=garage||!truck?null:attach(lightning,forkVertex,forkFragment,27);
  const cinders=garage||truck?null:attach(embers,emberVertex,emberFragment,27);
  const shock=garage?null:attach(pulse,linesVertex,linesFragment,23,3);
  const pounce=garage||truck?null:createTigerPounce();
  if(pounce)root.add(pounce.root);
  let sequenceSeen=0,pounceAge=Infinity;
  const power=(mesh,value)=>{
    if(!mesh)return;
    mesh.visible=value>.032;
    mesh.material.uniforms.power.value=value;
  };
  root.visible=false;
  return {
    root,
    ready:pounce?.ready??Promise.resolve(),
    get pounceAge(){return pounce?.root.visible?pounceAge:null;},
    clearPounce(){pounceAge=Infinity;pounce?.update(pounceAge,false);},
    update(boost,accent,time,{drive=0,burst=0,distance=8.6,low=false,sequence=0,dt=0,reviewRate=1}={}){
      const reduced=motionPreference?.matches??false;
      const thrust=clamp(drive,0,1),active=clamp(boost,0,1);
      const attack=clamp(burst,0,1);
      if(pounce&&sequence!==sequenceSeen){sequenceSeen=sequence;pounceAge=sequence>0?0:Infinity;}
      pounceAge+=dt*reviewRate;
      pounce?.update(pounceAge,reduced);
      root.visible=Math.max(thrust,active,accent,attack)>.025||pounce?.root.visible===true;
      if(!root.visible)return;
      const screen=clamp(1+(distance-9)*.021,.95,1.11);
      common.age.value=reduced?0:time;
      common.burst.value=attack;
      common.boostPower.value=active;
      common.lengthWorld.value=(.28+thrust*(1.35)+active*(truck?2.57:2.15)+attack*.25)*screen;
      common.widthWorld.value=(anchor.radius*(.79+thrust*.55)+active*(truck?.205:.158))*screen;
      power(jet,clamp(thrust*1.13+active*.91,0,1));
      power(streaks,Math.min(.91,active*.82+attack*.29));
      power(contour,garage?accent*.76:Math.min(.98,attack*1.00+active*.53));
      power(arcs,Math.min(reduced?.40:.96,thrust*.16+active*.83+attack*.51));
      power(cinders,reduced?0:Math.min(low?.54:.74,thrust*.10+active*.44+attack*.40));
      power(shock,attack*(reduced?.12:low?.44:.65));
    },
    dispose(){
      for(const mesh of root.children)if(mesh!==pounce?.root)mesh.material.dispose();
      pounce?.dispose();
    },
  };
}
