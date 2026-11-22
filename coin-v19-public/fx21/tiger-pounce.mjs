import {p as CanvasTexture,qn as Sprite,Jn as SpriteMaterial} from './BufferGeometryUtils-B1nfbDRm.js';

const columns=4, rows=3, cells=columns*rows, cellWidth=256, cellHeight=128;
const gold='#ffbc31', rim='#d7680e', white='#fff5c0', stripe='#8f310b';
const smooth=(a,b,v)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
let atlas;

function drawTiger(ctx,phase){
  const stretch=Math.sin(phase*Math.PI), reach=smooth(.06,.60,phase);
  const shape=(path,fill,outline=rim,width=2.4)=>{
    const outlinePath=new Path2D(path);
    if(fill){ctx.fillStyle=fill;ctx.fill(outlinePath);}
    if(outline){ctx.strokeStyle=outline;ctx.lineWidth=width;ctx.stroke(outlinePath);}
  };
  ctx.lineJoin='round';ctx.lineCap='round';
  const fill=ctx.createLinearGradient(0,42,0,132);
  fill.addColorStop(0,'#ffee9b');fill.addColorStop(.55,'#ffc837');fill.addColorStop(1,'#f78916');
  const paw=(x,y,angle,fore,near)=>{
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);
    const d=fore?'M-17 -13 Q-3 -20 12 -6 L22 18 Q28 23 43 23 Q53 23 53 29 L50 34 L26 34 Q17 32 12 27 L-4 10 Q-14 7 -17 -13Z':
      'M-14 -14 Q11 -17 18 -3 Q23 9 12 19 L-3 28 Q-8 32 -3 36 L12 38 Q19 40 15 46 L-9 46 Q-19 43 -21 35 L-22 26 L-5 12 Q-17 5 -14 -14Z';
    shape(d,near?fill:'#e58018',rim,2.6);
    shape(fore?'M0 1 L13 10 M7 14 L20 19 M38 25 L40 31 M44 25 L46 31':'M-10 2 L7 12 M-16 23 L-4 25 M2 40 L4 44 M8 40 L10 44',null,near?stripe:'#9a4710',2.1);
    ctx.restore();
  };

  // Far-side legs shift first; foreground paws complete the leap.
  ctx.save();
  ctx.globalAlpha=1-.58*smooth(.70,1,phase);
  ctx.save();ctx.translate(0,-4);
  paw(99,95,.30+reach*.94,false,false);
  paw(206,94,-.21-reach*.47,true,false);
  ctx.restore();

  ctx.save();ctx.translate(0,-stretch*6);
  shape('M103 78 C79 80 60 61 44 59 Q20 55 15 31 Q14 18 4 23 Q7 27 8 36 Q10 63 40 71 C59 76 77 98 109 95Z',gold,rim,2.7);
  shape('M14 47 L22 48 M29 60 L31 67 M48 64 L45 72 M64 73 L60 80 M82 81 L77 89',null,stripe,3);
  shape('M87 87 C94 72 110 65 137 68 C160 73 179 58 201 61 C225 64 231 81 219 101 C209 116 189 115 171 111 C145 105 120 114 104 112 Q85 108 87 87Z',fill,rim,3);
  shape('M97 97 C116 109 139 102 162 105 Q190 114 207 101 Q192 116 164 111 Q125 112 104 111Z',white,null);
  for(const d of [
    'M99 78 Q111 73 119 70 L113 84 L107 91 L110 80Z',
    'M119 69 Q128 68 137 69 L133 94 L124 102 L129 81Z',
    'M143 70 L152 70 Q156 88 147 98 L148 82Z',
    'M162 67 L172 64 Q180 84 167 100 L170 83Z',
    'M180 61 L191 60 Q200 75 193 94 L188 78Z',
    'M201 63 L209 66 L210 82 L205 92 L206 76Z',
    'M104 98 L96 105 L97 96 L91 88Z',
    'M156 104 L161 96 L165 106Z',
  ])shape(d,stripe,null);

  paw(108,96,.51+reach*1.06,false,true);
  paw(211,96,.42-reach*1.20,true,true);

  ctx.save();ctx.translate(reach*6,-stretch*5);
  shape('M202 71 L213 59 Q207 47 215 42 Q224 37 233 48 Q244 42 253 49 Q254 39 262 40 Q272 42 267 56 L279 65 L290 68 L300 76 Q298 85 290 87 L280 87 L274 91 L288 100 Q286 109 272 107 L254 101 L241 110 L225 109 L213 99 L200 99 L206 91 L198 84Z',fill,rim,2.8);
  shape('M215 54 Q212 44 220 44 L230 51Z','#a94512',null);
  shape('M255 50 Q258 41 264 43 L263 53Z','#a94512',null);
  shape('M272 73 Q285 68 299 76 L294 86 L282 87 L275 90 L277 97 L288 100 L283 105 Q271 107 255 99 L249 102 L240 99 L246 86 L255 82Z',white,null);
  shape('M270 88 Q277 82 291 85 L284 91 L281 94 L288 100 Q279 102 271 97 L262 92Z','#80250b',null);
  shape('M285 86 L280 94 L277 87Z M278 98 L275 92 L271 95Z','#fffde7',null);
  shape('M290 73 L299 75 Q300 79 294 82 L289 79Z','#89300b',null);
  shape('M217 61 L228 58 L221 70 L213 77 L219 66Z M232 53 L243 51 L234 65 L227 69Z M246 53 L256 52 L251 58 L246 68 L242 69Z M253 74 Q256 66 267 68 L273 73 L266 75 L256 77Z M225 73 L238 76 L233 82 L218 81Z M216 87 L232 89 L229 95 L215 93Z M239 103 L230 106 L218 101Z',stripe,null);
  shape('M255 73 Q263 68 269 72 Q266 77 257 77Z','#fffac5',null);
  shape('M263 71 Q266 71 265 75 L262 76Z','#83300e',null);
  shape('M276 82 L280 81 M274 85 L278 84 M287 83 L304 83 M285 86 L302 91',null,'#ffeeb6',1.2);
  ctx.restore();ctx.restore();ctx.restore();
  const dissolve=smooth(.51,1,phase);
  ctx.save();ctx.globalAlpha=dissolve*.85;
  for(let i=0;i<6;i++){
    const x=13+i*14+phase*27,y=56+i*13;
    shape(`M${x} ${y+5} L${x+40+dissolve*114} ${y} L${x+61+dissolve*114} ${y-3} L${x+28} ${y+2}Z`,
      i%2?white:gold,null);
  }
  ctx.restore();
}

