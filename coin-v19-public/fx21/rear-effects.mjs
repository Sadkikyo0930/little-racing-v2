import {d as BufferGeometry, u as BufferAttribute, G as Group, bt as Mesh,
  Bn as ShaderMaterial, xt as MeshBasicMaterial, Mn as RingGeometry, y as Color} from './BufferGeometryUtils-B1nfbDRm.js';
import {clamp} from './vehicle-feel.mjs';
const FrontSide=0, DoubleSide=2, NormalBlending=1;
const attribute=values=>new BufferAttribute(new Float32Array(values),3);

// Rear apertures measured from the transformed Body mesh. +Z is forward.
export const rearOutlets=Object.freeze({
  'tiger-kart':Object.freeze({x:.49,y:.58,z:-1.325,radius:.17}),
  'monster-truck':Object.freeze({x:.65,y:.89,z:-1.248,radius:.215}),
});

function tubes(sides){
  const xyz=[], meta=[], indices=[];
  const rows=20, stride=sides+1;
  for(const sign of [-1,1]){
    const start=xyz.length/3;
    for(let i=0;i<=rows;i++)for(let j=0;j<=sides;j++){
      const a=Math.PI*2*j/sides, t=i/rows;
      xyz.push(Math.cos(a),Math.sin(a),t);
      meta.push(t,a,sign);
    }
    for(let i=0;i<rows;i++)for(let j=0;j<sides;j++){
      const a=start+i*stride+j,b=a+stride;
      indices.push(a,b,a+1,a+1,b,b+1);
    }
  }
  const g=new BufferGeometry();
  g.setAttribute('position',attribute(xyz));
  g.setAttribute('shape',attribute(meta));
  g.setIndex(indices);
  return g;
}
function ribbons(lines,steps){
  const uv=[], p=[], idx=[];
  for(let line=0;line<lines;line++){
    const first=p.length/3;
    for(let i=0;i<=steps;i++)for(const side of [-1,1]){
      uv.push(i/steps,side,line);
      p.push(0,0,0);
    }
    for(let i=0;i<steps;i++){
      const a=first+i*2;
      idx.push(a,a+1,a+2,a+1,a+3,a+2);
    }
  }
  const g=new BufferGeometry();
  g.setAttribute('position',attribute(p));
  g.setAttribute('shape',attribute(uv));
  g.setIndex(idx);
  return g;
}
const plumeGeometry=tubes(12), jetGeometry=tubes(8), streakGeometry=ribbons(6,18), markGeometry=ribbons(3,18);
const arcGeometry=ribbons(6,24), shockGeometry=new RingGeometry(.89,1,36);

