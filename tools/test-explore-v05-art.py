from pathlib import Path
import re,hashlib
a=Path('docs/explore-v04.html').read_text()
b=Path('docs/explore-v05.html').read_text()
def road(x):
 m=re.search(r'const roads=\[(.*?)\];',x,re.S)
 assert m,'missing road data'
 return m.group(1)
assert road(a)==road(b),'road geometry changed'
assert 'window.__V04_AUDIT__' in b and 'window.__V05_ART__' in b
assert 'function clampIntoTunnel' in b and 'function clampCamera' in b
assert 'window.__V04_DEBUG__' in b
assert 'v05-market-stall' in b and "if(place(x,z,cr.y+3,8" in b
assert "kind:'v05-flower'" in b and 'const c=clearance(x,z,3,2.2,4)' in b
assert 'const trees2=' not in b and 'ART05.extraCanopies=trees.length*2' in b
assert 'r5-' not in b
assert 'window.localStorage' not in b
assert 'window.__V05_ART__=ART05' in b
print('PASS V0.5 contract: 9/9')
print('Road SHA256:',hashlib.sha256(road(b).encode()).hexdigest())
p=b.split('<script type="module">',1)[1].split('</script>',1)[0]
Path('/tmp/explore-v05-module.mjs').write_text(p)
