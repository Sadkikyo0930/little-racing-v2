import {d as BufferGeometry,u as BufferAttribute,G as Group,bt as Mesh,
  Bn as ShaderMaterial} from './BufferGeometryUtils-B1nfbDRm.js';
import {clamp} from './vehicle-feel.mjs';

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

const jets=strips(4,22), rails=strips(8,12), claws=strips(3,14);
const lightning=strips(6,10), pulse=strips(2,14);
const sharedVertex=`
attribute vec3 shape;
uniform vec3 mount;
uniform float age, lengthWorld, widthWorld, burst, power, variant;
varying vec2 profile;
void project(vec3 p){gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}
`;
const jetVertex=sharedVertex+`
void main(){
 float t=shape.x,e=shape.y;
 float side=mod(shape.z,2.0)*2.0-1.0,cross=step(2.0,shape.z);
 float motion=t*18.0-age*29.0+side*1.5;
 float flame=pow(max(0.0,1.0-t),.88)*(1.0+.15*sin(motion)+.07*cos(motion*2.2));
 float column=(1.0-smoothstep(.64,1.0,t))*(.92+.08*cos(t*22.0-age*20.0));
 float width=mix(flame,column,variant)*widthWorld;
 float heat=sin(t*9.0-age*11.0+side)*t*(1.0-variant)*.075;
 vec3 p=vec3(side*(mount.x+t*mix(.165,.078,variant))+heat,
   mount.y+t*mix(.13,.095,variant),mount.z-t*lengthWorld);
 p+=vec3(.94-cross*.76,.34+cross*.71,0.0)*e*width;
 profile=vec2(t,e);
 project(p);
}`;
const jetFragment=`
uniform vec3 hot,mainColor,edgeColor;
uniform float age,power,variant;
varying vec2 profile;
void main(){
 float t=profile.x,e=abs(profile.y);
 float shock=pow(.5+.5*cos(t*40.0-age*24.0),7.0);
 float fiber=.5+.5*cos(e*31.0+t*18.0-age*28.0);
 float spine=1.0-smoothstep(.20,.58,e+.095*t);
 float shade=clamp(spine*.93+mix(fiber*.14,shock*.23,variant),0.0,1.0);
 vec3 color=mix(mix(mainColor,edgeColor,smoothstep(.56,.94,e)),hot,shade);
 float edge=1.0-smoothstep(.83,1.0,e);
 float tip=1.0-smoothstep(.83,1.0,t);
 gl_FragColor=vec4(color,edge*tip*power);
 #include <colorspace_fragment>
}`;
const linesVertex=sharedVertex+`
uniform float mode;
float hash(float x){return fract(sin(x*37.71)*43758.54);}
void main(){
 float t=shape.x,e=shape.y,i=shape.z;
 float side=mod(i,2.0)*2.0-1.0,branch=floor(i*.5);
 float taper=.25+.75*sin(t*3.14159);
 vec3 p,offset;
 if(mode>2.5){
   // Two shallow arcs, anchored behind the bumper, visible below the car.
   float angle=mix(.17,2.97,t)+i*3.14159;
   float radius=.34+(1.0-burst)*1.55;
   p=vec3(cos(angle)*radius*.9,mount.y-.30,mount.z-.54+sin(angle)*radius*.61);
   offset=vec3(cos(angle),0.0,sin(angle))*.030;
 }else if(mode>1.5){
   float key=floor(age*14.0),point=floor(t*10.0+.08);
   float start=branch==0.0?0.0:.10+.16*(branch-1.0);
   float along=mix(start,branch==0.0?1.0:.94,t);
   float spread=sin(t*3.14159)*(.48+.09*branch);
   float jump=(hash(key*13.0+point*7.0+i*3.0)-.5)*spread;
   float reach=branch*pow(t,.88)*.64;
   p=vec3(side*(mount.x+.12+along*.16+reach)+jump,
     mount.y+.09+along*.15+reach*.42-jump*.76,mount.z-.035-along*lengthWorld*.96);
   offset=vec3(.78,.47,0.0)*(.034-.006*branch);
 }else if(mode>.5){
   float x=1.01+i*.258;
   p=vec3(x+t*.91-t*t*.40,mount.y+.16+t*.98,mount.z-.35-t*.68-i*.069);
   offset=vec3(.74,-.68,0.0)*.092;
 }else if(branch<2.0){
   // Contour strips run aft beside the rear body panels and end at the nozzle plane.
   p=vec3(side*(mount.x+mix(.12,.24,t)+branch*.066),mount.y+.15+branch*.08+t*.13,
     mix(.42,mount.z+.027,t));
   offset=vec3(.64,.71,0.0)*.029;
 }else{
   float r=branch-2.0;
   p=vec3(side*(mount.x+.10+r*.22+t*.63),mount.y-.19+r*.075+t*.11,
     mount.z-.15-t*lengthWorld*(1.08+r*.10));
   offset=vec3(.85,.38,0.0)*(.035-r*.009);
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
 float moving=mode<.5?.32+.68*pow(.5+.5*cos(t*20.0-age*25.0),4.0):1.0;
 vec3 color=mix(mainColor,hot,1.0-smoothstep(.29,.72,e));
 gl_FragColor=vec4(color,point*(1.0-smoothstep(.73,1.0,e))*power*moving);
 #include <colorspace_fragment>
}`;

