# V0.7 · 性能测试报告（含明确未测试项）

## 1. 测试环境与方法

- 渲染环境：**无头 Chromium + ANGLE / SwiftShader 软件渲染**（无真实 GPU）。
- 采样方式：页面内 `frameTimes` 记录 rAF 帧间隔，`__V07_DEBUG__.perf()` 输出
  `medianMs` / `p95Ms` / `worstMs` / `approxFps`，同时读取 `renderer.info`
  的 `drawCalls` / `triangles` / `geometries` / `textures` / `programs`。
- 两组配置：
  - 桌面模拟：1440×900、`DETAIL=1`、`TEXSIZE=512`、`pixelRatio=1`。
  - iPhone UA 模拟：390×844、`isMobile=true`、`hasTouch=true`、`DETAIL=0.62`、
    `TEXSIZE=256`、`pixelRatio=1`。
- 为避免两个 WebGL 页面同时抢占软件渲染器，采集完桌面数据后先关闭桌面页再开移动端页。
- 数据来源：`previews/V07-AUDIT.json`（`perf` / `mobilePerf` / `mobileAudit`），
  `PAGE_ERRORS 0`。

## 2. 实测数据

| 指标 | 桌面模拟 | iPhone UA 模拟 |
| --- | ---: | ---: |
| 有效帧样本 | 114 | 17 |
| median 帧耗时 | 411.2 ms | 344.6 ms |
| p95 帧耗时 | 1556.3 ms | 1178.3 ms |
| worst 帧耗时 | 3268.1 ms | 1178.3 ms |
| approxFps | **2.4** | **2.9** |
| drawCalls | 362 | 249 |
| triangles | 472 150 | 360 006 |
| geometries | 184 | 136 |
| textures | 30 | 17 |
| programs | 45 | 40 |
| mergedGroups / savedCalls | 13 / 91 | 13 / 91 |
| detail / textureSize | 1 / 512 | 0.62 / 256 |

移动端降级确实生效：Draw Call 从 362 降到 249（−31%），三角面从 47.2 万降到 36.0 万（−24%），
纹理从 30 降到 17，几何体从 184 降到 136。

## 3. 结论（必须如实说明）

1. **30 FPS 目标没有达成，也不能宣称达成。** 软件渲染下 approxFps 仅 2.4 / 2.9，
   远低于 30 FPS。SwiftShader 是 CPU 软件光栅化，与手机 GPU 的吞吐特性完全不同，
   该数值**不能外推为真机帧率**，既不证明真机会卡，也不证明真机流畅。
2. **真机 iPhone / 安卓：未测试。** 本次没有在真实设备上运行、没有采集真机 FPS、
   内存、发热或长时间稳定性数据。用户要求的「iPhone / 安卓性能测试结果」在此明确标记为
   **未测试**，需要拿到真机后另测。
3. 从静态指标看仍有优化空间：桌面 362 Draw Call、47 万三角面偏多。
   若要稳妥达到手机 30 FPS，后续应做：
   - 按距离 LOD（远景房屋 / 柏树 / 花簇降级或剔除）；
   - 更积极的视锥裁剪与分区渲染（当前 `frustumCulled=false` 用于部分实例化对象）；
   - 纹理图集与材质合并，进一步降低 program / draw call；
   - 阴影贴图与灯光数量分级（洞内 4 个点光源）；
   - 真机 GPU 时序分析后按瓶颈优化，而不是凭感觉宣称达标。

## 4. 已实施的移动端优化

- `MOBILE` 按 UA / 视口检测，自动降低 `DETAIL`、`TEXSIZE`、`pixelRatio`，关闭 antialias，
  缩小阴影贴图。
- `Batch` 按弧长 UV 合并道路 / 屋顶 / 栏杆 / 遮阳棚等 ribbon 与 quad，
  同材质同几何的小 Mesh 由 `optimizeDrawCalls()` 合并为 `InstancedMesh`（13 组，省 91 次调用）。
- 树冠、树干、柏树、花瓣、叶片、岩石、宝瓶栏杆、路灯、长椅、旗、花盆等重复装饰统一实例化。
- 天空为预烘焙 `CanvasTexture`，水面为单个 `ShaderMaterial`，避免大量独立云层 / 波浪物体。

## 5. 未覆盖项

- 真机 iPhone / 安卓帧率、内存、发热、长时间试玩 → **未测试**。
- 不同 Android GPU（Mali / Adreno / PowerVR）兼容性 → **未测试**。
- PWA 离线加载、正式存档与学习联动在真机上的联动 → **未测试**。
