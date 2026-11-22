import {dr as Vector3} from '../BufferGeometryUtils-B1nfbDRm.js';

const assets=new URL('../../vfx-tool/',import.meta.url);
function loadRuntime(){
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL('effekseer.min.js',assets).href;
    script.onerror=()=>reject(Error('Effekseer script could not be loaded'));
    script.onload=()=>globalThis.effekseer.initRuntime(new URL('effekseer.wasm',assets).href,resolve,reject);
    document.head.append(script);
  });
}

export async function enableRaceEffekseer({renderer,camera,composer,player}){
  await loadRuntime();
  const context=effekseer.createContext();
  context.init(renderer.getContext());
  context.setRestorationOfStatesFlag(true);
  const effects=new Map();
  function effect(name){
    return new Promise((resolve,reject)=>{
      const href=new URL('effects/'+name+'.efk',assets).href;
      const effect=context.loadEffect(href,.88,()=>resolve(effect),reject);
    });
  }
  try{
    const [tiger,truck]=await Promise.all([effect('Tiger_Ignition'),effect('Thunder_Discharge')]);
    effects.set('tiger-kart',tiger);effects.set('monster-truck',truck);
  }catch(error){effekseer.releaseContext(context);throw error;}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const mount=new Vector3();
  let prev=null,seen=0,handle=null,elapsed=0,played=0,cleared=0,drawn=0,closed=false;
  function stop(){
    if(!handle)return;
    context.stopAll();context.update(1);handle=null;cleared++;
  }
  const pass={
    enabled:true,needsSwap:false,clear:false,renderToScreen:false,
    setSize(){},
    render(renderer,_write,read,delta){
      const car=player(),signature=car?.signature;
      if(car!==prev){stop();prev=car;seen=0;}
      if(!signature||!effects.has(signature.id)||reduced.matches){stop();return;}
      const count=signature.boostSequence;
      const local=car.model.signatureFx?.root;
      if(!local)return;
      const truck=signature.id==='monster-truck';
      mount.set(0,truck?.9:.62,truck?-1.26:-1.34);
      local.localToWorld(mount);
      if(count>seen){
        seen=count;
        if(signature.boostTime>0||car.boostTime>0){
          stop();
          handle=context.play(effects.get(signature.id),mount.x,mount.y,mount.z);
          handle.setScale(.68,.68,.68);elapsed=0;played++;
        }
      }
      if(!handle)return;
      const dt=Math.max(0,Math.min(.10,delta||1/60));
      elapsed+=dt;
      if(elapsed>.79){stop();return;}
      handle.setLocation(mount.x,mount.y,mount.z);
      handle.setRotation(0,car.visualYaw,0);
      context.update(dt*60);
      context.setProjectionMatrix(camera.projectionMatrix.elements);
      context.setCameraMatrix(camera.matrixWorldInverse.elements);
      renderer.setRenderTarget(read);
      context.draw();
      renderer.resetState();
      drawn++;
    },
  };
  composer.insertPass(pass,1);
  window.readEffekseerRace=()=>({played,cleared,drawn,active:!!handle,closed});
  function release(){
    if(closed)return;
    closed=true;stop();composer.removePass(pass);
    for(const asset of effects.values())context.releaseEffect(asset);
    effekseer.releaseContext(context);
  }
  addEventListener('pagehide',event=>{if(event.persisted){stop();return;}release();});
  return release;
}