const plumeVertex=`
attribute vec3 shape;
uniform vec3 uMount;
uniform float uTime,uLength,uWidth,uLayer,uTruck,uBurst;
varying vec3 vShape;
varying float vLight;
void main(){
 float t=shape.x,a=shape.y,side=shape.z;
 float phase=uTime*(12.0+4.0*uTruck)+side*1.7;
 float lobes=sin(t*24.0-phase+a*3.0)*.13+sin(a*5.0+t*38.0+phase*.7)*.055;
 float open=smoothstep(0.0,.16,t);
 float envelope=mix(.64,1.0,open)*pow(max(.002,1.0-t),.47+.10*uLayer);
 float radius=uWidth*envelope*(1.0+open*lobes)*(1.16-uLayer*.57);
 float curl=sin(t*8.1-phase*.55)*open*t;
 vec3 pos=vec3(side*uMount.x+cos(a)*radius+side*t*(.17+.12*uTruck)+curl*.13,
   uMount.y+sin(a)*radius+t*t*.33+sin(t*14.0+phase)*.071*t,
   uMount.z-t*uLength*(1.0-uLayer*.15));
 vShape=vec3(t,a,side);
 vLight=.66+.34*sin(a+phase*.25+t*7.0);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
}`;
const plumeFragment=`
uniform vec3 uHot,uShell,uEdge;
uniform float uTime,uPower,uLayer,uTruck,uBurst;
varying vec3 vShape;
varying float vLight;
void main(){
 float t=vShape.x,a=vShape.y;
 float flow=.5+.5*sin(t*24.0-uTime*25.0+sin(a*2.0+t*9.0)+vShape.z);
 float bands=.5+.5*sin(t*(21.0+uTruck*12.0)-uTime*20.0+a*(2.0+uTruck*2.0));
 float filament=pow(.5+.5*cos(a*5.0+t*9.0+sin(t*26.0-uTime*17.0)*.8),5.0);
 vec3 color=mix(uShell,uEdge,smoothstep(.25,1.0,t));
 color=mix(color,uHot,clamp(.13+.76*uLayer+filament*.24+.07*flow,0.0,1.0));
 color*=.86+vLight*.18+bands*.10+uBurst*.10;
 float a0=(1.0-smoothstep(.54,1.0,t))*uPower;
 a0*=mix(.69+.29*filament,.91+.09*bands,uLayer);
 gl_FragColor=vec4(color,a0);
 #include <colorspace_fragment>
}`;
// The truck uses a faceted pressure column with traveling compression bands.
const jetVertex=`
attribute vec3 shape;
uniform vec3 uMount;
uniform float uTime,uLength,uWidth,uLayer;
varying vec2 vJet;
void main(){
 float t=shape.x,a=shape.y,side=shape.z;
 float pressure=.93+.07*cos(t*24.0-uTime*15.0);
 float tip=1.0-smoothstep(.52,1.0,t);
 float collar=mix(.72,1.0,smoothstep(0.0,.11,t));
 float r=uWidth*collar*tip*pressure*(1.14-uLayer*.56);
 vec3 p=vec3(side*(uMount.x+.11*t)+cos(a)*r,
   uMount.y+sin(a)*r*.81+t*.27,uMount.z-t*uLength*(1.0-uLayer*.10));
 vJet=vec2(t,a);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
}`;
const jetFragment=`
uniform vec3 uHot,uShell,uEdge;
uniform float uTime,uPower,uLayer;
varying vec2 vJet;
void main(){
 float t=vJet.x;
 float pressure=pow(.5+.5*cos(t*34.0-uTime*20.0),4.0);
 float rail=pow(.5+.5*cos(vJet.y*4.0+t*4.0-uTime*7.0),6.0);
 vec3 col=mix(uShell,uEdge,t*.55);
 col=mix(col,uHot,clamp(.06+.73*uLayer+.15*pressure+.17*rail,0.0,1.0));
 float alpha=(1.0-smoothstep(.65,1.0,t))*uPower*mix(.75+.17*rail,.94+.06*pressure,uLayer);
 gl_FragColor=vec4(col,alpha);
 #include <colorspace_fragment>
}`;
const ribbonVertex=`
attribute vec3 shape;
uniform vec3 uMount;
uniform float uTime,uLength,uPower,uMode,uBurst;
varying vec2 vShape;
float hash(float n){return fract(sin(n*78.233)*43758.5453);}
void main(){
 float t=shape.x,edge=shape.y,i=shape.z,sgn=mod(i,2.0)*2.0-1.0;
 vec3 p;
 if(uMode>1.5){
   float tick=uTime*13.0;
   float seed=mod(floor(t*11.0),19.0)+i*21.0;
   float jump=mix(hash(seed+floor(tick)*11.0),hash(seed+(floor(tick)+1.0)*11.0),smoothstep(.18,.82,fract(tick)));
   float margin=sin(t*3.14159);
   float strand=floor(i*.5);
   p=vec3(sgn*(uMount.x+(.22+strand*.16)*t)+t*.31*sgn+(jump-.5)*1.04*margin+edge*(.042+.025*uBurst),
     uMount.y+.10+strand*.09*t+t*.34+(jump-.5)*.64*margin+edge*.035,
     uMount.z-.07-t*uLength*(.72+strand*.11));
 }else if(uMode>.5){
   float swing=(t-.52)*(t-.52);
   p=vec3((i-1.0)*.37+t*.83+swing*.54+edge*(.025+.047*sin(t*3.14159)),
     uMount.y+.20+t*.69+i*.055+edge*.031,
     uMount.z-.76-t*1.68-i*.12);
 }else{
   float strand=floor(i*.5);
   p=vec3(sgn*(uMount.x+.16+(strand*.18+.69)*t)+edge*.028,
     uMount.y+.061+strand*.055+t*.20+edge*.025,
     uMount.z+.12-t*uLength*(.90+strand*.07));
 }
 vShape=vec2(t,edge);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
}`;
const ribbonFragment=`
uniform vec3 uHot,uShell;
uniform float uTime,uPower,uMode;
varying vec2 vShape;
void main(){
 float t=vShape.x,r=abs(vShape.y);
 float core=1.0-smoothstep(.07,.65,r);
 float alpha=(1.0-smoothstep(.62,1.0,r))*sin(t*3.14159);
 float streak=uMode<.5?.48+.52*pow(.5+.5*cos(t*13.0-uTime*21.0),2.0):1.0;
 gl_FragColor=vec4(mix(uShell,uHot,core),alpha*uPower*streak);
 #include <colorspace_fragment>
}`;