function getAtlas(){
  if(atlas)return atlas;
  const canvas=document.createElement('canvas');
  canvas.width=columns*cellWidth;canvas.height=rows*cellHeight;
  const ctx=canvas.getContext('2d');
  for(let i=0;i<cells;i++){
    ctx.save();
    ctx.translate(i%columns*cellWidth,Math.floor(i/columns)*cellHeight);
    ctx.scale(.80,.80);
    drawTiger(ctx,i/(cells-1));
    ctx.restore();
  }
  atlas=new CanvasTexture(canvas);
  atlas.colorSpace='srgb';atlas.generateMipmaps=false;atlas.minFilter=1006;
  atlas.repeat.set(1/columns,1/rows);
  return atlas;
}

export function createTigerPounce(){
  const map=getAtlas().clone();
  const material=new SpriteMaterial({map,transparent:true,depthWrite:false,alphaTest:.035,toneMapped:false});
  const sprite=new Sprite(material);
  sprite.name='tiger-energy-pounce';
  sprite.userData.sharedAsset=true;
  sprite.visible=false;
  sprite.renderOrder=29;
  let frame=-1;
  return {sprite,update(age,reduced){
    const opacity=smooth(.09,.24,age)*(1-smooth(.76,1.17,age))*(reduced?.76:1);
    sprite.visible=opacity>.025;
    if(!sprite.visible)return;
    const leap=smooth(.13,.82,age), stride=reduced?.5:leap;
    const next=Math.min(cells-1,Math.floor(smooth(.16,.90,age)*cells));
    if(frame!==next){
      frame=next;map.offset.set(frame%columns/columns,(rows-1-Math.floor(frame/columns))/rows);
    }
    sprite.material.opacity=opacity;
    sprite.position.set(2.43+stride*.72,1.65+Math.sin(stride*Math.PI)*.45,.54+stride*2.31);
    const width=(4.23+leap*.42)*(reduced?.87:1);
    sprite.scale.set(width,width*.50,1);
    material.rotation=reduced?0:.095*(1-leap)-.042;
  },dispose(){material.dispose();map.dispose();}};
}
