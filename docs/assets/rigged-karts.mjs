import {
  G as Group, c as Box3, It as PlaneGeometry, bt as Mesh, xt as BasicMaterial,
} from './BufferGeometryUtils-B1nfbDRm.js';
import { t as GLTFLoader } from './GLTFLoader-BaXP2m-J.js';
import { r as shadowTexture } from './model-MAgXfVWW.js';
import { loadHeroA, createHeroADriver } from './heroA-DCvrBmCy.js';

const codes = ['FL', 'FR', 'RL', 'RR'];
const configs = {
  'tiger-kart': {
    scale: 3.07, road: -.00218, driver: true, steerMax: 16,
    cam: { dist: 7.7, height: 4.7, lookY: 1.16, lookAhead: 4.6, shoulder: .85 },
    camShort: { dist: 8.3, height: 4.85, lookY: 1.13, lookAhead: 4.25, shoulder: .85 },
  },
  'monster-truck': {
    scale: 3.28, road: .00001, driver: false, steerMax: 14,
    cam: { dist: 8.35, height: 4.1, lookY: 1.49, lookAhead: 4.45 },
    camShort: { dist: 9.1, height: 4.65, lookY: 1.36, lookAhead: 4.25 },
  },
};
const loader = new GLTFLoader();
const loads = new Map();
const prototypes = new Map();

export const isRiggedKart = id => Object.hasOwn(configs, id);

export function loadRiggedKart(id) {
  if (!isRiggedKart(id)) return Promise.reject(new Error('Unknown kart: ' + id));
  if (prototypes.has(id)) return Promise.resolve(prototypes.get(id));
  if (loads.has(id)) return loads.get(id);
  const config = configs[id];
  const ready = Promise.all([
    loader.loadAsync(new URL('./karts/' + id + '-final.glb', import.meta.url).href),
    config.driver ? loadHeroA() : null,
  ]).then(([{ scene }, hero]) => {
    for (const code of codes) {
      const spin = scene.getObjectByName('Wheel_' + code);
      const pivot = scene.getObjectByName((code.startsWith('F') ? 'Steer_' : 'Axle_') + code);
      if (!spin || !pivot || spin.parent !== pivot || !(spin.userData.radius > 0)) {
        throw new Error('Invalid wheel joint ' + id + ' ' + code);
      }
    }
    if (config.driver && (!hero || !scene.getObjectByName('DriverMount'))) {
      throw new Error('Missing tiger driver or mount');
    }
    scene.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = false;
      node.userData.sharedAsset = true;
    });
    prototypes.set(id, scene);
    return scene;
  }).finally(() => loads.delete(id));
  loads.set(id, ready);
  return ready;
}

export function createRiggedKart(id, { garage = false } = {}) {
  const proto = prototypes.get(id);
  if (!proto) return null;
  const config = configs[id];
  const model = proto.clone(true);
  model.scale.setScalar(config.scale);
  model.position.y = -config.road * config.scale;

  const group = new Group();
  group.name = id;
  const body = new Group();
  body.add(model);
  group.add(body);

  // The main race animator expects a driver transform. The empty handle needs no mesh.
  const driver = new Group();
  if (config.driver) {
    const hero = createHeroADriver({ y: 0, z: 0, scale: 1 });
    model.getObjectByName('DriverMount').add(hero);
  }
  const wheels = codes.map(code => {
    const steer = code.startsWith('F');
    const pivot = model.getObjectByName((steer ? 'Steer_' : 'Axle_') + code);
    const spin = model.getObjectByName('Wheel_' + code);
    return { pivot, spin, steer, restY: pivot.position.y, suspension: 0,
      radius: spin.userData.radius * config.scale };
  });
  const bounds = new Box3().setFromObject(model);
  const blob = garage ? null : new Mesh(
    new PlaneGeometry((bounds.max.x - bounds.min.x) * 1.17, (bounds.max.z - bounds.min.z) * 1.17),
    new BasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: .85 })
  );
  if (blob) {
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = .03;
    blob.renderOrder = -1;
    group.add(blob);
  }

  return { group, body, driver, driverLean: 0, wheels, blob, flames: [], wheelRadius: wheels[0].radius,
    steerMax: config.steerMax * Math.PI / 180, cam: config.cam, camShort: config.camShort };
}