export function createRearFx(id, garage=false){
  const truck=id==='monster-truck', root=new Group();
  const anchor=rearOutlets[id];
  const hot=new Color(truck?0xebfcff:0xfff4c6);
  const shell=new Color(truck?0x0089ff:0xffa019);
  const edge=new Color(truck?0x1250ee:0xfa4b08);
  const uniforms={uMount:{value:[anchor.x,anchor.y,anchor.z]},uHot:{value:hot},uShell:{value:shell},
    uEdge:{value:edge},uTime:{value:0},uLength:{value:1},uWidth:{value:1},uTruck:{value:+truck},
    uPower:{value:0},uBurst:{value:0}};
  const materials=[];
  function attach(geometry,vertexShader,fragmentShader,extra,blend,order){
    const material=new ShaderMaterial({uniforms:{...uniforms,...extra},vertexShader,fragmentShader,side:DoubleSide,
      forceSinglePass:true,transparent:true,depthWrite:false,blending:blend,toneMapped:false});
    materials.push(material);
    const mesh=new Mesh(geometry,material);
    mesh.userData.sharedAsset=true;mesh.frustumCulled=false;mesh.renderOrder=order;
    root.add(mesh);
    return mesh;
  }
  const geometry=truck?jetGeometry:plumeGeometry;
  const vertex=truck?jetVertex:plumeVertex, fragment=truck?jetFragment:plumeFragment;
  const outer=garage?null:attach(geometry,vertex,fragment,{uLayer:{value:0}},NormalBlending,25);
  const inner=garage?null:attach(geometry,vertex,fragment,{uLayer:{value:1}},NormalBlending,26);
  const side=attach(streakGeometry,ribbonVertex,ribbonFragment,{uMode:{value:0},uPower:{value:0}},NormalBlending,27);
  const marks=attach(truck?arcGeometry:markGeometry,ribbonVertex,ribbonFragment,
    {uMode:{value:truck?2:1},uPower:{value:0}},NormalBlending,28);
  const ripple=new Mesh(shockGeometry,new MeshBasicMaterial({
    color:shell,transparent:true,opacity:0,blending:NormalBlending,side:FrontSide,depthWrite:false,toneMapped:false}));
  if(!garage){
    materials.push(ripple.material);
    ripple.rotation.x=-Math.PI/2;ripple.position.set(0,.22,anchor.z-.56);
    ripple.userData.sharedAsset=true;ripple.renderOrder=23;root.add(ripple);
  } else ripple.material.dispose();
  root.visible=false;

  function update(boost,accent,time,{drive=0,burst=0,distance=8.6,low=false}={}){
    const u=uniforms, thrust=clamp(drive,0,1), active=clamp(boost,0,1);
    root.visible=Math.max(active,accent,thrust,burst)>.024;
    if(!root.visible)return;
    const screen=clamp(1+(distance-9)*.038,.96,1.27);
    u.uTime.value=time;
    u.uBurst.value=burst;
    u.uPower.value=clamp(.88*thrust+.80*active,0,.99);
    u.uWidth.value=(anchor.radius+(truck?.226:.172)*thrust+(truck?.21:.12)*active)*screen;
    u.uLength.value=(.43+(truck?2.01:2.48)*thrust+(truck?1.91:2.12)*active)*screen;
    if(outer){outer.visible=u.uPower.value>.025;inner.visible=outer.visible;}
    side.material.uniforms.uPower.value=garage?accent*.72:Math.min(.72,thrust*(truck?.11:.19)+active*.56+burst*.14);
    marks.material.uniforms.uPower.value=truck?Math.max(.36*thrust,Math.min(.97,accent+boost*.31+burst*.55)):Math.min(.90,accent*.96);
    marks.visible=marks.material.uniforms.uPower.value>.035;
    side.visible=side.material.uniforms.uPower.value>.035;
    if(!garage){
      ripple.visible=burst>.045;
      ripple.material.opacity=burst*(low?.15:truck?.20:.28);
      ripple.scale.setScalar(.70+(1-burst)*(truck?1.65:1.88));
    }
  }
  return {root,update,dispose(){for(const m of materials)m.dispose();}};
}
