/**
 * 小小赛车 V2 — NPC 角色资源模块（游戏侧入口 · 第二阶段）
 *
 * 只保存「角色数据」和「模型路径解析」，不加载、不渲染、不参与比赛逻辑，
 * 因此不会给现有赛车增加任何性能负担，也不会改动物理 / AI / HUD。
 * 后续剧情系统可以从这里按 id 取角色，再按需 import() 模型。
 *
 * 模型统一：Y 轴向上、高度 1.8、足底 y=0、正面朝 +Z、不透明 glTF PBR 材质、GLB。
 *
 * 第二阶段：纯数据（characters.js）与路径解析（本文件）继续分开；
 * 独立 3D 预览页复用同一份数据 + 同一个 animator，保证预览与游戏表现一致。
 * 本模块目前仍未被任何比赛代码 import，因此不进 dist/、不影响赛车构建。
 *
 * 动作修订：挥手已彻底移除（不再有手臂变形属性），转身改为目标朝向 slerp。
 */

import { getCharacter } from './characters.js';

export {
  CHARACTERS, NPC_ACTIONS, TURN_SPEC, getCharacter, characterIds, getAction,
} from './characters.js';
export { NpcAnimator, TARGET_YAW, ACTION_IDS } from './animator.js';

/** 模型文件统一放在这个目录下，替换模型时只改文件名即可。 */
export const CHARACTER_ASSET_DIR = new URL('../assets/characters/', import.meta.url);

/** 解析出可用于 GLTFLoader 的 URL；new URL 保证 Pages 子路径正确。 */
export function characterModelUrl(characterOrId) {
  const c = typeof characterOrId === 'string' ? getCharacter(characterOrId) : characterOrId;
  if (!c) return null;
  return new URL(c.model, CHARACTER_ASSET_DIR).href;
}

export default CHARACTERS;
