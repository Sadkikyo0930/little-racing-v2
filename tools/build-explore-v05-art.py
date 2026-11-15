from pathlib import Path

src=Path('docs/explore-v04.html').read_text(encoding='utf-8')
assert 'function house(x,z,gy,wall,roof){' in src
assert 'const trees=[],farHills=[];' in src
assert '/* ==================== 9. 检查点' in src
out=src.replace('自由探索 V0.4','自由探索 V0.5').replace('修结构 + 美化版','风景小镇美术版')
out=out.replace('正在铺设 V0.4 山路、隧道与湖畔…','正在绘制 V0.5 湖光、山林与彩色村落…')
out=out.replace('贴山公路 · 穿山隧道 · 湖畔飞跃 · 精致村落','彩色村落 · 湖光山色 · 森林花坡 · 穿山隧道')
out=out.replace("scene.background=new T.Color('#a9daf2');scene.fog=new T.Fog('#a9daf2',420,1150)","scene.background=new T.Color('#b9dcf1');scene.fog=new T.Fog('#b9dcf1',520,1450)")
out=out.replace('renderer.toneMappingExposure=1.22','renderer.toneMappingExposure=1.34')
out=out.replace("new T.HemisphereLight(0xffffff,0x8cae72,2.6)","new T.HemisphereLight(0xfff8ed,0x80a581,2.35)")
out=out.replace("new T.DirectionalLight(0xffffff,2.0)","new T.DirectionalLight(0xffe8c4,2.2)")
out=out.replace("const grassMat=M('#8fca78')","const grassMat=M('#95bf85')")
out=out.replace("color:'#59bad6',roughness:.25,metalness:.05","color:'#329fc4',roughness:.16,metalness:.11")
out=out.replace("const housePalette=[['#f6e7d2','#b8665a'],['#e8f0f2','#627f9c'],['#f7e0cf','#8a7b68'],['#eaf0dc','#a2765b'],['#f0e4ee','#7d7a99']]","const housePalette=[['#fff0d5','#c56d58'],['#e5f3ef','#598aa2'],['#f8d9c8','#ac715e'],['#ebf0cb','#9d7658'],['#f1dfec','#8a79a5']]")
start=out.index('function house(x,z,gy,wall,roof){')
end=out.index('\nconst villages=[',start)
out=out[:start]+r"""function house(x,z,gy,wall,roof){
 // Exterior details, all inside the original house collision radius.
 const stone=M('#b5ab99'),trim=M('#ffefdb'),timber=M('#825d4b'),
   glass=new T.MeshStandardMaterial({color:'#b4e4ed',roughness:.16,metalness:.18}),
   roofM=M(roof),wallM=M(wall),leaf=M('#608c58');
 const h=12+Math.floor(rnd()*3)*3;
 cube(x,gy+1.15,z,23,2.3,20,stone);
 cube(x,gy+2.3+h/2,z,20,h,17,wallM);
 const r=cone(x,gy+2.3+h+4.0,z,16.2,8.1,roofM,4);r.rotation.y=Math.PI/4;
 for(const dx of [-10,10])cube(x+dx,gy+2.3+h-.4,z,1.0,1.0,19,trim);
 cube(x,gy+2.3+h-.25,z+8.95,21,.9,.75,trim);
 cube(x,gy+2.3+h-.25,z-8.95,21,.9,.75,trim);
 for(const dx of [-6,6])for(const dz of [-8.7,8.7]){
  const y=gy+2.3+h*.6;
  cube(x+dx,y,z+dz,4.2,3.7,.30,trim);
  cube(x+dx,y,z+dz+Math.sign(dz)*.19,3.5,3.05,.28,glass);
  cube(x+dx,y,z+dz+Math.sign(dz)*.38,.22,3.05,.2,trim);
  cube(x+dx,y,z+dz+Math.sign(dz)*.38,3.5,.22,.2,trim);
  cube(x+dx,y-2.15,z+dz+Math.sign(dz)*.45,4.8,.45,.95,trim);
  cube(x+dx,y-2.3,z+dz+Math.sign(dz)*.85,3.9,.28,1.3,leaf);
 }
 cube(x,gy+4.2,z+8.9,3.4,5.2,.45,timber);
 cube(x,gy+3.0,z+9.2,.25,.25,.25,M('#efc875'));
 cube(x,gy+2.1,z+11.2,9,.48,4.7,stone);
 cube(x,gy+1.65,z+13.5,7,.32,1.7,trim);
 for(const dx of [-4.1,4.1]){
  cyl(x+dx,gy+5.8,z+11.9,.28,7.2,trim,7);
  cone(x+dx,gy+2.4,z+15.1,1.2,2.4,leaf,7);
 }
 const porchRoof=cube(x,gy+9.5,z+12.0,10.7,.7,6.1,roofM);
 porchRoof.rotation.x=-.07;
 cube(x,gy+9.7,z+13.3,10.9,.32,.4,trim);
 cube(x+6,gy+2.3+h+6,z-4,2.2,4.5,2.2,M('#bd8875'));
 for(const dx of [-9.2,9.2])cube(x+dx,gy+2.55,z+11,2.4,1.9,2.4,leaf);
}""" + out[end:]
marker='/* ==================== 9. 检查点、车辆、驾驶（V0.3 物理完整保留 + 隧道硬约束） ==================== */'
art=r"""
/* ==================== 8b. V0.5 3D ART PASS — independent of driving ==================== */
const ART05={version:'v05-art-20261115',flowers:0,extraCanopies:0,waterDetails:0,cloudPuffs:0,stalls:0};
const petalColors=['#ffc3ba','#ffde83','#ffffff','#d4b7f3','#e6a1af','#b6d8e0'].map(c=>new T.Color(c));
const florets=[],shrubs=[];
for(let i=0;i<850;i++){
 const x=(rnd()-.5)*2780,z=(rnd()-.5)*2780,cr=closestRoad(x,z);
 if(inWater(x,z,7)||intrudesTunnel(x,4,z,3)||x>260&&z>280||z<-1410)continue;
 const c=clearance(x,z,3,2.2,4);if(!c.ok){AUDIT.rejected++;continue}
 const y=Math.max(-1.5,Math.min(cr.y-2.5,1.3)),scale=.8+rnd()*1.5;
 if(rnd()<.78){florets.push([x,y+.5,z,scale,Math.floor(rnd()*petalColors.length)]);ART05.flowers++}
 else shrubs.push([x,y+.9,z,scale*1.5]);
 AUDIT.obstacles.push({x:+x.toFixed(1),z:+z.toFixed(1),y:+y.toFixed(1),r:2.2,kind:'v05-flower',distance:+c.distance.toFixed(2),need:+c.need.toFixed(2),ok:true});
}
if(florets.length){
 const heads=new T.InstancedMesh(new T.IcosahedronGeometry(.58,1),M('#fff5e7'),florets.length);
 const stems=new T.InstancedMesh(new T.CylinderGeometry(.09,.13,1.15,4),M('#538752'),florets.length);
 const d=new T.Object3D();
 florets.forEach((v,i)=>{
  d.rotation.set(0,i*.31,0);d.position.set(v[0],v[1]+v[3]*.35,v[2]);d.scale.set(v[3],v[3]*.6,v[3]);d.updateMatrix();heads.setMatrixAt(i,d.matrix);heads.setColorAt(i,petalColors[v[4]]);
  d.rotation.set(0,0,0);d.position.y=v[1]-.25;d.scale.set(v[3],v[3],v[3]);d.updateMatrix();stems.setMatrixAt(i,d.matrix)
 });
 heads.instanceMatrix.needsUpdate=true;heads.instanceColor.needsUpdate=true;stems.instanceMatrix.needsUpdate=true;
 scene.add(heads,stems)
}
instanced(new T.IcosahedronGeometry(1,1),M('#6c9d67'),shrubs,(d,v)=>{d.position.set(v[0],v[1],v[2]);d.scale.set(v[3],v[3]*.8,v[3])});
if(trees.length){
 const mid=new T.InstancedMesh(new T.ConeGeometry(3.75,8.5,7),M('#568e66'),trees.length);
 const tips=new T.InstancedMesh(new T.ConeGeometry(2.6,6.4,7),M('#6da476'),trees.length);
 const d=new T.Object3D();
 trees.forEach(([x,z,h],i)=>{
  d.rotation.set(0,i*.73,0);d.scale.set(h/12,h/12,h/12);
  d.position.set(x,h*.87,z);d.updateMatrix();mid.setMatrixAt(i,d.matrix);
  d.position.y=h*1.08;d.rotation.y=i*1.21;d.updateMatrix();tips.setMatrixAt(i,d.matrix)
 });
 mid.instanceMatrix.needsUpdate=true;tips.instanceMatrix.needsUpdate=true;scene.add(mid,tips);
 ART05.extraCanopies=trees.length*2;
}
const cloudPuffs=[];
for(let i=0;i<23;i++){
 const cx=(rnd()-.5)*2400,cy=240+rnd()*180,cz=(rnd()-.5)*2450,r=26+rnd()*36;
 for(let j=0;j<4;j++)cloudPuffs.push([cx+(j-1.5)*r*.55,cy+(j%2)*7,cz+j*r*.16,r*(.48+rnd()*.12)])
}
instanced(new T.IcosahedronGeometry(1,2),new T.MeshBasicMaterial({color:'#fff9ef',transparent:true,opacity:.88,depthWrite:false}),cloudPuffs,(d,v)=>{d.position.set(v[0],v[1],v[2]);d.scale.set(v[3],v[3]*.35,v[3]*.75)});
ART05.cloudPuffs=cloudPuffs.length;
const rippleMat=new T.MeshBasicMaterial({color:'#e5f6ef',transparent:true,opacity:.27,side:T.DoubleSide,depthWrite:false});
for(const radius of [310,327,340,347]){const ring=part(new T.RingGeometry(radius,radius+1.6,72),rippleMat,-800,-.83+radius*.00002,655);ring.rotation.x=-Math.PI/2;ART05.waterDetails++}
const lilyPads=[],lilyFlowers=[];
for(let i=0;i<75;i++){
 const a=rnd()*Math.PI*2,r=35+rnd()*265,x=-800+Math.cos(a)*r,z=655+Math.sin(a)*r;
 lilyPads.push([x,-.87,z,.8+rnd()*1.45]);
 if(i%3===0)lilyFlowers.push([x,-.72,z,.3+rnd()*.34])
}
instanced(new T.CircleGeometry(1,10),new T.MeshStandardMaterial({color:'#4b967a',roughness:.65,side:T.DoubleSide}),lilyPads,(d,v)=>{d.position.set(v[0],v[1],v[2]);d.rotation.x=-Math.PI/2;d.scale.setScalar(v[3])});
instanced(new T.IcosahedronGeometry(1,1),M('#ffe9e8'),lilyFlowers,(d,v)=>{d.position.set(v[0],v[1],v[2]);d.scale.setScalar(v[3])});
ART05.waterDetails+=lilyPads.length+lilyFlowers.length;
const canvases=['#d56d67','#6696b2','#eac07b','#9c8aba'].map(M),wood=M('#866f55'),ivory=M('#f5ead3'),light=new T.MeshBasicMaterial({color:'#ffe1a3'});
function marketStall(x,z,y,style){
 const awn=canvases[style%canvases.length];
 cube(x,y+.45,z,10,.9,7,wood);
 for(const dx of [-4.4,4.4])for(const dz of [-2.8,2.8])cube(x+dx,y+4,z+dz,.45,6.5,.45,ivory);
 cube(x,y+7.8,z,12,.75,8.5,awn);
 cube(x,y+4.2,z+2.8,8,2.3,1.1,ivory);
 for(let j=0;j<3;j++)cyl(x-2.8+j*2.8,y+5.5,z+3,.7,1.1,M(['#f0bb77','#b36c5b','#95ae75'][j]),9);
 for(const dx of [-3.1,3.1])part(new T.SphereGeometry(.5,8,6),light,x+dx,y+7,z+3.4)
}
[[-550,-1040],[-160,-1065],[-1130,-300],[-1230,-1020],[-1020,-1030],[-240,-1170]].forEach(([x,z],i)=>{
 const cr=closestRoad(x,z);
 if(place(x,z,cr.y+3,8,'v05-market-stall',()=>marketStall(x,z,cr.y,i),5))ART05.stalls++
});
window.__V05_ART__=ART05;
"""
assert marker in out
out=out.replace(marker,art+marker)
assert 'window.__V04_AUDIT__' in out and 'clampIntoTunnel' in out
assert 'const roads=[' in out and 'window.__V05_ART__' in out
assert len(out)>len(src)
Path('docs/explore-v05.html').write_text(out,encoding='utf-8')
print('Produced V0.5',len(out.encode()),'bytes; V0.4 unchanged',len(src.encode()))
