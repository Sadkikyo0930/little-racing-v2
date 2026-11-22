"""Stage V4 art over the audited V3.1 static client."""
from pathlib import Path
import os
import shutil

def install_fx40(root,dist):
    source=root/'fx40'
    assets=dist/'assets'
    runtime=assets/'vfx40'
    runtime.mkdir(exist_ok=True)
    for file in (source/'runtime').iterdir():
        if file.name in ('rear-effects.mjs','tiger-pounce.mjs'):
            shutil.copyfile(file,assets/file.name)
        else:
            shutil.copyfile(file,runtime/file.name)
    for name in ('spirit-tiger.glb','gold-flow.png','thunder-flow.png','electric-forks.png','cinder.png'):
        shutil.copyfile(source/'resources'/name,runtime/name)
    rig=assets/'rigged-karts.mjs'
    r=rig.read_text(encoding='utf8')
    anchor='    config.driver ? loadHeroA() : null,'
    assert r.count(anchor)==1
    r="import {warmSpiritTiger} from './tiger-pounce.mjs';\n"+r.replace(anchor,anchor+
       "\n    config.driver ? warmSpiritTiger().catch(error=>console.warn('[spirit tiger]', error)) : null,")
    rig.write_text(r,encoding='utf8')

    preview=dist/'spirit-tiger'
    preview.mkdir(exist_ok=True)
    shutil.copyfile(source/'preview'/'index.html',preview/'index.html')
    script=(source/'preview'/'tiger-preview.mjs').read_text(encoding='utf-8-sig')
    script=script.replace("'./three/","'../assets/vendor/").replace("'./spirit-tiger.glb'","'../assets/vfx40/spirit-tiger.glb'")
    (preview/'tiger-preview.mjs').write_text(script,encoding='utf8')
    proof=dist/'vfx-tool'
    proof.mkdir(exist_ok=True)
    shutil.copyfile(source/'effekseer-proof'/'index.html',proof/'index.html')
    code=(source/'effekseer-proof'/'proof.mjs').read_text(encoding='utf-8-sig')
    code=code.replace("'./three/","'../assets/vendor/").replace('const url=new URL(location.href).searchParams.has(\'custom\')?\'./v4-spark.efk\':\'./Resources/Simple_Ring_Shape1.efk\';',
        "const url=new URL(location.href).searchParams.get('effect')==='thunder'?'./effects/Thunder_Discharge.efk':'./effects/Tiger_Ignition.efk';")
    (proof/'proof.mjs').write_text(code,encoding='utf8')
    (proof/'effects'/'tex').mkdir(parents=True,exist_ok=True)
    for name in ('Tiger_Ignition.efk','Thunder_Discharge.efk'):
        shutil.copyfile(source/'resources'/name,proof/'effects'/name)
    for name in ('cinder.png','electric-card.png'):
        shutil.copyfile(source/'resources'/name,proof/'effects'/'tex'/name)
    sdk=Path(os.environ.get('LRV4_EFFEKSEER_WEBGL','D:/GameDev/VFX/WebGL-1.80.8'))
    for name in ('effekseer.min.js','effekseer.wasm'):
        shutil.copyfile(sdk/name,proof/name)
    shutil.copyfile(source/'EFFEKSEER-LICENSE.txt',proof/'EFFEKSEER-LICENSE.txt')
    experimental=(dist/'index.html').read_text(encoding='utf8')
    original="script-src 'self' 'unsafe-inline' blob:;"
    assert experimental.count(original)==1
    wasm_entry=dist/'vfx-effekseer'
    wasm_entry.mkdir(exist_ok=True)
    markup=experimental.replace('<head>','<head><base href="../">',1).replace(
        original,"script-src 'self' 'unsafe-inline' blob: 'wasm-unsafe-eval';",1)
    (wasm_entry/'index.html').write_text(markup,encoding='utf8')
    (dist/'vfx-effekseer-race.html').unlink(missing_ok=True)
    game=assets/'index-Cam3Integrated.js' 
    with game.open('a',encoding='utf8') as dst:
        dst.write("""
if(fxReview&&(location.pathname.endsWith('/vfx-effekseer/')||location.pathname.endsWith('/vfx-effekseer/index.html'))&&new URLSearchParams(location.search).get('efk')==='1'){
 import('./vfx40/effekseer-race.mjs').then(({enableRaceEffekseer})=>enableRaceEffekseer({
  renderer:sp.renderer,camera:sp.camera,composer:sp.composer,player:()=>$.state==='race'?$.player:null
 })).catch(error=>console.warn('[optional Effekseer]',error));
}
""")
    review=assets/'review.mjs'
    s=review.read_text(encoding='utf8')
    s=s.replace("  const cars=new Map",'''  const spirit=document.createElement('a');
  spirit.href='./spirit-tiger/';spirit.textContent='3D 金虎';ui.append(spirit);
  const cars=new Map''')
    review.write_text(s,encoding='utf8')
