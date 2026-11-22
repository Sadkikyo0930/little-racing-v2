export const reviewedVehicles=Object.freeze({
  'birthday-star-6':'六星闪耀','tiger-kart':'虎啸流星','monster-truck':'雷霆巨兽',
});
export const comparisonCamera=Object.freeze({
  dist:8.45,height:4.35,lookY:1.18,lookAhead:4.5,shoulder:0,fov:62,
  speedDistGain:0,boostDistGain:0,speedFovGain:0,boostFovGain:0,
  driftSwing:0,followLambda:120,followLambdaSpeed:0,lookLambda:120,shakeScale:0,
});

export function createReview(get,select,setLight,trigger,setBloom){
  const ui=document.createElement('aside');
  ui.className='fx-review';ui.setAttribute('aria-label','相同追尾镜头效果对比');
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
  const normal=button('普通加速',()=>trigger(false)), boost=button('氮气',()=>trigger(true));
  const text=document.createElement('output');text.setAttribute('role','status');ui.append(text);
  normal.disabled=boost.disabled=true;
  document.body.append(ui);
  async function change(id){
    for(const el of cars.values())el.disabled=true;
    normal.disabled=boost.disabled=true;
    text.textContent='载入中…';
    try{
      await select(id);
      if(get()?.id!==id)throw Error('Requested vehicle not active');
      for(const [key,el] of cars)el.setAttribute('aria-pressed',String(key===id));
      normal.disabled=boost.disabled=false;
      text.textContent='同镜头 · 就绪';
    }catch(error){text.textContent='载入失败，请重试';console.warn('[fx review]',error);}
    finally{for(const el of cars.values())el.disabled=false;}
  }
}
