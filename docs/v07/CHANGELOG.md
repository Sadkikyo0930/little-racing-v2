# CHANGELOG · V0.7 精品美术重构与隧道穿模修复（隔离候选）

基线：GitHub `little-racing-v2` 最新 `main` = `becf810a2296783bf26aba8c37ca9eef15d92103`
（`feat(explore): V0.6 boutique showcase with four near-spawn zones and quick look`）。
V0.6 页面线上与本地 SHA256 一致：`b5d8e4ae78608bb9b3498c1bfa0916cd8589950363c1637a5ed8a1feb9c6aa4e`。

## [V0.7] 新增（未合并 main / 未部署）

### 新增文件

- `docs/explore-v07.html` — V0.7 独立试玩候选主产物（最终 106 150 B，
  SHA256 `20ac85fe73f6ea635868e77314816f1d7ddad052c0f7afc0954794cf6159e4de`）。
- `src/00-head.html` ~ `src/12-ui.js` — 13 个源码分片。
- `tools/build.py` — 单文件页面拼装器。
- `tools/gh_api.py` — GitHub REST 只读侦察 + 隔离分支创建/上传（凭据运行时读取，不落盘）。
- `tools/diagnose.cjs` — V0.6 穿模复现与根因静态分析。
- `tools/drivetest.cjs` — 9 场景 + 3 视角真实浏览器逐帧驾驶验收。
- `tools/occlusion.cjs` — 相机射线命中与逐类隐藏遮挡隔离实验。
- `tools/floating.cjs` — 漂浮装饰定位与隔离实验。
- `tools/portal-probe.cjs` — 洞口名牌遮挡射线诊断。
- `tools/inspect.cjs` — 实例化几何 NaN / bounding box 检查。
- `tools/preview.cjs` — 13 张五区 WebGL 截图 + 运行时审计 + 桌面/移动端性能采样。
- `tools/compare.cjs` — 5 组目标效果图 vs 实际截图对比图。
- `tools/mobile-diag.cjs` — 移动端页面初始化独立诊断。
- `baseline/`、`references/`、`previews/`、`compare/`、`evidence/` — 基线、目标图、截图、对比与证据。
- `README.md` / `TEST_REPORT.md` / `TUNNEL_FIX.md` / `PERF_REPORT.md` / `CHANGELOG.md`。

### P0 · 隧道穿模

- 移除 V0.6 多层螺旋盘山路网，新增单层不自交、高程单调的「穿山公路」。
- `tunnelAt` 由 2D 最近轴点判定改为严格 3D 体积判定（`inLat` / `inAlong` / `inY` + 带符号 `u`）。
- `drawRoad` 单一连续路面；`tunnelProfile` 不再生成底部横面，消除双层路面。
- 删除 `clampIntoTunnel()` 吸车逻辑，新增 `softTunnelGuide()`（车半宽 2.45 m、单帧 ≤1.2 m）。
- 新增洞口前 18 环引道车道渐进收窄对准 + 洞口前高程外插，修复斜向驶入穿壁。
- `state.tunnelBlend` 改按轴向进度 `u` 过渡。
- 洞内相机改用相机所在环 `y0` 定高；三视角统一收进洞轴并强制钳制目标与结果。

### P1 · 五区精品美术

- 中央魔法广场：罗盘拼花、实体台基、导航球 / 玻璃球 / 光环、环形花坛、石砖步道、
  宝瓶栏杆、路灯长椅纹章旗、8 栋坡屋顶民居。
- 山岳隧道：逐块楔石拱券、连续洞顶、分层实体山体、洞口立面、石匾名牌、
  洞内拱肋 / 暖色壁灯 / 反光标、引道挡墙与护栏、警告牌。
- 海滨小镇：11 栋民居、红瓦坡顶、蓝百叶、遮阳棚、门头招牌、花箱与阳台铁艺、
  喷泉广场、石拱门、彩旗、咖啡桌椅果摊、斑马线。
- 灯塔海崖：红白条纹灯塔、玻璃灯室、铜顶、旋转光束、石铺平台、宝瓶栏杆、台阶、
  石拱桥、层状海蚀岩、凉亭、帆船海鸥、Shader 海面。
- 湖畔：Shader 水面、3 圈浅滩、岸线顶点色过渡、卵石 / 芦苇 / 木栈道、保留驼峰。
- 新增 9 类以上程序化 `CanvasTexture` 与门头 / 纹章 / 遮阳棚 / 灯塔条纹贴图。

### 性能与工具链

- `Batch` 按弧长 UV 合并 ribbon / quad；`optimizeDrawCalls()` 合并小 Mesh 为
  `InstancedMesh`（13 组，省 91 次 Draw Call）；重复装饰全实例化。
- 移动端按 UA / 视口降级：`DETAIL=0.62`、`TEXSIZE=256`、较低 `pixelRatio`、
  无 antialias、较小阴影贴图。
- 新增 `frameTimes` / `perf()` / `getAudit()` / `stepFrame()` / `probe()` /
  `guideAudit()` / `renderOnce()` 等可复现调试接口。

### 画面复核后追加的修复

- 洞内相机顶进拱顶导致整屏石纹 → 用相机所在环高度；三视角统一收进洞轴。
- `portal-mass` 背面纯黑三角 → 改不受光照的岩纹材质。
- 远景「漂浮纸片」→ 两片竖直平面改为有体积、落地的小屋，聚成 4 组村落并补柏树。
- 小镇跨街黑色粗绳 → 浅石色细绳，彩旗尺寸收敛。
- 纹章旗无旗杆、名牌与门楣穿插 → 补旗杆、名牌贴到门楣正面。
- 引道挡墙在洞口跳点处把 ribbon 硬连成斜跨路面的灰带 → 按连续段收集、洞口断开。
- 门楣旋转角 `atan2(nx,nz)` 错误（24.5 m 长条被转到轴向挡住名牌）→ `atan2(-nz,nx)`。
- 湖面 `y=-.7` 被抬到 `.45` 的地面吞没 → 水面 / 浅滩 / 岸线 / 卵石 / 芦苇统一抬到地面之上。
- 宝瓶栏杆 `LatheGeometry` 轮廓用小数索引导致 NaN → 改 `RAD.map(...)`；并修正落点与尺度。
- `preview.cjs` 两个 WebGL 页面抢 SwiftShader 导致移动端初始化超时 → 采集完先关闭桌面页。

## 未改动（明确保护）

`docs/index.html`、V0.1–V0.6 全部页面、正式赛车、生日限定车、剧情配音、学习联动、
家庭存档、数据库、CloudBase 正式数据、线上 CI / Pages 配置 —— **均未修改**。
未执行数据库迁移，未合并 `main`，未部署公开试玩页面。
