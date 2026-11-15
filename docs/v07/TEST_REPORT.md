# V0.7 · 测试与验收报告

> 结论：**P0 隧道穿模修复通过**（真实浏览器逐帧驾驶 + 画面双重复核）；
> P1 五区美术已实现并留证，但**与目标效果图仍有明显差距**；
> **30 FPS 目标未在真机验证，软件渲染数据不达标**；本次为隔离候选，未合并 `main`、未部署。

## 1. 基线与隔离检查

| 项 | 结果 |
| --- | --- |
| 重新读取 GitHub 最新 `main` | `becf810a2296783bf26aba8c37ca9eef15d92103`，HTTP 200 |
| V0.6 线上页面下载 | 84 414 B，与本地副本 SHA256 一致 |
| 隔离分支 | 从上述 `main` 创建，仅在其上新增文件 |
| 合并 `main` | **未执行** |
| 部署 Pages / 公开试玩页 | **未执行** |
| 数据库迁移 / CloudBase 正式数据 | **未执行** |
| 既有页面 / 正式玩法文件 | **未修改**（`docs/index.html`、V0.1–V0.6、正式赛车、生日限定车、剧情配音、学习联动、家庭存档） |
| 凭据处理 | 运行时从 Windows 凭据管理器读取，不打印、不写入交付文件；ZIP 打包前另做敏感信息扫描 |

## 2. 页面运行时审计

`previews/V07-AUDIT.json`：`PAGE_ERRORS 0`。

- `version=V0.7`、`isolated=true`、`build=isolated-candidate`。
- `p0`：`strict3DVolume`、`singleContinuousRoad`、`noDoubleDeck`、`noCarTeleport`、
  `roadShadingByAxialProgress`、`approachLaneTaper`（18 环）、`carHalfWidth=2.45`、
  `guideStepPerFrame=1.2`、`entranceYExtrapolation` 全部为 `true`。
- `roadTiles=847`、`obstacleCount=11`、`violations=0`、`rejected=4`。
- Draw Call 优化：`mergedGroups=13`、`savedCalls=91`。
- 五区运行时审计：广场罗盘 / 导航球 / 4 段宝瓶栏杆 / 28 圈花坛；湖畔 Shader 水面 /
  3 圈浅滩 / 560 卵石 / 300 芦苇 / 木栈道 / 4 驼峰；隧道单一连续路面 / 2 座石拱 /
  9 道拱肋 / 22 灯 / 12 反光标；小镇 11 栋民居 / 坡顶 / 遮阳棚 / 百叶 / 阳台 / 喷泉 /
  8 门头；灯塔条纹塔身 / 玻璃灯室 / 旋转光束 / 石拱桥 / 4 层崖岩 / 帆船 / 海鸥。
- 实例化物件计数：树干 52、树冠 78、柏树 140、花瓣 2785、叶片 2785、宝瓶 184、
  路灯 27、灯罩 27、长椅木/铁各 16、纹章旗 10、岩石 140、花盆 9。
- `tools/inspect.cjs`：所有 `LatheGeometry` / `BufferGeometry` 实例化对象 `nan=0`，
  bounding box 有效、可见。

## 3. P0 根因与逐帧驾驶验收

详见 `TUNNEL_FIX.md`。摘要：

- 修复前：V0.6 的 `tunnelAt(x,z)` 不检查横向与高程，61 采样中 6 个低层道路点被误判为
  93 m 高空洞内；`clampIntoTunnel()` 把车搬进洞轴；逐帧轨迹与截图均复现。
- 修复后静态判定：`evidence/V07-P0-ROOT-CAUSE.json` 中全部 7 条道路 `misjudged=0`。
- 真实逐帧驾驶：`evidence/V07-DRIVE-SUMMARY.json` ——
  **`OVERALL_PASS true`、`PAGE_ERRORS 0`、`TOTAL_FRAMES 4680`、`SCREENSHOTS 107`**。
