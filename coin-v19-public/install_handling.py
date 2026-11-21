"""Install the isolated handling modules into the accepted game build."""
import shutil
from pathlib import Path


def install_handling(root, dist):
    source = root / 'handling-lab'
    for name in ('vehicle-feel.mjs', 'vehicle-effects.mjs', 'vehicle-audio.mjs'):
        shutil.copyfile(root / name, dist / 'assets' / name)
    if source.is_dir():
        for path in source.iterdir():
            if path.is_file():
                shutil.copyfile(path, dist / path.name)

    asset = dist / 'assets/index-Cam3Integrated.js'
    script = asset.read_text(encoding='utf8')

    def replace(old, new):
        nonlocal script
        matches = script.count(old)
        if matches != 1:
            raise RuntimeError(f'Expected one handling integration point for {old!r}, got {matches}')
        script = script.replace(old, new, 1)

    script = """import {handling,groundTypes,retained,signatureState,prepareSignature,finishSignature,landSignature,garageMeters} from './vehicle-feel.mjs';
import {updateSignatureVisual} from './vehicle-effects.mjs';
import {SignatureAudio,playSignature} from './vehicle-audio.mjs';
const signatureAudio=new SignatureAudio();
""" + script
    replace('this.stats=t.stats;let i=gu(n.mode);this.profile=i,this.speedCap=vu.maxSpeed*i.speed',
            """this.stats=t.stats;this.signature=signatureState(r.group.name);let i=gu(n.mode),tune=this.signature?.tune;
if(tune)i={...i,accel:i.accel*tune.accel,brake:i.brake*tune.brake,yawRate:i.yawRate*tune.steer,
steerSmoothLambda:i.steerSmoothLambda*tune.response,boostScale:i.boostScale*tune.boost};
this.profile=i,this.speedCap=vu.maxSpeed*i.speed*(tune?.speed??1)""")
    replace('this.offroad&&(e*=this.offroadFactor)', 'this.offroad&&(e*=this.signature?.track?.handledSurface?1:this.signature?retained(this.offroadFactor,this.signature.tune.terrain):this.offroadFactor)')
    replace('applyBoost(e,t){this.boostPower', """applyBoost(e,t){
if(this.signature){
 const s=this.signature;
 t*=s.tune.duration;
 if(this.boostTime<.22 || e*this.profile.boostScale>this.boostPower+1.5){
   s.boostSequence++;s.boostFlash=.88;
 }
}this.boostPower""")
    replace('this.spinTime=e,this.drifting=!1', 'this.spinTime=e*(this.signature?.tune.impact??1),this.drifting=!1')
    replace('this.speed*=.25,!0)', 'this.speed*=retained(.25,this.signature?.tune.impact??1),!0)')
    replace('if(r!=null){this.surfaceGrip=P.damp(this.surfaceGrip,r,3.4,e);let i=n.course?.surfaceLateral?.[t]??1;this.surfaceLateral=P.damp(this.surfaceLateral,i,3.4,e)}',
            """if(this.signature){
const ground=groundTypes[this.signature.terrain]??groundTypes.asphalt, terrain=this.signature.tune.terrain;
const grip=n.handledSurface?ground.retention:r??1;
this.surfaceGrip=P.damp(this.surfaceGrip,retained(grip,terrain),3.4,e);
this.surfaceLateral=P.damp(this.surfaceLateral,retained(n.handledSurface?ground.lateral:n.course?.surfaceLateral?.[t]??1,terrain),3.4,e);
}else if(r!=null){this.surfaceGrip=P.damp(this.surfaceGrip,r,3.4,e);let i=n.course?.surfaceLateral?.[t]??1;this.surfaceLateral=P.damp(this.surfaceLateral,i,3.4,e)}""")
    replace('o=r?0:-t.steer;this.slipTime', 'o=r?0:-t.steer;prepareSignature(this,e,i,a);this.slipTime')
    replace('this._steerSmooth||o,o,this.profile.steerSmoothLambda',
            '(this.signature?this._steerSmooth:this._steerSmooth||o),o,this.profile.steerSmoothLambda')
    replace('vu.offroadDrag*(this.offroadFactor/vu.offroadFactor)*e',
            'vu.offroadDrag*(this.offroadFactor/vu.offroadFactor)*(this.signature?.tune.terrain??1)*e')
    replace('vu.coastDrag*this.profile.coastDrag*(this.speed*this.speed)',
            'vu.coastDrag*this.profile.coastDrag*(i>0?(this.signature?.tune.accel??1):this.signature?.id==="monster-truck"?.92:1)*(this.speed*this.speed)')
    replace('this.driftCharge+=e*(.7+.5*l)', 'this.driftCharge+=e*(.7+.5*l)*(this.signature?.tune.drift??1)')
    replace('vu.driftYawBonus*.42*o)*u*this.stats.grip*this.profile.yawRate',
            'vu.driftYawBonus*.42*o)*u*this.stats.grip*this.profile.yawRate*(this.signature?.tune.drift??1)')
    replace('this.position.y<=g?(!this.grounded&&this.airTime>.35',
            'this.position.y<=g?(!this.grounded&&landSignature(this,this.vy),!this.grounded&&this.airTime>.35')
    replace('this.speed*=1-Math.min(.55*this.profile.wallScrub,n)',
            'this.speed*=1-Math.min(.55*this.profile.wallScrub,n)*(this.signature?.tune.impact??1)')
    replace('this.yaw=bu(this.yaw,a,3.5+9*l,e)',
            'this.yaw=bu(this.yaw,a,(3.5+9*l)*(this.signature?.tune.impact??1),e)')
    replace('this.lateral*=-vu.wallBounce*this.profile.wallBounce',
            'this.lateral*=-vu.wallBounce*this.profile.wallBounce*(this.signature?.tune.impact??1)')
    replace('(-S*.035+(this.grounded?0:-.06))*(this.model.pitchScale??1)',
            '(-S*.035+(this.grounded?0:-.06)-(this.signature?.launchTime??0)*.08)*(this.signature?.tune.pitch??this.model.pitchScale??1)')
    replace('return this.progress=n.progress(h.loc),h}_releaseDrift',
            'finishSignature(this,n,h,e);return this.progress=n.progress(h.loc),h}_releaseDrift')
    replace('dispose(){this.scene?.remove(this.object),this.object.traverse',
            'dispose(){this.model.signatureFx?.dispose();this.scene?.remove(this.object),this.object.traverse')
    replace('r.lateral-=c.dot(r.right)*26,i.lateral+=c.dot(i.right)*26',
            'r.lateral-=c.dot(r.right)*26*(r.signature?.tune.impact??1),i.lateral+=c.dot(i.right)*26*(i.signature?.tune.impact??1)')
    replace('function Pm(e){if($.state!==`menu`)',
            'function Pm(e){if($.state!==`race`||X.muted)signatureAudio.stop();if($.state!==`menu`)')
    replace('t.syncVisual(e),Fm(t,e)', 't.syncVisual(e),updateSignatureVisual(t,e,vp,_t.tier==="high"?2:1),Fm(t,e)')
    replace('e.boostTime>0&&Math.random()<t*60', '!e.signature&&e.boostTime>0&&Math.random()<t*60')
    replace('if(e.offroad&&e.grounded&&Math.abs(e.speed)>4',
            'if(e.signature?.id!=="monster-truck"&&e.offroad&&e.grounded&&Math.abs(e.speed)>4')
    replace('X.update(e,$.player),Z.update(e,$)',
            """X.update(e,$.player),Z.update(e,$);
if($.state==="race"&&$.player.signature&&X.ready&&!X.muted){
 X.engine.out.gain.setTargetAtTime(0,X.ctx.currentTime,.07);
 signatureAudio.update(X.ctx,X.master,$.player.signature,$.player.speed,$.player.finished);
}""")
    replace('case`boost`:r&&X.boost(),t===$.player',
            'case`boost`:r&&!t?.signature&&X.boost(),t===$.player')
    replace('$.player.justBoosted&&(X.boost(),yp.addShake',
            '$.player.justBoosted&&(!$.player.signature&&X.boost(),yp.addShake')
    replace('async function dm(e){hf(e)&&(Q.setSelected(e),await lm(e))}',
            """async function dm(e){
 if(!hf(e))return;
 if(handling[e]&&Q.selectedId!==e&&!X.muted){X.init();X.resume();playSignature(X.ctx,X.master,e,'garage');}
 Q.setSelected(e);await lm(e);
}""")
    replace('this.el.pDesc.textContent=e.desc,this.el.pStats.innerHTML=xf.map',
            'this.el.pDesc.textContent=handling[e.id]?.description??e.desc,this.el.pStats.innerHTML=garageMeters(e.id)||xf.map')
    title_link = '<a class="handling-lab-link" href="./handling-lab.html">双车试车场</a>'
    replace('id="playBtn">开始游戏</button>', 'id="playBtn">开始游戏</button>' + title_link)
    # Use exactly the same physics class, constants, mode and stock car stats in the range.
    start = script.index('var _u=Math.PI*2,vu=')
    end = script.index('var xu=class', start)
    body = script[start:end]
    modes = script[script.index('mu={'):script.index('var _u=Math.PI*2')]
    engine = """import {dr as I} from './BufferGeometryUtils-B1nfbDRm.js';
import {handling,groundTypes,retained,signatureState,prepareSignature,finishSignature,landSignature,clamp,damp} from './vehicle-feel.mjs';
import {t as St} from './model-MAgXfVWW.js';
export const stockCar=St[1];
const P={clamp,damp},_t={opponentShadows:true};
""" + 'var ' + modes + '\n' + body + '\nexport {yu as KartPhysics};\n'
    (dist / 'assets/handling-engine.mjs').write_text(engine, encoding='utf8')
    asset.write_text(script, encoding='utf8')

    rig = dist / 'assets/rigged-karts.mjs'
    rig_text = rig.read_text(encoding='utf8')
    rig_text = "import {createVehicleFx} from './vehicle-effects.mjs';\n" + rig_text
    rig_text = rig_text.replace('const driver = new Group();',
        'const signatureFx=createVehicleFx(id,garage);body.add(signatureFx.root);\n  const driver = new Group();')
    rig_text = rig_text.replace('return { group, body, driver,', 'return { group, body, driver, signatureFx,')
    rig_text = rig_text.replace('lookAhead: 4.6, shoulder', 'lookAhead: 4.6, boostDistGain: 1.65, boostFovGain: 5, shoulder')
    rig_text = rig_text.replace('lookAhead: 4.25, shoulder', 'lookAhead: 4.25, boostDistGain: 1.45, boostFovGain: 5, shoulder')
    rig.write_text(rig_text, encoding='utf8')

    stage = dist / 'assets/stage-birthday-integration.mjs'
    stage_text = stage.read_text(encoding='utf8')
    stage_text = stage_text.replace('try { return await super.show(id); }',
        '''try {
        const ok=await super.show(id);
        if(ok&&this.currentId===id) this._signaturePreview=0.8;
        return ok;
      }''')
    stage_text = stage_text.replace('  _makeCar(id) {', '''  update(dt) {
    super.update(dt);
    const model=this._car?.userData.signatureModel;
    if(!model) return;
    const accent=this._signaturePreview=Math.max(0,(this._signaturePreview||0)-dt);
    model.signatureFx.update(0,accent,this._t);
    if(this.currentId==='monster-truck') model.body.rotation.x=Math.sin(this._t*63)*accent*.018;
  }
  _makeCar(id) {''')
    stage_text = stage_text.replace('return model && {group:', 'if(model) model.group.userData.signatureModel=model;\n      return model && {group:')
    stage.write_text(stage_text, encoding='utf8')

    index = dist / 'index.html'
    html = index.read_text(encoding='utf8')
    html = html.replace('</head>', '<link rel="stylesheet" href="./handling-entry.css"></head>', 1)
    index.write_text(html, encoding='utf8')
