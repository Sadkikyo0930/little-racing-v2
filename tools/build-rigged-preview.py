"""Build an isolated, locally hosted copy with the existing demo safety controls."""
from pathlib import Path
from hashlib import sha256
import json,subprocess,sys

root=Path(__file__).resolve().parents[1]
out=Path(sys.argv[1]).resolve()
subprocess.run([sys.executable,'-X','utf8',str(root/'tools/build-preview.py'),str(out)],check=True)
runtime=out/'preview-runtime.js'
s=runtime.read_text(encoding='utf-8')
s=s.replace('lrv2.cam3.selftest.20261112:', 'lrv2.dual-kart.demo.20261121:')
s=s.replace('{coins:5000,updatedAt:at}', '{coins:6500,updatedAt:at}')
s=s.replace("frag_common:{at,source:'isolated-demo'},turtle", "moto:{at,source:'isolated-demo'},frag_common:{at,source:'isolated-demo'},turtle")
s=s.replace("localStorage.setItem('preview.fixture.v1','true');", "localStorage.setItem('preview.birthday.claimed','true');\n    localStorage.setItem('preview.fixture.v1','true');")
runtime.write_text(s,encoding='utf-8')
if '--qa' in sys.argv[2:]:
    entry=out/'assets/index-Cam3Integrated.js'
    with entry.open('a',encoding='utf-8') as f:
        f.write("""
window.__dualKartQA = () => {
  const player = $.player;
  const model = player?.model;
  const asset = model?.body?.children[0];
  return {
    save: Co(), state: $.state, race: $.race?.state,
    garage: im?.currentId, selected: Z.vehicle, activeKart: model?.group?.name,
    activeDriver: !!asset?.getObjectByName('DriverMount')?.children.length,
    speed: player?.speed,
    camera: sp.camera.position.toArray(),
    wheels: model?.wheels.map(wheel => ({
      spin: wheel.spin.rotation.x, yaw: wheel.pivot.rotation.y,
      radius: wheel.radius, steer: wheel.steer
    })),
    render: { ...sp.renderer.info.memory, ...sp.renderer.info.render }
  };
};
""")
manifest={p.relative_to(out).as_posix():sha256(p.read_bytes()).hexdigest()
          for p in out.rglob('*') if p.is_file() and p.name not in ('production-sha256.json','.nojekyll')}
(out/'production-sha256.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf-8')
