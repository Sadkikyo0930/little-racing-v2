"""Build the public static demo from the audited, isolated candidate."""
import hashlib,json,shutil
from pathlib import Path
from install_handling import install_handling
from install_fx21 import install_fx21

root=Path(__file__).resolve().parent
source=root.parent/'coin-v19-candidate/site'
dist=root/'dist'
shutil.copytree(source,dist,dirs_exist_ok=True)
dist.joinpath('assets/public-coin-mock.mjs').write_bytes(root.joinpath('public-coin-mock.mjs').read_bytes())
file=dist/'assets/coin-garage.mjs'
s=file.read_text(encoding='utf8')
before='device:getDevice(), expectedFamily:bridge.content, allowEquipSync:true,'
assert s.count(before)==1
s='import {mockCoinFetch} from "./public-coin-mock.mjs";\n'+s.replace(before,before+'\n  fetchImpl:mockCoinFetch,')
file.write_text(s,encoding='utf8')
stub=dist/'preview-runtime.js'
s=stub.read_text(encoding='utf8')
s=s.replace("'use strict';","""'use strict';
  const cleanUrl=new URL(location.href);
  if(cleanUrl.searchParams.has('d')){
    cleanUrl.searchParams.delete('d');
    history.replaceState(history.state,'',cleanUrl.href);
  }""",1)
s=s.replace('隔离试玩 · 模拟金币 · 无正式云调用','公网隔离试玩 · 模拟金币 · 无正式云调用')
stub.write_text(s,encoding='utf8')
m=dist/'manifest.webmanifest'
data=json.loads(m.read_text(encoding='utf8'))
data.update(name='小小赛车 V2 · 隔离试玩',short_name='赛车试玩')
m.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
install_handling(root, dist)
install_fx21(root, dist)
manifest={p.relative_to(dist).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
          for p in dist.rglob('*') if p.is_file() and p.name not in ('production-sha256.json','.nojekyll')}
(dist/'production-sha256.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf8')
print(f'{len(manifest)} static preview files')
