import {isRiggedKart, loadRiggedKart, createRiggedKart} from "./rigged-karts.mjs";
import {GarageStage as Cam3Stage} from './stage-DtUJQvYs.js';
import {c as Box3} from './BufferGeometryUtils-B1nfbDRm.js';
export class GarageStage extends Cam3Stage {
  async ensureModels(ids) {
    // Let the inherited show() allocate the selection sequence before loading.
    const id = this._riggedRequests?.get(this._seq);
    if (!id) return super.ensureModels(ids);
    try { await loadRiggedKart(id); }
    catch (error) { console.warn("[garage] kart not available", id, error); }
  }

  async show(id) {
    if (isRiggedKart(id)) {
      this._riggedRequests ??= new Map();
      // The inherited show() increments _seq synchronously before its first await.
      const seq = this._seq + 1;
      this._riggedRequests.set(seq, id);
      try { return await super.show(id); }
      finally { this._riggedRequests.delete(seq); }
    }
    if(id==='birthday-star-6') {
      const model=await import('./birthday-model.mjs');
      const [,hero]=await Promise.all([model.loadBirthdayModel(),model.loadStandingHero()]);
      this._birthdayMod=model;this._birthdayStandingHero=hero;
    }
    return super.show(id);
  }
  _makeCar(id) {
    if (isRiggedKart(id)) {
      const model = createRiggedKart(id, { garage: true });
      return model && {group: model.group, info: {wheels: model.wheels.length}};
    }
    if(id!=='birthday-star-6')return super._makeCar(id);
    const car=this._birthdayMod.createBirthdayModel();
    const hero=this._birthdayStandingHero.clone(true);
    const bounds=new Box3().setFromObject(car.group),hb=new Box3().setFromObject(hero);
    hero.position.set(bounds.max.x-hb.min.x+.16,-hb.min.y,.2);car.group.add(hero);
    return {group:car.group,info:{wheels:car.wheels.length}};
  }
}