export function createRearFx(id,garage=false){
  const truck=id==='monster-truck',root=new Group(),anchor=rearOutlets[id];
  const common={
    mount:{value:[anchor.x,anchor.y,anchor.z]},age:{value:0},lengthWorld:{value:1},
    widthWorld:{value:.1},burst:{value:0},variant:{value:Number(truck)},
    hot:{value:truck?[.79,.97,1]:[1,.91,.59]},
    mainColor:{value:truck?[.014,.48,1]:[1,.26,.012]},
    edgeColor:{value:truck?[.015,.11,.85]:[.91,.08,.003]},
  };
  function attach(geometry,vertexShader,fragmentShader,order,mode=0){
    const material=new ShaderMaterial({
      uniforms:{...common,power:{value:0},mode:{value:mode}},
      vertexShader,fragmentShader,side:2,transparent:true,depthWrite:false,
      forceSinglePass:true,toneMapped:false,
    });
    const mesh=new Mesh(geometry,material);
    mesh.userData.sharedAsset=true;
    mesh.frustumCulled=false;
    mesh.renderOrder=order;
    root.add(mesh);
    return mesh;
  }
  const jet=garage?null:attach(jets,jetVertex,jetFragment,25);
  const streaks=attach(rails,linesVertex,linesFragment,24);
  const accentStrips=attach(truck?lightning:claws,linesVertex,linesFragment,26,truck?2:1);
  const shock=garage?null:attach(pulse,linesVertex,linesFragment,23,3);
  const power=(mesh,value)=>{
    if(!mesh)return;
    mesh.visible=value>.032;
    mesh.material.uniforms.power.value=value;
  };
  root.visible=false;
  return {root,update(boost,accent,time,{drive=0,burst=0,distance=8.6,low=false}={}){
    const thrust=clamp(drive,0,1),active=clamp(boost,0,1);
    const attack=clamp(burst,0,1);
    root.visible=Math.max(thrust,active,accent,attack)>.025;
    if(!root.visible)return;
    const screen=clamp(1+(distance-9)*.025,.94,1.12);
    common.age.value=time;
    common.burst.value=attack;
    common.lengthWorld.value=(.28+thrust*(truck?1.12:1.34)+active*(truck?2.31:2.49)+attack*.29)*screen;
    common.widthWorld.value=(anchor.radius*(.69+thrust*.26)+active*(truck?.10:.051))*screen;
    power(jet,clamp(thrust*1.11+active*.92,0,1));
    power(streaks,garage?accent*.62:Math.min(.94,active*.85+attack*.31));
    power(accentStrips,truck?Math.min(.92,active*.79+attack*.42):Math.min(.98,accent*2.05));
    power(shock,attack*(low?.42:.66));
  },dispose(){
    for(const mesh of root.children)mesh.material.dispose();
  }};
}
