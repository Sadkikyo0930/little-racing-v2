"""V2.1 effects for the isolated candidate, over the accepted V2 handling build."""
import shutil


def install_fx21(root, dist):
    source = root / 'fx21'
    assets = dist / 'assets'
    for name in ('rear-effects.mjs', 'tiger-roar.mjs', 'review.mjs'):
        shutil.copyfile(source / name, assets / name)
    shutil.copytree(source / 'audio', assets / 'fx-audio', dirs_exist_ok=True)
    shutil.copyfile(source / 'review.css', dist / 'fx-review.css')

    index = dist / 'index.html'
    index.write_text(index.read_text(encoding='utf8').replace(
        '</head>', '<link rel="stylesheet" href="./fx-review.css"></head>', 1), encoding='utf8')
    lab = dist / 'handling-lab.mjs'
    lab.write_text(lab.read_text(encoding='utf8').replace(
        'updateSignatureVisual(player,dt,particles,lite?1:2)', 'updateSignatureVisual(player,dt,particles,lite?1:2,camera)'
    ).replace('const pause=()=>{held.clear();audio.stop();};',
        'const pause=()=>{held.clear();audio.stop();stopTigerRoar(ctx);};'
    ).replace("import {SignatureAudio,playSignature}", "import {SignatureAudio,playSignature,stopTigerRoar}"
    ).replace('if(muted)audio.stop();else unlock();','if(muted){audio.stop();stopTigerRoar(ctx);}else unlock();'
    ).replace('held.clear();particles.reset();audio.stop();','held.clear();particles.reset();audio.stop();stopTigerRoar(ctx);'),
        encoding='utf8')

    audio = dist / 'handling-audio.mjs'
    audio.write_text(audio.read_text(encoding='utf8').replace(
        'import {SignatureAudio,playSignature}', 'import {SignatureAudio,playSignature,stopTigerRoar}'
    ).replace('cancelAnimationFrame(frame);playback.stop();','cancelAnimationFrame(frame);playback.stop();stopTigerRoar(ctx);'
    ).replace('},1080);','},clip===\'boost\'?1500:1080);'), encoding='utf8')

    game = assets / 'index-Cam3Integrated.js'
    s = game.read_text(encoding='utf8')

    def patch(before, after):
        nonlocal s
        count = s.count(before)
        if count != 1:
            raise RuntimeError(f'Expected one V2.1 integration point for {before!r}, got {count}')
        s = s.replace(before, after, 1)

    s = """import {createReview,comparisonCamera,reviewedVehicles} from './review.mjs';
const fxReview=new URLSearchParams(location.search).get('fx-review')==='1';
const fxCapture=fxReview&&new URLSearchParams(location.search).get('fx-capture')==='1';
let fxRun=0,fxFramePending=null;
""" + s
    patch("import {SignatureAudio,playSignature}", "import {SignatureAudio,playSignature,prepareTigerRoar,stopTigerRoar}")
    patch('function Rm(e){X.toggleMute(e)', 'function Rm(e){if(e)stopTigerRoar(X.ctx);X.toggleMute(e)')
    patch('updateSignatureVisual(t,e,vp,_t.tier==="high"?2:1)',
          'updateSignatureVisual(t,e,vp,_t.tier==="high"?2:1,sp.camera)')
    patch('this.composer.render(),this.frameCount++',
          'this.composer.render(),fxFramePending&&(fxFramePending(this.canvas.toDataURL("image/jpeg",.92)),fxFramePending=null),this.frameCount++')
    patch('if(handling[e]&&Q.selectedId!==e&&!X.muted){X.init();X.resume();playSignature(X.ctx,X.master,e,\'garage\');}\n Q.setSelected(e);await lm(e);',
          """const changed=Q.selectedId!==e;Q.setSelected(e);
 if(changed)stopTigerRoar(X.ctx);
 if(handling[e]&&changed&&!X.muted){
  X.init();X.resume();playSignature(X.ctx,X.master,e,'garage');
 }
 await lm(e);""")
    patch('function um(){if($.state!==`garage`)return;',
          'function um(){if($.state!==`garage`)return;stopTigerRoar(X.ctx);')
    patch('function Jp(e){for', 'function Jp(e,reviewCar){for')
    patch('$.drivers.length=0;let t=jp.includes(Z.vehicle)?Z.vehicle:null,n=',
          '$.drivers.length=0;let t=reviewCar??(jp.includes(Z.vehicle)?Z.vehicle:null),n=')
    patch('birthday=r&&t===BIRTHDAY_ID&&birthdayOwned&&birthdayModel',
          'birthday=r&&t===BIRTHDAY_ID&&(birthdayOwned||!!reviewCar)&&birthdayModel')
    patch('for(let e=0;e<ep;e++){let n=s[e%s.length],r=e===0',
          'for(let e=0;e<(reviewCar?3:ep);e++){let n=s[e%s.length],r=e===0')
    patch('async function Zp(e){', 'async function Zp(e,reviewCar=null){')
    patch('let t=jp.includes(Z.vehicle)?Z.vehicle:null;t&&(!_f(t,_o())||!gf(t))',
          'if(!fxReview||!Object.hasOwn(reviewedVehicles,reviewCar))reviewCar=null;'
          'let t=reviewCar??(jp.includes(Z.vehicle)?Z.vehicle:null);t&&!reviewCar&&(!_f(t,_o())||!gf(t))')
    patch('Jp(t?Ep:e),$.playerAuto', 'Jp(t?Ep:e,reviewCar),$.playerAuto')
    patch('X.init(),X.resume(),X.setMusicState(`countdown`)',
          'X.init(),X.resume(),$.player?.signature?.id==="tiger-kart"&&void prepareTigerRoar(X.ctx),X.setMusicState(`countdown`)')
    patch('let i=$.player.drifting,a=$.player.driftTier;$.player.update(e,r,fp)',
          """if(fxReview&&fxRun>0){
 let p=$.player,h=fp.surfaceAt(p.position,p.trackIndex),next=fp.getTangent(fp.sampleAt(h.loc.index+13));
 let error=Math.atan2(next.x,next.z)-p.yaw;
 error=Math.atan2(Math.sin(error),Math.cos(error));
 r={...jm,throttle:1,steer:P.clamp(-error*1.25+h.loc.lat*.09,-.62,.62)};
 fxRun=Math.max(0,fxRun-e);
}let i=$.player.drifting,a=$.player.driftTier;$.player.update(e,r,fp)""")
    patch('case`raceOver`:{$.state=`results`', 'case`raceOver`:{if(fxReview)return;$.state=`results`')
    patch('function presentBirthdayIfOnMenu(){if(!birthdayShowPending', 'function presentBirthdayIfOnMenu(){if(fxReview||!birthdayShowPending')
    patch('>双车试车场</a>', '>双车试车场</a><a class="handling-lab-link" href="./?fx-review=1">三车特效对比</a>')
    s += '\n' + (source / 'review-runtime.inc').read_text(encoding='utf8')
    game.write_text(s, encoding='utf8')
