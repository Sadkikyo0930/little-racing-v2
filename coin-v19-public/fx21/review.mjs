export const reviewedVehicles=Object.freeze({
  'birthday-star-6':'六星闪耀','tiger-kart':'虎啸流星','monster-truck':'雷霆巨兽',
});
export const comparisonCamera=Object.freeze({
  dist:7.25,height:3.74,lookY:1.18,lookAhead:4.5,shoulder:0,fov:62,
  speedDistGain:0,boostDistGain:0,speedFovGain:0,boostFovGain:0,
  driftSwing:0,followLambda:120,followLambdaSpeed:0,lookLambda:120,shakeScale:0,
});

export function createReview(get,select,setLight,trigger,setBloom,setFixed){
  const ui=document.createElement('aside');
  ui.className='fx-review';ui.setAttribute('aria-label','双车氮气验收');
  const button=(label,callback)=>{
    const el=document.createElement('button');el.type='button';el.textContent=label;el.onclick=callback;
    ui.append(el);return el;
  };
  const links=document.createElement('a');links.href='./';links.textContent='返回';ui.append(links);
  const cars=new Map(Object.entries(reviewedVehicles).map(([id,name])=>[id,button(name,()=>void change(id))]));
  let night=false;
  const light=button('白天',()=>{
    night=!night;
    light.textContent=night?'夜景':'白天';light.setAttribute('aria-pressed',String(night));setLight(night);
  });
  const bloom=button('Bloom',()=>{
    setBloom(!get().bloom);
    bloom.setAttribute('aria-pressed',String(get().bloom));
  });
  bloom.setAttribute('aria-pressed',String(get().bloom));
  const toggle=(label,field,setter)=>{
    const el=button(label,()=>{
      setter(!get()[field]);
      el.setAttribute('aria-pressed',String(get()[field]));
    });
    el.setAttribute('aria-pressed',String(get()[field]));
    return el;
  };
  toggle('固定镜头','fixed',setFixed);
  const cruise=button('巡航',()=>trigger(false,false,'cruise'));
  const normal=button('急加速',()=>trigger(false)), shift=button('模拟升挡',()=>trigger(false,false,'shift'));
  const boost=button('氮气',()=>trigger(true));
  const turn=button('弯道氮气',()=>trigger(true,true));
  const readout=document.createElement('span');readout.className='fx-readout';ui.append(readout);
  let timer;
  function report(){
    if(!ui.isConnected){clearInterval(timer);return;}
    const {fps,fx}=get();
    readout.textContent=fps>0?`${Math.round(fps)} FPS · ${fx} 特效`:'';
  }
  timer=setInterval(report,280);
  const text=document.createElement('output');text.setAttribute('role','status');ui.append(text);
  cruise.disabled=normal.disabled=shift.disabled=boost.disabled=turn.disabled=true;
  document.body.append(ui);
  async function change(id){
    for(const el of cars.values())el.disabled=true;
    cruise.disabled=normal.disabled=shift.disabled=boost.disabled=turn.disabled=true;
    text.textContent='载入中…';
    try{
      await select(id);
      if(get()?.id!==id)throw Error('Requested vehicle not active');
      for(const [key,el] of cars)el.setAttribute('aria-pressed',String(key===id));
      cruise.disabled=normal.disabled=shift.disabled=boost.disabled=turn.disabled=false;
      text.textContent='就绪';
    }catch(error){text.textContent='载入失败，请重试';console.warn('[fx review]',error);}
    finally{for(const el of cars.values())el.disabled=false;}
  }
}
