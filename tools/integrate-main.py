import pathlib,re,subprocess,json,hashlib
root=pathlib.Path(__file__).resolve().parents[1];docs=root/'docs';src=docs/'assets/index-C6YUYqdI.js'
s=src.read_text();old=subprocess.check_output(['git','-C',str(root),'show','a416c650389d47d6ce5c194bd874c4f59e23fa1a:docs/assets/index-C359oddP.js'],text=True)
def rep(a,b,count=1):
 global s
 assert s.count(a)==count,(a,s.count(a));s=s.replace(a,b)
def function(text,name):
 a=text.index('function '+name+'(');m=re.search(r'}(?=function |var )',text[a:]);assert m,name
 return text[a:a+m.end()]
# Preserve formal save writes, reward event IDs, migration and full backup semantics.
for name in ['so','lo','Co','wo','Oo','Ao','Mo','Ro','Uo','qo']:
 rep(function(s,name),function(old,name))
s=old[:old.index('const __vite__mapDeps')]+s
rep('let t=[`turtle`,`moto`,`frag_common`,`frag_rare`];','let t=[`turtle`,`moto`,`frag_common`,`frag_rare`,...(birthdayOwned?[BIRTHDAY_ID]:[])];')
spec=old[old.index('const birthdaySpec='):old.index('function mf(')]
rep('function mf(',spec+'function mf(')
rep('function hf(e){return ff.get(e)||null}', 'function hf(e){return e===BIRTHDAY_ID?(birthdayOwned?birthdaySpec:null):ff.get(e)||null}')
rep('function gf(e){return mf(ff.get(e))}', 'function gf(e){return mf(hf(e))}')
rep('function _f(e,t){','function _f(e,t){if(e===BIRTHDAY_ID)return birthdayOwned;')
rep('function vf(e,t){if(t?.owned?.[e.id])','function vf(e,t){if(e.id===BIRTHDAY_ID?birthdayOwned:t?.owned?.[e.id])')
rep('function yf(e,t,n){','function yf(e,t,n){if(e.id===BIRTHDAY_ID)return [{icon:`gift`,text:`生日礼物`,value:`已拥有`,done:true}];')
rep('function Df(e){', 'function Df(e){if(e===BIRTHDAY_ID&&birthdayOwned)return \'<img alt="" style="width:100%;height:100%;object-fit:contain" src="\'+new URL(\'./birthday/car.png\',import.meta.url).href+\'">\';')
rep('vehicles:t=df','vehicles:t=garageVehicles()')
rep('this._renderCards(df)','this._renderCards(garageVehicles())')
rep('jp=Object.freeze([`turtle`,`moto`,`frag_common`,`frag_rare`])','jp=Object.freeze([`turtle`,`moto`,`frag_common`,`frag_rare`,BIRTHDAY_ID])')
rep('u=i&&r,d=r&&Np', 'u=i&&r,birthday=r&&t===BIRTHDAY_ID&&birthdayOwned&&birthdayModel,d=r&&Np')
rep('f=l?Lp.createMotoModel()', 'f=birthday?birthdayModel.createBirthdayModel(d):l?Lp.createMotoModel()')
rep('p=l?Op:c?Dp:u?', 'p=birthday?{...St[Ep],name:birthdaySpec.name,body:birthdaySpec.color,accent:birthdaySpec.accent}:l?Op:c?Dp:u?')
rep('t===`moto`?await Kp():', 't===BIRTHDAY_ID?await loadBirthdayRace():t===`moto`?await Kp():')
rep('Jp(t?Ep:e),', 't===BIRTHDAY_ID&&!birthdayModel?void 0:Jp(t?Ep:e),')
rep('function nm(){', 'function nm(){presentBirthdayIfOnMenu();')
rep('zm(Hp(),{persist:!0}),bp.onVoiceTap=', 'zm(Hp(),{persist:jo()!==BIRTHDAY_ID}),bp.onVoiceTap=')
# Both chapter writes must schedule the same sync controller.
for key in ['Rd','qd']:
 a=f'Hd()?.setItem({key},JSON.stringify({{state:t,updatedAt:Date.now()}}))'
 rep(a,a+',scheduleFamilySync()')
s+='''\nfunction presentBirthdayIfOnMenu(){if(!birthdayShowPending||$.state!==`menu`)return;birthdayShowPending=false;lp.setDuck(true);openBirthdayShow(()=>lp.setDuck(false));}
async function loadBirthdayRace(){try{const model=await import('./birthday-model.mjs');await Promise.all([model.loadBirthdayModel(),Wp()]);if(!Np)throw Error('Missing driver model');birthdayModel=model;}catch(error){console.warn('[garage] 生日车加载失败',error);Z.toast('六星闪耀加载失败，请重试','bad');}}
void getBirthdayClaim().then(award=>{if(!award)return;birthdayOwned=true;birthdayShowPending=award.newlyClaimed;if(jo()===BIRTHDAY_ID)zm(BIRTHDAY_ID);if($.state===`garage`)Q.update(Co(),{storyState:Ud().state});presentBirthdayIfOnMenu();});
addEventListener('r5-family-restored',()=>{mo=null;So('cloud-sync');if($.state==='menu')nm();if($.state!=='race')zm(Hp());});
'''
# A wrapper adds birthday support; the accepted Cam3 stage stays byte-identical.
s=s.replace('import(`./stage-DtUJQvYs.js`)','import(`./stage-birthday-integration.mjs`)')
(docs/'assets/index-Cam3Integrated.js').write_text(s)
p=docs/'index.html';p.write_text(p.read_text().replace('index-C6YUYqdI.js','index-Cam3Integrated.js'))
m=json.loads((docs/'production-sha256.json').read_text())
for rel in ['index.html','assets/index-Cam3Integrated.js','assets/stage-birthday-integration.mjs']:
 m[rel]=hashlib.sha256((docs/rel).read_bytes()).hexdigest()
(docs/'production-sha256.json').write_text(json.dumps(m,indent=2))
print('Formal birthday + full save integration restored; original Cam3 main/stage/GLBs unchanged')
