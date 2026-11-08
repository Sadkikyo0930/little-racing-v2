import * as THREE from 'three';
import {
  sidingTexture, boardWallTexture, stuccoTexture, shingleTexture, thatchTexture,
  woodTexture, fabricTexture, stoneTexture, palmTexture, bannerTexture,
} from '../beachTextures.js';

/* ==================================================================
 * Blender 资产的材质映射表。
 *
 * GLB 里只存「材质名 + 纯色」，这里按名字换成带 canvas 贴图的
 * MeshStandardMaterial。好处：
 *   · 网络包只多几十 KB 几何，不背二十张 PNG；
 *   · 想调色/换风格只改这一张表，不用回 Blender 重导；
 *   · 贴图密度按「米」定 —— Blender 侧导出的 UV 就是米制，
 *     所以 repeat = 1 / 每格多少米。
 *
 * 每个材质名对应唯一的贴图缓存键，因此这里可以直接改 repeat，
 * 不会串到别的材质上。
 * ================================================================== */

const cache = new Map();

function rep(tex, metersPerTile) {
  if (!tex) return null;
  const r = 1 / metersPerTile;
  tex.repeat.set(r, r);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const std = (o) => new THREE.MeshStandardMaterial({
  metalness: 0, envMapIntensity: 0.45, ...o,
});

/** 材质名 → THREE 材质（懒建、缓存） */
export function ch2Material(name) {
  if (cache.has(name)) return cache.get(name);
  const m = build(name);
  m.name = name;
  cache.set(name, m);
  return m;
}

function build(name) {
  switch (name) {
    case 'M_Wall_White': {
      /* ACES 色调映射 + 3.1 强度的正午直射光下，接近纯白的墙面会被压成
       * 一片没有明暗的纸板 —— 门窗、门廊、支撑柱全读不出来。压到
       * #c2b9a6 之后白墙才有「墙」的体积，蓝白小屋也才衬得出蓝色包角。 */
      const t = sidingTexture('#c2b9a6');
      return std({
        map: rep(t.map, 0.9), normalMap: rep(t.normalMap, 0.9),
        normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.88,
        envMapIntensity: 0.3,
      });
    }
    case 'M_Wall_Red': {
      const t = boardWallTexture('#b8422f');
      return std({
        map: rep(t.map, 0.85), normalMap: rep(t.normalMap, 0.85),
        normalScale: new THREE.Vector2(1.0, 1.0), roughness: 0.8,
      });
    }
    case 'M_Wall_Ochre': {
      const t = stuccoTexture('#e2ab5a');
      return std({
        map: rep(t.map, 1.3), normalMap: rep(t.normalMap, 1.3),
        normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.9,
      });
    }
    case 'M_Roof_Blue': {
      const t = shingleTexture('#3f7cae');
      return std({
        map: rep(t.map, 1.1), normalMap: rep(t.normalMap, 1.1),
        normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.72,
      });
    }
    case 'M_Roof_Slate': {
      const t = shingleTexture('#4c545e', 'rgba(12,16,22,0.45)');
      return std({
        map: rep(t.map, 1.1), normalMap: rep(t.normalMap, 1.1),
        normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.78,
      });
    }
    case 'M_Thatch': {
      const t = thatchTexture('#cfa758');
      return std({
        map: rep(t.map, 1.4), normalMap: rep(t.normalMap, 1.4),
        normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.96,
      });
    }
    case 'M_Thatch_Dark': {
      const t = thatchTexture('#a8832f', '#6f5320');
      return std({
        map: rep(t.map, 1.4), normalMap: rep(t.normalMap, 1.4),
        normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.96,
      });
    }
    case 'M_Trim_White': {
      const t = woodTexture('#e4ddcc', 'rgba(140,130,114,0.22)', 128, { grain: 10, knots: 0 });
      return std({
        map: rep(t.map, 0.8), normalMap: rep(t.normalMap, 0.8),
        normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.74,
        envMapIntensity: 0.3,
      });
    }
    case 'M_Trim_Blue': {
      const t = woodTexture('#3f86b4', 'rgba(16,44,66,0.30)', 128, { grain: 12, knots: 0 });
      return std({
        map: rep(t.map, 0.8), normalMap: rep(t.normalMap, 0.8),
        normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.68,
      });
    }
    case 'M_Trim_Red': {
      const t = woodTexture('#cc4636', 'rgba(80,16,10,0.30)', 128, { grain: 12, knots: 0 });
      return std({ map: rep(t.map, 0.8), roughness: 0.7 });
    }
    case 'M_Wood': {
      const t = woodTexture('#a87c4c', 'rgba(66,38,14,0.34)', 256, { grain: 30 });
      return std({
        map: rep(t.map, 1.2), normalMap: rep(t.normalMap, 1.2),
        normalScale: new THREE.Vector2(1.0, 1.0), roughness: 0.88,
      });
    }
    case 'M_Wood_Dark': {
      const t = woodTexture('#6d4a2a', 'rgba(34,20,8,0.42)', 256, { grain: 34 });
      return std({
        map: rep(t.map, 1.2), normalMap: rep(t.normalMap, 1.2),
        normalScale: new THREE.Vector2(1.0, 1.0), roughness: 0.9,
      });
    }
    case 'M_Wood_Pale': {
      const t = woodTexture('#c6a276', 'rgba(92,58,26,0.30)', 256, { grain: 28 });
      return std({
        map: rep(t.map, 1.0), normalMap: rep(t.normalMap, 1.0),
        normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.86,
      });
    }
    case 'M_Glass':
      return std({
        color: 0xa8d8e8, roughness: 0.12, metalness: 0.0,
        transparent: true, opacity: 0.66, envMapIntensity: 1.3,
        depthWrite: false,
      });
    case 'M_Metal':
      return new THREE.MeshStandardMaterial({
        color: 0x8b9099, roughness: 0.34, metalness: 0.85, envMapIntensity: 1.1,
      });
    case 'M_Fabric_Red': {
      const t = fabricTexture('#d94a40');
      return std({
        map: rep(t.map, 0.55), normalMap: rep(t.normalMap, 0.55),
        normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.88,
        side: THREE.DoubleSide,
      });
    }
    case 'M_Fabric_Cream': {
      const t = fabricTexture('#f6efdd');
      return std({
        map: rep(t.map, 0.55), normalMap: rep(t.normalMap, 0.55),
        normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.88,
        side: THREE.DoubleSide,
      });
    }
    case 'M_Rope': {
      const t = woodTexture('#d9c9a4', 'rgba(120,104,72,0.35)', 128, { grain: 40, knots: 0 });
      return std({ map: rep(t.map, 0.35), roughness: 0.95 });
    }
    case 'M_Rock_Light': {
      /* #c3bcaa 在正午阳光下会被推到接近纯白，礁石读成「白面包」。
       * 压到 #b0a68f 并且把环境光反射降到 0.35，才有潮湿岩石的重量。 */
      const t = stoneTexture('#b0a68f', 256, { mossy: 0.05 });
      return std({
        map: rep(t.map, 1.6), normalMap: rep(t.normalMap, 1.6),
        normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.95,
        envMapIntensity: 0.35,
      });
    }
    case 'M_Gate_Banner': {
      /* 起点门的横幅。UV 是米制平面投影：u = 世界 x ∈ [-9.3, 9.3]，
       * v = 世界 z ∈ [6.925, 8.075]。宽度 18.6 m、高 1.15 m 是 Blender
       * 里的盒子尺寸，所以 repeat/offset 直接按这个范围反算，字正好铺满
       * 一整条横幅，不会平铺成一片重复的花纹。 */
      const t = bannerTexture();
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.repeat.set(1 / 18.6, 1 / 1.15);
      t.offset.set(0.5, -6.925 / 1.15);
      return std({ map: t, roughness: 0.9, envMapIntensity: 0.25 });
    }
    case 'M_Rock_Dark': {
      /* 原来 #5b6066，从驾驶位看是逆光剪影，整块石头糊成一个黑团，
       * 只有在正对面才看得出棱角。抬到 #6b7178 并给环境反射 0.55，
       * 背光面也能读到灰蓝的岩石色，不再像一排黑三角旗。 */
      const t = stoneTexture('#6b7178', 256, { mossy: 0.04 });
      return std({
        map: rep(t.map, 1.6), normalMap: rep(t.normalMap, 1.6),
        normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.9,
        envMapIntensity: 0.55,
      });
    }
    case 'M_Rock_Wet': {
      const t = stoneTexture('#79807c', 256, { mossy: 0.20 });
      return std({
        map: rep(t.map, 1.4), normalMap: rep(t.normalMap, 1.4),
        normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.5, envMapIntensity: 0.9,
      });
    }
    case 'M_Moss': {
      const t = stuccoTexture('#6f8f45');
      return std({ map: rep(t.map, 0.5), roughness: 0.95 });
    }
    case 'M_Trunk': {
      const t = woodTexture('#8a6a46', 'rgba(46,30,14,0.40)', 256, { grain: 44, knots: 2 });
      return std({
        map: rep(t.map, 0.9), normalMap: rep(t.normalMap, 0.9),
        normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.92,
      });
    }
    case 'M_Frond': {
      const t = palmTexture(128);
      t.repeat.set(1, 1);
      return std({
        map: t, roughness: 0.86, side: THREE.DoubleSide,
        envMapIntensity: 0.35,
      });
    }
    case 'M_Coconut':
      return std({ color: 0x5b4326, roughness: 0.86 });
    case 'M_Stone': {
      const t = stoneTexture('#b0aa9a', 256, { mossy: 0.03 });
      return std({
        map: rep(t.map, 1.2), normalMap: rep(t.normalMap, 1.2),
        normalScale: new THREE.Vector2(1.0, 1.0), roughness: 0.94,
      });
    }
    case 'M_Sand_Grass':
      return std({ color: 0x92a45e, roughness: 0.95, side: THREE.DoubleSide });
    default:
      return std({ color: 0xcccccc, roughness: 0.9 });
  }
}