- 9 场景全部 `pass=true`、`carViolations=0`、`camViolations=0`、`heightViolations=0`、
  `teleports=0`；最大 `maxAbsLat=4.46 m`（安全上限 5.15 m），`maxStep≤0.502 m`。
- `08-bypass` 与 `09-lowroad` 的 `insideFrames=0`：旁路不被误吸、低层小镇主街（不同高程）
  不再被误判入洞 —— V0.6 根因不复现。
- 三视角 `cam0/cam1/cam2`：各 96 洞内帧，`violations=0`，均有截图。

## 4. 画面复核（数值通过后仍需看图）

按用户规则「自动化通过但画面仍穿模即判定失败」，逐张复看了关键帧，并在发现问题后继续修复：

| 复核项 | 结果 |
| --- | --- |
| `03-diagonal-02/04/05.png` | 洞口接近、洞内、洞内中段：车辆完整可见，路面 / 洞壁 / 拱顶连续，无穿模 |
| `01-normal-04.png`、`03-diagonal-11.png` | 洞内与出洞：路面连续，无整屏遮挡 |
| `08-bypass-00.png` | 出口后公路：车辆在连续道路上，无黑色剪影、无悬空路面、无漂浮纸片 |
| `09-lowroad-04.png` | 低层小镇主街：车辆在道路上，未误入隧道内部，跨街绳已为浅色细线 |
| `cam-mode-0/1/2.png` | 三视角：车辆完整可见，无整屏岩纹 / 洞口立面遮挡 |
| `previews/01..06`、`13` | 五区预设机位 + 俯瞰：结构完整，湖面与栈道正常，石匾文字「松云岭」可读，无悬空天路 |
| `evidence/occlusion/bypass-00.png` | 纯黑三角已消除，山体立面为岩纹 |

诊断脚本 `occlusion.cjs` / `floating.cjs` / `portal-probe.cjs` 的射线命中与逐类隐藏实验
结果保存在 `evidence/V07-OCCLUSION.json`、`V07-FLOATING.json`、`V07-PORTAL-PROBE.json`。

## 5. 目标效果图对比

`compare/` 下 5 组并排对比图（左：用户目标效果图，右：V0.7 真实 WebGL 截图）：

- `01-中央魔法广场-对比.png`
- `02-山岳隧道入口-对比.png`
- `03-山间隧道内部-对比.png` —— **左栏明确标注目标效果图缺失**
- `04-海滨小镇-对比.png`
- `05-灯塔海崖赛道-对比.png`

用户说明共 5 张效果图，本次会话可见附件只提供 4 个本地图片路径（中央魔法广场、山岳隧道入口、
海滨小镇、灯塔海崖赛道），「山间隧道内部」目标图未收到，**未虚构或替代**。

客观差距：V0.7 已具备可从不同角度观看的真实三维结构与连续路网，但在材质细节、
光影层次、建筑密度、植被造型与海崖地形起伏上仍明显弱于目标效果图，属于程序化几何的
中等完成度，未达到目标图的商业美术水准。

## 6. 性能

详见 `PERF_REPORT.md`。软件渲染实测桌面 approxFps 2.4 / 362 Draw Call / 47.2 万三角面；
iPhone UA 模拟 approxFps 2.9 / 249 Draw Call / 36.0 万三角面。
**30 FPS 目标未达成，真机 iPhone / 安卓未测试，不得宣称达标。**

## 7. 未覆盖 / 待用户确认

1. 真机 iPhone / 安卓帧率、内存、发热、触控驾驶、长时间试玩。
2. 与目标效果图的美术差距需继续收敛（可考虑引入 GLB 精模与烘焙贴图，本次未使用）。
3. 第 5 张「山间隧道内部」目标效果图需用户补提供后才能做完整对比。
4. PWA 离线、正式存档兼容性与学习联动在真机上的联动验证。
5. 未经再次授权：不合并 `main`、不部署公开试玩页面。
