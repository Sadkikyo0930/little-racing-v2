"""Apply guarded integration edits to the checked-in static game (main dcef2e3)."""
from pathlib import Path
from hashlib import sha256
import json

docs = Path(__file__).resolve().parents[1] / 'docs'
entry = docs / 'assets/index-Cam3Integrated.js'
stage = docs / 'assets/stage-birthday-integration.mjs'
source = entry.read_text(encoding='utf-8')

def patch(old, new):
    global source
    if source.count(old) != 1:
        raise ValueError(f'Expected one integration anchor: {old!r}, got {source.count(old)}')
    source = source.replace(old, new)

specs = [
    dict(id='tiger-kart',name='虎啸流星',short='虎啸',tag='卡丁',available=True,
         stats=dict(speed=3,accel=4,control=4,stability=4),desc='主角 A 驾驶的敞篷虎纹卡丁车。',
         unlock=dict(type='coins',price=2000,label='金币购买'),color=0xffa724,accent=0x232529),
    dict(id='monster-truck',name='雷霆巨兽',short='巨兽',tag='越野',available=True,
         stats=dict(speed=3,accel=4,control=4,stability=4),desc='大轮胎、高底盘的封闭式越野赛车。',
         unlock=dict(type='coins',price=4000,label='金币购买'),color=0xffc525,accent=0x31b9f9)
]

if 'from "./rigged-karts.mjs"' not in source:
    source='import {isRiggedKart, loadRiggedKart, createRiggedKart} from "./rigged-karts.mjs";\n'+source
    patch('df=Object.freeze([','df=Object.freeze(['+', '.join('Object.freeze('+json.dumps(v,ensure_ascii=False)+')' for v in specs)+',')
    patch('jp=Object.freeze([`turtle`,`moto`,`frag_common`,`frag_rare`,BIRTHDAY_ID])',
          'jp=Object.freeze([`turtle`,`moto`,`frag_common`,`frag_rare`,BIRTHDAY_ID,"tiger-kart","monster-truck"])')
    patch('birthday=r&&t===BIRTHDAY_ID&&birthdayOwned&&birthdayModel,d=r&&Np&&!l?',
          'rigged=r&&isRiggedKart(t),birthday=r&&t===BIRTHDAY_ID&&birthdayOwned&&birthdayModel,d=r&&Np&&!l&&!rigged?')
    patch('f=birthday?birthdayModel.createBirthdayModel(d)', 'f=rigged?createRiggedKart(t):birthday?birthdayModel.createBirthdayModel(d)')
    patch('p=birthday?{...St[Ep]', 'p=rigged?{...St[Ep],name:hf(t).name,body:hf(t).color,accent:hf(t).accent}:birthday?{...St[Ep]')
    patch('t.spin.rotation.x=this.wheelSpin)', 't.spin.rotation.x=this.wheelSpin*(t.radius?this.model.wheelRadius/t.radius:1))')
    patch('t===BIRTHDAY_ID?await loadBirthdayRace():t===`moto`?await Kp():',
          'isRiggedKart(t)?await loadRiggedKart(t).catch(error=>{console.warn("[kart] model unavailable",error);Z.toast("模型加载失败，本局使用红色赛车","bad");Z.setVehicle("red");t=null}):t===BIRTHDAY_ID?await loadBirthdayRace():t===`moto`?await Kp():')
    patch('r===`moto`?Kp():r===`frag_common`', 'isRiggedKart(r)?loadRiggedKart(r).catch(()=>{}):r===`moto`?Kp():r===`frag_common`')
    patch('Z.setVehicle(e),Wp(),e===`turtle`&&Gp()', 'Z.setVehicle(e),!isRiggedKart(e)&&Wp(),e===`turtle`&&Gp()')
    patch('Z.setVehicle(e),Wp(),e===`moto`&&Kp()', 'Z.setVehicle(e),!isRiggedKart(e)&&Wp(),e===`moto`&&Kp()')
    patch('if(!t||t.unlock.type!==`coins`)return;let n=Ao(e,t.unlock.price);',
          'if(!t||t.unlock.type!==`coins`)return;if(isRiggedKart(e)){const save=Co();if(save.owned[e]||save.coins<t.unlock.price||save.readOnly||save.writeFailed)return Q.update(save,{storyState:Ud().state});if(!window.confirm("确定用 "+t.unlock.price+" 金币购买"+t.name+"？"))return;}let n=Ao(e,t.unlock.price);')
    entry.write_text(source,encoding='utf-8')

if 'from "./kart-purchase-ui.mjs"' not in source:
    source='import {confirmRiggedPurchase} from "./kart-purchase-ui.mjs";\n'+source
    patch('function pm(e){','async function pm(e){')
    patch('if(!window.confirm("确定用 "+t.unlock.price+" 金币购买"+t.name+"？"))return;',
          'if(!await confirmRiggedPurchase(t))return;')
    entry.write_text(source,encoding='utf-8')

if 'this.vehicle=t.includes(e)||isRiggedKart(e)?e:' not in source:
    patch('this.vehicle=t.includes(e)?e:`red`', 'this.vehicle=t.includes(e)||isRiggedKart(e)?e:`red`')
    entry.write_text(source,encoding='utf-8')

if 'let S=this._driftOffset+(this.mode===0' not in source:
    patch('let S=this._driftOffset,C=a.dist', 'let S=this._driftOffset+(this.mode===0&&!n.lookBack?(r.shoulder??0):0),C=a.dist')
    entry.write_text(source,encoding='utf-8')

text=stage.read_text(encoding='utf-8')
if 'from "./rigged-karts.mjs"' not in text:
    text='import {isRiggedKart, loadRiggedKart, createRiggedKart} from "./rigged-karts.mjs";\n'+text
    marker='export class GarageStage extends Cam3Stage {'
    text=text.replace(marker,marker+'''
  async ensureModels(ids) {
    // Let the inherited show() allocate the selection sequence before loading.
    const id = this._riggedRequests?.get(this._seq);
    if (!id) return super.ensureModels(ids);
    try { await loadRiggedKart(id); }
    catch (error) { console.warn("[garage] kart not available", id, error); }
  }
''')
    marker='  async show(id) {'
    text=text.replace(marker,marker+'''
    if (isRiggedKart(id)) {
      this._riggedRequests ??= new Map();
      // The inherited show() increments _seq synchronously before its first await.
      const seq = this._seq + 1;
      this._riggedRequests.set(seq, id);
      try { return await super.show(id); }
      finally { this._riggedRequests.delete(seq); }
    }''')
    marker='  _makeCar(id) {'
    text=text.replace(marker,marker+'''
    if (isRiggedKart(id)) {
      const model = createRiggedKart(id, { garage: true });
      return model && {group: model.group, info: {wheels: model.wheels.length}};
    }''')
    stage.write_text(text,encoding='utf-8')

manifest_path=docs/'production-sha256.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
for rel in ('assets/index-Cam3Integrated.js','assets/stage-birthday-integration.mjs',
            'assets/rigged-karts.mjs','assets/kart-purchase-ui.mjs',
            'assets/karts/tiger-kart-final.glb','assets/karts/monster-truck-final.glb'):
    manifest[rel]=sha256((docs/rel).read_bytes()).hexdigest()
manifest_path.write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
