import {GarageStage as Cam3Stage} from './stage-DtUJQvYs.js';
import {c as Box3} from './BufferGeometryUtils-B1nfbDRm.js';
export class GarageStage extends Cam3Stage {
  async show(id) {
    if(id==='birthday-star-6') {
      const model=await import('./birthday-model.mjs');
      const [,hero]=await Promise.all([model.loadBirthdayModel(),model.loadStandingHero()]);
      this._birthdayMod=model;this._birthdayStandingHero=hero;
    }
    return super.show(id);
  }
  _makeCar(id) {
    if(id!=='birthday-star-6')return super._makeCar(id);
    const car=this._birthdayMod.createBirthdayModel();
    const hero=this._birthdayStandingHero.clone(true);
    const bounds=new Box3().setFromObject(car.group),hb=new Box3().setFromObject(hero);
    hero.position.set(bounds.max.x-hb.min.x+.16,-hb.min.y,.2);car.group.add(hero);
    return {group:car.group,info:{wheels:car.wheels.length}};
  }
}
