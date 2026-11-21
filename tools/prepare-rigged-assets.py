"""Make integration-specific GLBs without changing the verified wheels or image bytes."""
from pathlib import Path
import json,struct,sys

inp=Path(sys.argv[1])
dest=Path(__file__).resolve().parents[1]/'docs/assets/karts'
dest.mkdir(exist_ok=True)
for name,emission in [('tiger-kart',.64),('monster-truck',.78)]:
    filename=name+'-final.glb'
    source=(inp/filename).read_bytes()
    size,=struct.unpack_from('<I',source,12)
    parsed=json.loads(source[20:20+size])
    for material in parsed['materials']:
        if 'emissiveFactor' in material:
            material['emissiveFactor']=[v*emission for v in material['emissiveFactor']]
        if name=='monster-truck' and 'normalTexture' in material:
            material['normalTexture']['scale']=.93
    if name=='monster-truck':
        # Leave the closed shell alone. Strip the two now-unused driver markers.
        nodes=parsed['nodes']
        removed={i for i,v in enumerate(nodes) if v.get('name') in ('DriverMount','DriverPackagingReference')}
        mapping={old:new for new,old in enumerate(i for i in range(len(nodes)) if i not in removed)}
        parsed['nodes']=[v for i,v in enumerate(nodes) if i not in removed]
        for node in parsed['nodes']:
            if 'children' in node:
                node['children']=[mapping[i] for i in node['children'] if i not in removed]
        for scene in parsed['scenes']:
            scene['nodes']=[mapping[i] for i in scene['nodes'] if i not in removed]
    encoded=json.dumps(parsed,separators=(',',':')).encode()
    encoded+=b' '*(-len(encoded)%4)
    binary=source[20+size:]
    result=struct.pack('<5I',0x46546C67,2,20+len(encoded)+len(binary),len(encoded),0x4E4F534A)+encoded+binary
    (dest/filename).write_bytes(result)
    print(name,len(result))
