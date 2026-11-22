"""Stage the original art still used by the isolated exhaust build."""
import shutil

def install_fx40(root,dist):
    source=root/'fx40'
    assets=dist/'assets'
    runtime=assets/'vfx40'
    runtime.mkdir(exist_ok=True)
    for name in ('rear-effects.mjs','backfire-events.mjs'):
        shutil.copyfile(source/'runtime'/name,assets/name)
    for name in ('gold-flow.png','thunder-flow.png','electric-forks.png','cinder.png'):
        shutil.copyfile(source/'resources'/name,runtime/name)
    # Old build outputs may exist when the installer is run incrementally.
    for name in ('assets/tiger-pounce.mjs','assets/vfx40/spirit-tiger.glb',
                 'assets/vfx40/effekseer-race.mjs','spirit-tiger/index.html',
                 'spirit-tiger/tiger-preview.mjs','vfx-effekseer/index.html'):
        (dist/name).unlink(missing_ok=True)
