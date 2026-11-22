const timing={launch:[.112,.135],shift:[.085,.114],nitro:[.128,.108]};
const bands=[12,20,27];

export function createExhaustEvents(){
  let previousThrottle=0,previousSpeed=0,gear=0,boostSeen=0,launchSeen=0;
  let serial=0,cooldown=0,t=Infinity,event=null;
  const left={energy:0,age:1,length:0},right={energy:0,age:1,length:0};
  function reset(boost=0,launch=0,speed=0,throttle=0){
    boostSeen=boost;launchSeen=launch;previousThrottle=throttle;previousSpeed=speed;
    gear=bands.filter(edge=>speed>=edge).length;
    cooldown=0;t=Infinity;event=null;left.energy=right.energy=0;
  }
  function nozzle(out,side,reduced){
    out.energy=0;out.age=1;out.length=0;
    if(!event)return;
    const late=side!==(serial%2), first=late?.044+(serial%3)*.008:0;
    const duration=timing[event][late?1:0];
    const scale=(late?.81:1)*(reduced?.78:1);
    const second=event==='nitro'&&!reduced?.159+(late?.059:0):Infinity;
    for(let shot=0;shot<(second===Infinity?1:2);shot++){
      const phase=(t-(shot?second:first))/(duration*(shot?.72:1));
      if(phase<0||phase>=1)continue;
      const weight=shot?.61:1;
      const fade=Math.pow(1-phase,1.55);
      const punch=.74+.26*Math.min(1,phase*10);
      const power=scale*weight*fade*punch;
      if(power>out.energy){
        out.energy=power;out.age=phase;out.length=scale*weight*(.53+.47*fade);
      }
    }
  }
  return {left,right,reset,get event(){return event;},get serial(){return serial;},
    update(dt,{speed=0,throttle=0,sequence=0,launch=0,boost=0,reduced=false}={}){
      cooldown=Math.max(0,cooldown-dt);t+=dt;
      const hard=throttle>.84, forward=speed>=0;
      const tipIn=hard&&previousThrottle<.33;
      const accelerating=speed-previousSpeed>.74*dt;
      const freshBoost=sequence>0&&sequence!==boostSeen;
      const freshLaunch=launch>0&&launch!==launchSeen;
      let upshift=false;
      while(gear<bands.length&&speed>=bands[gear]+.3){gear++;upshift=true;}
      while(gear>0&&speed<bands[gear-1]-1.7)gear--;
      const next=freshBoost&&(event!=='nitro'||t>.34)?'nitro':forward&&boost<.14&&cooldown===0?
        ((freshLaunch||(tipIn&&speed>2.5))?'launch':(upshift&&hard&&accelerating?'shift':null)):null;
      if(next){
        event=next;serial++;t=0;cooldown=next==='nitro'?.76:.62;
      }else if(t>.34){event=null;}
      previousSpeed=speed;previousThrottle=throttle;boostSeen=sequence;launchSeen=launch;
      nozzle(left,0,reduced);nozzle(right,1,reduced);
    },
  };
}
