import { G as Group, It as PlaneGeometry, bt as Mesh, xt as Material } from "./BufferGeometryUtils-B1nfbDRm.js";
import { r as shadowTexture } from "./model-MAgXfVWW.js";
import { t as GLTFLoader } from "./GLTFLoader-BaXP2m-J.js";

let scene, pending;
export async function loadBirthdayModel() {
  return scene || (pending ??= new GLTFLoader()
    .loadAsync(new URL("./karts/birthday-star-6.glb?v=final", import.meta.url).href)
    .then(({scene: model}) => {
      if (!model.getObjectByName("DriverSeat")) throw new Error("Missing DriverSeat");
      model.traverse(node => {
        if (node.isMesh) {
          // Keep the original base-color texture visible under either scene's lighting.
          const original = node.material;
          node.material = new Material({map: original.map, color: original.color, side: original.side});
          node.castShadow = true;
          node.userData.sharedAsset = true;
        }
      });
      return scene = model;
    }).finally(() => { pending = null; }));
}

export function createBirthdayModel(driver) {
  if (!scene) return null;
  const group = new Group();
  group.name = "birthday-star-6";
  const body = new Group();
  body.add(scene.clone(true));
  if (driver) body.add(driver);
  group.add(body);
  const blob = new Mesh(new PlaneGeometry(2.8, 4.2),
    new Material({map: shadowTexture(), transparent: true, depthWrite: false, opacity: .85}));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = .03;
  group.add(blob);
  // The Tripo body includes all wheel meshes. The anchors are reference points.
  return {group, body, driver, wheels: [], blob, flames: [], wheelRadius: .399,
    cam: {height: 4, dist: 7.8}, camShort: {height: 4.4, dist: 8.5, lookY: 1}};
}

let standingHero;
export function loadStandingHero() {
  return standingHero ??= new GLTFLoader()
    .loadAsync(new URL("./hero-a-standing-7pv3jPFY.glb", import.meta.url).href)
    .then(({scene}) => scene)
    .catch(error => { standingHero = null; throw error; });
}
