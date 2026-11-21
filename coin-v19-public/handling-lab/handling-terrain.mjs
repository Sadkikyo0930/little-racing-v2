import {Vector3} from './assets/vendor/three.module.js';
import {groundTypes,clamp} from './assets/vehicle-feel.mjs';

export const zones={
  straight:{z:0, name:'直线', surface:'asphalt'},
  turns:{z:145, name:'连续弯',surface:'asphalt'},
  grass:{z:244,name:'草地',surface:'grass'},
  mud:{z:298,name:'泥地',surface:'mud'},
  gravel:{z:352,name:'碎石',surface:'gravel'},
  ramp:{z:416,name:'坡道',surface:'asphalt'},
};
export const length=515, width=8.5;
const colors={asphalt:0x465869,grass:0x669840,mud:0x8f6042,gravel:0x9a876d};
export const surfaceColor=z=>colors[surface(z)];
const types=['asphalt','grass','mud','gravel'];
const wave=(value)=>clamp(value,0,1)**2*(3-2*clamp(value,0,1));
export function center(z) {
  if(z<130||z>240)return 0;
  return 9.9*Math.sin((z-130)*.112)*wave((z-130)/17)*wave((240-z)/18);
}
export function surface(z) {
  return z>=350&&z<414?'gravel':z>=294&&z<350?'mud':z>=240&&z<294?'grass':'asphalt';
}
export function elevation(x,z) {
  if(z>=350&&z<414){
    const mask=wave((z-350)/4)*wave((414-z)/4);
    return (.13*Math.sin(z*2.8+x*.85)+.095*Math.cos(z*1.3-x*1.67)+.16*Math.sin(z*.5))*mask;
  }
  if(z>=429&&z<446) return (z-429)*.26;
  if(z>=446&&z<450) return 4.42-(z-446)*1.08;
  if(z>=450&&z<454) return .1*(1-(z-450)/4);
  return 0;
}

export function makeTrack({constantSurface, flat=false}={}) {
  const height=(x,z)=>flat?0:elevation(x,z);
  const axis=z=>flat?0:center(z);
  const groundType=z=>constantSurface||surface(z);
  const tangent=(z)=>new Vector3((axis(z+.3)-axis(z-.3))/.6, (height(axis(z),z+.3)-height(axis(z),z-.3))/.6, 1).normalize();
  const normal=(x,z)=>new Vector3((height(x-.14,z)-height(x+.14,z))/.28,1,(height(x,z-.14)-height(x,z+.14))/.28).normalize();
  return {
    handledSurface:true,
    kind:new Proxy([], {get:(_,index)=>types.indexOf(groundType(Number(index)-16))}),
    course:{surfaceLateral:types.map(type=>groundTypes[type].lateral)},
    gripAt(index){return groundTypes[types[index]||'asphalt'].retention;},
    getTangent(index){return tangent(index-16);},
    getRight(index){const t=tangent(index-16);return new Vector3(t.z,0,-t.x).normalize();},
    progress(loc){return clamp(loc.z/length,0,1);},
    groundTypeAt(loc){return groundType(loc.z);},
    surfaceAt(point){
      const z=point.z, index=Math.max(0,Math.round(z+16));
      return {y:height(point.x,z),normal:normal(point.x,z),loc:{index,z,lat:point.x-axis(z),width}};
    },
  };
}
