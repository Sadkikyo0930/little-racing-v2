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
const plumeGeometry=tubes(12), jetGeometry=tubes(8), streakGeometry=ribbons(2,18), markGeometry=ribbons(3,18);
const arcGeometry=ribbons(5,22), shockGeometry=new RingGeometry(.89,1,36);

const plumeVertex=`
attribute vec3 shape;
uniform vec3 uMount;
uniform float uTime,uLength,uWidth,uLayer,uTruck,uBurst;
varying vec3 vShape;
varying float vLight;
void main(){
 float t=shape.x,a=shape.y,side=shape.z;
 float phase=uTime*(12.0+4.0*uTruck)+side*1.7;
 float lobes=sin(t*21.0-phase+a*2.0)*.17+sin(a*3.0+t*34.0+phase*.7)*.045;
 float open=smoothstep(0.0,.16,t);
 float envelope=mix(.70,1.0,open)*pow(max(.002,1.0-t),.64+.16*uLayer);
 float radius=uWidth*envelope*(1.0+open*lobes)*(1.20-uLayer*.50);
 float curl=sin(t*8.1-phase*.55)*open*t;
 vec3 pos=vec3(side*uMount.x+cos(a)*radius+side*t*(.17+.12*uTruck)+curl*.13,
   uMount.y+sin(a)*radius+t*t*(.27+.14*uTruck)+sin(t*14.0+phase)*.105*t,
   uMount.z-t*uLength*(1.0-uLayer*.27));
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
 vec3 color=mix(uShell,uEdge,smoothstep(.35,1.0,t));
 float filament=pow(.5+.5*cos(t*40.0-uTime*29.0+a*3.0),4.0);
 color=mix(color,uHot,(.22+.72*uLayer)*(.67+.33*flow)*(1.0-.29*t)+filament*.13);
 color*=.74+vLight*.22+bands*.23+uBurst*.12;
 float a0=(1.0-smoothstep(.48,1.0,t))*uPower*(1.0-uLayer*.29);
 a0*=mix(.73+.23*flow,.81+.16*bands,uLayer);
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
 float pressure=.92+.08*cos(t*26.0-uTime*15.0);
 float tip=1.0-smoothstep(.62,1.0,t);
 float collar=mix(.72,1.0,smoothstep(0.0,.11,t));
 float r=uWidth*collar*tip*pressure*(1.14-uLayer*.52);
 vec3 p=vec3(side*(uMount.x+.11*t)+cos(a)*r,
   uMount.y+sin(a)*r*.83+t*.16,uMount.z-t*uLength*(1.0-uLayer*.13));
 vJet=vec2(t,a);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
}`;
const jetFragment=`
uniform vec3 uHot,uShell,uEdge;
uniform float uTime,uPower,uLayer;
varying vec2 vJet;
void main(){
 float t=vJet.x;
 float pressure=pow(.5+.5*cos(t*39.0-uTime*22.0),5.0);
 float rail=pow(.5+.5*cos(vJet.y*4.0+t*9.0-uTime*9.0),5.0);
 vec3 col=mix(uShell,uEdge,t*.55);
 col=mix(col,uHot,clamp(.13+.59*uLayer+.27*pressure+.13*rail,0.0,.96));
 float alpha=(1.0-smoothstep(.63,1.0,t))*uPower*(.68+.23*pressure);
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
   p=vec3(sgn*(uMount.x+.24+i*.103)+t*.22*sgn+(jump-.5)*.82*margin+edge*(.035+.02*uBurst),
     uMount.y+.16+i*.052+t*.34+(jump-.5)*.49*margin+edge*.029,
     uMount.z-.04-t*uLength*(.70+i*.054));
 }else if(uMode>.5){
   float swing=(t-.52)*(t-.52);
   p=vec3((i-1.0)*.37+t*.83+swing*.54+edge*(.025+.047*sin(t*3.14159)),
     uMount.y+.20+t*.69+i*.055+edge*.031,
     uMount.z-.76-t*1.68-i*.12);
 }else{
   p=vec3(sgn*(uMount.x+.27+1.04*t)+edge*.052,
     uMount.y+.085+t*.22+edge*.048,
     uMount.z+.22-t*uLength*.97);
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
  const hot=new Color(truck?0xe7f6ff:0xffe27f);
  const shell=new Color(truck?0x247eef:0xf57b1c);
  const edge=new Color(truck?0x1748bc:0xe44b0c);
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
    const screen=clamp(.88+distance*.015,.90,1.145);
    u.uTime.value=time;
    u.uBurst.value=burst;
    u.uPower.value=clamp(.70*thrust+.76*active,0,.94);
    u.uWidth.value=(anchor.radius+.145*thrust+(truck?.22:.14)*active)*screen;
    u.uLength.value=(.56+(truck?1.62:1.75)*thrust+(truck?1.24:1.32)*active)*screen;
    if(outer){outer.visible=u.uPower.value>.025;inner.visible=outer.visible;}
    side.material.uniforms.uPower.value=garage?accent*.72:Math.min(.74,active*.69+burst*.17);
    marks.material.uniforms.uPower.value=truck?Math.max(.30*thrust,Math.min(.90,accent+burst*.56)):Math.min(.93,accent*.93);
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
