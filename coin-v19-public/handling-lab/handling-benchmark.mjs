import {Scene, Group, Vector3} from './assets/vendor/three.module.js';
import {KartPhysics,stockCar} from './assets/handling-engine.mjs';
import {makeTrack,center,zones} from './handling-terrain.mjs';
export const vehicles={red:'红色赛车','tiger-kart':'虎啸流星','monster-truck':'雷霆巨兽'};
const input=(ops={})=>({throttle:1,steer:0,brake:0,drift:false,driftPressed:false,...ops});
const kmh=s=>s*3.6;
const round=n=>Number(n.toFixed(2));
function build(id,track,z=0){
  const group=new Group();group.name=id;
  const kart=new KartPhysics(new Scene(),stockCar,{model:{group,wheelRadius:.48},mode:'normal',isPlayer:true});
  const p=new Vector3(0,0,z);p.x=center(z);p.y=track.surfaceAt(p).y;
  kart.placeAt(p,track.getTangent(Math.round(z+16)));
  kart.trackIndex=Math.round(z+16);
  return kart;
}

export function benchmark(step=1/120){
  const rows=[];
  for(const id of Object.keys(vehicles)){
    const track=makeTrack({flat:true,constantSurface:'asphalt'});
    const car=build(id,track);
    let t=0, acceleration=null;
    for(let i=0;i<Math.round(12/step);i++){
      car.update(step,input(),track);
      t+=step;
      if(acceleration===null&&kmh(car.speed)>=60) acceleration=t;
    }
    const top=kmh(car.speed);
    const surfaceSpeed=type=>{
      const ground=makeTrack({flat:true,constantSurface:type}), model=build(id,ground);
      for(let i=0;i<Math.round(12/step);i++)model.update(step,input(),ground);
      return kmh(model.speed);
    };
    const grass=surfaceSpeed('grass'), mud=surfaceSpeed('mud');
    car.applyBoost(12,1.6);
    const power=car.boostPower, duration=car.boostTime;
    let peak=car.speed;
    while(car.boostTime>0){car.update(step,input(),track);peak=Math.max(peak,car.speed);}
    car.speed=22;
    car.spinOut(1.5);
    const retained=car.speed/22, spin=car.spinTime;
    const turns=build(id,track);
    turns.speed=21;
    let yaw=0,saved=turns.yaw;
    for(let i=0;i<Math.round(2.6/step);i++){
      const steer=i*step<1.3?-.58:.58;
      turns.update(step,input({throttle:.52,steer}),track);
      const angle=turns.yaw-saved;
      yaw+=Math.abs(Math.atan2(Math.sin(angle),Math.cos(angle)));
      saved=turns.yaw;
    }
    const terrain=makeTrack(), ramp=build(id,terrain,zones.ramp.z);
    ramp.speed=24;
    let airborne=0, landing=0, landingVelocity=0;
    for(let i=0;i<Math.round(3.7/step);i++){
      const inAir=!ramp.grounded, downSpeed=-ramp.vy;
      ramp.update(step,input({throttle:.55}),terrain);
      if(!ramp.grounded)airborne+=step;
      if(inAir&&ramp.grounded)landingVelocity=Math.max(landingVelocity,downSpeed);
      landing=Math.max(landing,ramp.signature?.landing||0);
    }
    rows.push({id,name:vehicles[id],acceleration:round(acceleration??12),top:round(top),turn:round(yaw*180/Math.PI),
      grass:round(grass),mud:round(mud),grassLoss:round(100*(1-grass/top)),mudLoss:round(100*(1-mud/top)),
      power:round(power),duration:round(duration),peak:round(kmh(peak)),impact:round(100*retained),spin:round(spin),
      airborne:round(airborne),landing:round(landing),landingVelocity:round(landingVelocity)});
  }
  return rows;
}
