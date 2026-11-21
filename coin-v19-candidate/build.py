"""Create a separate candidate from the accepted dual-kart snapshot. Never patch the base."""
import hashlib,json,subprocess,sys
from pathlib import Path

tool=Path(__file__).resolve().parent
base=Path(sys.argv[1]).resolve()
out=(tool/'site').resolve()
subprocess.run([sys.executable,'-X','utf8',str(base/'tools/build-rigged-preview.py'),str(out)],check=True)
for name in ('coin-shop.mjs','coin-garage.mjs'):
    (out/'assets'/name).write_bytes((tool/name).read_bytes())
page=out/'index.html'
page.write_text(page.read_text(encoding='utf8').replace('<head>','<head><meta name="coin-preview-isolated" content="r5-selftest-coin-v19">',1),encoding='utf8')
runtime=out/'preview-runtime.js'
r=runtime.read_text(encoding='utf8')
r=r.replace("const prefix='lrv2.dual-kart.demo.20261121:';", """const aliases=['a','b','zero','disabled','denied','flaky','offline','missing'];
  const requested=new URLSearchParams(location.search).get('coinDevice');
  const alias=aliases.includes(requested)?requested:(aliases.includes(window.name)?window.name:'a');
  window.name=alias;
  const prefix='lrv2.coin-v19.sandbox:'+alias+':';""")
r=r.replace("'cam3-selftest-device'","'coin-v19-demo-'+alias")
r=r.replace("frag_common:{at,source:'isolated-demo'},turtle", "frag_common:{at,source:'isolated-demo'},frag_rare:{at,source:'isolated-demo'},turtle")
r=r.replace("隔离试玩 · 演示存档 · 无云同步","隔离试玩 · 模拟金币 · 无正式云调用")
runtime.write_text(r,encoding='utf8')

path=out/'assets/index-Cam3Integrated.js'
s=path.read_bytes().decode('utf8')
s='import * as coin from "./coin-garage.mjs";\n'+s

def edit(old,new):
    global s
    if s.count(old)!=1: raise RuntimeError(f'Integration anchor {old!r}: {s.count(old)}')
    s=s.replace(old,new,1)

edit('birthdayOwned ? [...df, birthdaySpec] : df', 'birthdayOwned ? [...df.map(coin.offerSpec), birthdaySpec] : df.map(coin.offerSpec)')
edit('null):ff.get(e)||null}', 'null):coin.offerSpec(ff.get(e))||null}')
edit('||!!t?.owned?.[e]}function vf', '||!!t?.owned?.[e]||Object.hasOwn(coin.cloudGrants(),e)}function vf')
edit('switch(e.unlock.type){case`default`', 'if(coin.cloudCar(e.id)){let v=coin.coinView();return !v.enabled||!v.catalog.has(e.id)?lf.COMING_SOON:v.coins>=e.unlock.price?lf.BUYABLE:lf.NEED_COINS}switch(e.unlock.type){case`default`')
edit('function yf(e,t,n){','function yf(e,t,n){if(coin.cloudCar(e.id))return [];')
edit('let{label:r,disabled:i,cls:a,sub:o}=Tf(e,t,this.save);', '''let v=coin.coinView(),cloud=coin.cloudCar(e.id);
coin.renderCloudInfo(this.el.pUnlock,this.save.coins,cloud);
let{label:r,disabled:i,cls:a,sub:o}=Tf(e,t,cloud?{...this.save,coins:v.coins??0}:this.save);
let visibleBuy=!cloud||t===lf.OWNED||t===lf.EQUIPPED||(v.enabled&&v.catalog.has(e.id));
this.el.pAction.hidden=!visibleBuy;
this.el.pAction.style.display=visibleBuy?"":"none";
if(cloud){i=i||v.busy;o="";}''')
edit('owned:{...e.owned,[BIRTHDAY_ID]:birthdayOwned||undefined},current:e.current','owned:coin.mergeGarageOwnership({...e.owned,[BIRTHDAY_ID]:birthdayOwned||undefined},coin.cloudGrants()),current:coin.selection()??e.current')
edit('selectedId:Hp(),storyState:Ud().state}),Q.setStageFailed','selectedId:coin.selection()??Hp(),storyState:Ud().state}),void coin.refreshCoins(),Q.setStageFailed')
start=s.index('async function pm(e){')
cut=s.index('let n=Ao(e,t.unlock.price);',start)
s=s[:start]+'''async function pm(e){let t=hf(e);if(!t||t.unlock.type!==`coins`)return;
if(coin.cloudCar(e)) {
  const outcome=await coin.buyCloudCar(e,price=>confirmRiggedPurchase({...t,unlock:{...t.unlock,price}}),()=>Object.hasOwn(_o().owned,e));
  const notices={PURCHASED:"云端购买成功，可以在车库装备",ALREADY_OWNED:"这辆车已经到账",UNCONFIRMED:"结果待确认，稍后刷新车库",UNAVAILABLE:"现在无法购买",INSUFFICIENT_COINS:"云端余额不足"};
  if(!["CANCELLED","BUSY"].includes(outcome.status)) Q.toast(outcome.status==="INSUFFICIENT_COINS"&&Number.isSafeInteger(outcome.deficit)?"云端可购买金币还差 "+outcome.deficit:notices[outcome.status]??coin.coinMessage(outcome.status),["PURCHASED","ALREADY_OWNED"].includes(outcome.status)?"good":"bad");
  return;
}'''+s[cut:]
edit('function fm(e){let t=hf(e);','''function fm(e){
if(Object.hasOwn(coin.cloudGrants(),e)&&!Object.hasOwn(_o().owned,e)&&gf(e)){
  coin.rememberSelection(e);
  zm(e,{preload:true});
  Q.update(Co(),{storyState:Ud().state});
  Q.toast("已装备 "+hf(e).name,"good");
  void coin.syncCloudVehicle(e);
  return;
}
let t=hf(e);''')
edit('Z.setVehicle(e),!isRiggedKart(e)&&Wp(),e===`turtle`&&Gp()', 'coin.rememberSelection(null),Z.setVehicle(e),!isRiggedKart(e)&&Wp(),e===`turtle`&&Gp()')
# Keep the original local purchase path, including local equip and balance.
edit('Z.setVehicle(e),!isRiggedKart(e)&&Wp(),e===`moto`&&Kp()', 'coin.rememberSelection(null),Z.setVehicle(e),!isRiggedKart(e)&&Wp(),e===`moto`&&Kp()')
s+='''
coin.onCoinChange(()=>{
  if(coin.selection()&&!_f(coin.selection(),_o())) {
    coin.rememberSelection(null);
    if($.state!=="race") zm(Hp());
  }
  if(Q.visible) Q.update(Co(),{storyState:Ud().state});
});
void coin.refreshCoins()?.then(result=>{
  if(result.status!=="OK"||$.state!=="menu"||coin.selection()) return;
  const id=coin.savedSelection()??(Hp()==="red"?coin.coinView().current:null);
  if(id&&_f(id,_o())&&gf(id)){coin.rememberSelection(id);zm(id);}
});
'''
path.write_bytes(s.encode('utf8'))
manifest={p.relative_to(out).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
          for p in out.rglob('*') if p.is_file() and p.name not in ('production-sha256.json','.nojekyll')}
(out/'production-sha256.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf8')
print(f'Coin v1.9 sandbox: {len(manifest)} verified files')
