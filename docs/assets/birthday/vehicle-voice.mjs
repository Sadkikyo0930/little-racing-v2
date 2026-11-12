import { WebGLRenderer, Scene, PerspectiveCamera, Group, Box3, HemisphereLight, DirectionalLight, MeshBasicMaterial } from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

export async function loadVehicle(stage) {
  const loader = new GLTFLoader();
  const assets = new URL('../', import.meta.url);
  const [{scene:car},{scene:hero}] = await Promise.all([
    loader.loadAsync(new URL('karts/birthday-star-6.glb',assets).href),
    loader.loadAsync(new URL('hero-a-standing-7pv3jPFY.glb',assets).href)
  ]);
  car.traverse(node=>{
    if(node.isMesh){
      const source=node.material;
      node.material=new MeshBasicMaterial({map:source.map,color:source.color,side:source.side});
    }
  });
  const carBounds=new Box3().setFromObject(car);
  const heroBounds=new Box3().setFromObject(hero);
  hero.position.set(carBounds.max.x-heroBounds.min.x+.16,-heroBounds.min.y,.2);
  const display=new Group();display.add(car,hero);
  const scene=new Scene();scene.add(display,new HemisphereLight(0xe8f4ff,0x405281,2.4));
  const key=new DirectionalLight(0xffe9be,2.8);key.position.set(3,6,3);scene.add(key);
  const renderer=new WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.25));
  renderer.domElement.hidden=true;stage.append(renderer.domElement);
  const camera=new PerspectiveCamera(38,1,.1,40);
  let width=0,height=0,last=-1;
  return {draw(t,beat,visible){
    renderer.domElement.hidden=!visible;
    renderer.domElement.style.display=visible?'block':'none';
    if(!visible)return;
    const w=stage.clientWidth,h=stage.clientHeight;
    if(w===width&&h===height&&t<40&&t-last<1/30)return;
    if(w!==width||h!==height){
      renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
      width=w;height=h;
    }
    last=t;hero.visible=beat>=3;
    const angle=beat===2 ? .8-(t-16.8)*.27 : -.73-(Math.min(t,31)-22.2)*.31;
    const radius=camera.aspect<1.35?9.5:7.3;
    camera.position.set(Math.sin(angle)*radius,2.8,Math.cos(angle)*radius);
    camera.lookAt(beat>=3?.5:0,.3,0);
    renderer.render(scene,camera);
  }};
}
