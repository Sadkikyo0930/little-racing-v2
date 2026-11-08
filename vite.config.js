/**
 * A relative base means the built site works from any path — the GitHub Pages
 * project URL (/old-san-juan-kart/), `vite preview`, or a plain file server —
 * without hard-coding the repository name.
 */
import { defineConfig } from 'vite';

/**
 * The MIT licence of three.js requires its copyright notice to travel with
 * "all copies or substantial portions of the Software", and the bundle we ship
 * is exactly that. Minification strips comments, so the notice is re-attached
 * as a banner that esbuild's `legalComments: 'inline'` setting preserves.
 */
const BANNER = `/*!
 * Little Racing V2 — a child-friendly kart racer derived from Old San Juan Kart.
 * https://github.com/Sadkikyo0930/little-racing-v2
 *
 * Based on Old San Juan Kart — https://github.com/nasilvae/old-san-juan-kart
 * Original MIT Copyright (c) 2026 Nathaniel Silva.
 * Little Racing V2 modifications Copyright (c) 2026 Sadkikyo0930.
 * Released under the MIT licence.
 *
 * Bundles three.js — Copyright (c) 2010-2025 three.js authors — MIT licence.
 * https://github.com/mrdoob/three.js/blob/dev/LICENSE
 *
 * Full third-party notices: see THIRD-PARTY-NOTICES.md in the source repository.
 */`;

/**
 * 资源基路径（对应需求 4）：
 *   - 本地 dev / 未设置 VITE_BASE 时：'./'（相对路径，任意子目录、任意托管都可用）；
 *   - 正式版 CI：'/little-racing-v2/'      → 部署到 https://sadkikyo0930.github.io/little-racing-v2/
 *   - 测试版 CI：'/little-racing-v2-test/' → 部署到 https://sadkikyo0930.github.io/little-racing-v2-test/
 *
 * 关键：两个版本各自引用自己基路径下的 JS / CSS / 模型 / 音乐 / 图片资源，
 * 测试版构建产物里绝不会出现正式版路径（/little-racing-v2/）下的资源引用，
 * 因此测试版永远不会指向正式版资源。所有 GLB / 音乐 / 贴图的加载本身也是
 * 相对路径或基于 import.meta.url / document.baseURI，会随 base 自动对齐。
 */
const BASE = process.env.VITE_BASE || './';

export default defineConfig({
  base: BASE,
  plugins: [
    {
      // `output.banner` is emitted before minification and gets stripped, so
      // the notice is prepended in `generateBundle`, which runs after it.
      name: 'legal-banner',
      enforce: 'post',
      generateBundle(_options, bundle) {
        for (const file of Object.values(bundle)) {
          if (file.type === 'chunk' && file.isEntry) file.code = `${BANNER}\n${file.code}`;
        }
      },
    },
  ],
  build: {
    // Top-level await in main.js (used to yield to the loading screen)
    // requires es2022. Safari 15+/iOS 15+ support it.
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
