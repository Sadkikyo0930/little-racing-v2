# 部署到 GitHub Pages

目标地址：<https://sadkikyo0930.github.io/little-racing-v2/>

下面 A / B / C 三条上线路线任选其一（D 是本地试玩，不涉及 GitHub）。**最省事的是路线 A**：`little-racing-v2-pages.zip` 里的 `docs/` 已经是可直接运行的成品站点，上传即可，不需要 npm、不需要构建、也不需要 Actions 权限。

---

## 仓库与地址（无需改名）

- 仓库：<https://github.com/Sadkikyo0930/little-racing-v2>
- 线上地址：<https://sadkikyo0930.github.io/little-racing-v2/>

仓库名已经是正确的 `little-racing-v2`，**不需要重命名仓库，也不需要新建仓库**。下面所有链接都指向这个地址；如果你以后改了仓库名，才需要把地址里对应的那一段一起换掉。

> 唯一要注意的是仓库名必须出现在 Pages 地址里：`<用户名>.github.io/<仓库名>/`。本项目构建时用的是 `base: './'`（相对路径），所以放在任意子目录下都能跑。

---

## 路线 A：只要网页 + 免 Actions（最省事，推荐先试）

这条路线把构建产物放进 `docs/` 目录，用 GitHub Pages 的「分支目录」发布，**不需要 GitHub Actions，也不需要 workflow 权限**。

> 用 `little-racing-v2-pages.zip`（Pages 包）。解压后里面的 `docs/` 就是成品站点，**整个文件夹原样上传即可**，不用手工拆 `index.html` 和 `assets`。包根目录的 `上传说明.txt` 是最简版本，以下为同样的步骤。

1. 解压 `little-racing-v2-pages.zip`。
2. 打开 <https://github.com/Sadkikyo0930/little-racing-v2>
3. 点 **Add file → Upload files**，把解压得到的整个 `docs` 文件夹拖进去（拖文件夹本身，不是里面的文件，否则路径会变成仓库根目录）。
4. 底部 **Commit changes**。
5. 打开 <https://github.com/Sadkikyo0930/little-racing-v2/settings/pages>
   - **Source** 选 `Deploy from a branch`
   - **Branch** 选 `main`，目录选 `/docs`，Save
6. 等 1~2 分钟，访问 <https://sadkikyo0930.github.io/little-racing-v2/>

> 上传完成后仓库里应该有 `docs/index.html` 和 `docs/assets/…`。如果 `index.html` 落在仓库根目录，说明拖错了层级，把文件移进 `docs/` 即可。

---

## 路线 B：网页上传源码 + GitHub Actions（标准做法）

适合以后每次改代码自动构建。

1. 把源码拖到 <https://github.com/Sadkikyo0930/little-racing-v2/upload/main>
   —— `index.html`、`package.json`、`package-lock.json`、`vite.config.js`、`LICENSE`、`THIRD-PARTY-NOTICES.md`、`README.md`、`DEPLOY.md`、`.gitignore`、`src/` 整个文件夹。**不要**上传 `node_modules/`。
2. 隐藏目录网页上传不支持，单独建工作流文件：
   - 打开 <https://github.com/Sadkikyo0930/little-racing-v2/new/main/.github/workflows>
   - 文件名 `deploy.yml`，把本包 `.github/workflows/deploy.yml` 的内容整段粘进去，提交。
3. 打开 Settings → Pages，**Source** 选 `GitHub Actions`（首次必须手动点一次，workflow 令牌无权自行启用）。
4. 打开 <https://github.com/Sadkikyo0930/little-racing-v2/actions>，等 `Deploy to GitHub Pages` 跑完（也可点 `Run workflow` 手动触发）。

---

## 路线 C：PAT + git push（一条命令推完）

1. 生成 classic token：<https://github.com/settings/tokens/new>
   - Note 随意，Expiration 建议 7 天
   - 勾选 **`repo`** 和 **`workflow`** → Generate → 复制
2. 解压后在项目目录执行：

```bash
git init
git add -A
git commit -m "Little Racing V2: child-friendly KIDS_MODE"
git remote add origin https://<TOKEN>@github.com/Sadkikyo0930/little-racing-v2.git
git push -u origin main
```

3. 打开 Settings → Pages，**Source** 选 `GitHub Actions`，回到 Actions 等部署完成。

> 用完建议到 <https://github.com/settings/tokens> 撤销该 token。

---

## 路线 D：本地零配置试玩

```bash
cd dist
npx serve .          # 或 python -m http.server 8080
```

手机与电脑同一 Wi-Fi 时，用 `http://<电脑局域网IP>:8080` 打开，横屏即玩。

> 注意：**不要直接双击 `index.html`**。构建产物是 ES module，`file://` 直开会被浏览器跨域策略拦住（白屏），必须用上面的静态服务器方式。手机横屏试玩前先关闭系统的屏幕方向锁定。

---

## 验收清单

- [ ] 仓库是 `Sadkikyo0930/little-racing-v2`（无需改名，也不用新建）
- [ ] 仓库里有 `docs/index.html` 和 `docs/assets/…`（不是散落在根目录）
- [ ] Pages Source 设置正确（`/docs` 分支 或 `GitHub Actions`）
- [ ] 首页出现中文大标题、「开始游戏 / 故事冒险」两个入口、「难度」，以及一个带金币余额的 **「我的车库 ›」** 按钮（首页**不再**有赛车选择行）
- [ ] 点「我的车库」进入 3D 车库：中间展台上的车会慢慢自转，顶部显示金币，底部 4 张车辆卡片，右侧是解锁/购买/使用面板
- [ ] 已拥有的车能直接「使用这辆车」，返回首页后开局坐的就是它（两辆车的司机都是主角 A）
- [ ] 跑完一场 3 圈正式比赛，结算面板出现金币到账（第 1 名 +120），回到车库顶部余额同步；同一场不会重复到账
- [ ] 车库面板里的「存档」可以复制 / 下载 / 导入 / 回滚
- [ ] 左下角横向转向条、右下角 油门 / 刹车 / 道具 / 复位 按钮可见且够大
- [ ] 倒计时结束后能加速、转向、撞墙后可继续行驶；四个轮子跟着转、前轮跟着方向转
- [ ] 点一次页面后背景音乐响起（iPhone 必须先点一下，浏览器禁止自动播放）
- [ ] 控制台无红色 JS 报错（桌面 F12 / 手机 Safari 需连 Mac 检查）

> `docs/assets/` 里现在有 GLB 与 MP3（主角 A、海龟冲浪车、两个 NPC、两首音乐、六段配音）。文件名带内容哈希，**覆盖时请整份 `docs` 替换**，不要只挑单个文件上传。

## 已知限制

- iPhone Safari 真机尚未实测（此前用 Edge + SwiftShader 无头浏览器验证过桌面与手机横屏布局、双指触控）。
- AI 跑完 3 圈、道具实际效果、碰撞后继续行驶已有代码实现，建议真机试玩复核。
- **闪电小摩托还没做模型**：车库里有卡片、有 1500 金币的价格和解锁条件，但标的是「敬请期待」，不能购买、不能上场，展台上放的是线框占位块（明确不假装是能开的车）。等真 GLB 做出来再接。
- **学习奖励车**只预留了卡片和奖励数据结构，没有任何自动同步。`sadkikyo0930.github.io/little-growth-workbench/v6/` 与本项目是**两个不同的 origin，localStorage 完全隔离，也没有共享后端**——本机拿不到对方的学习成绩。`STUDY_ENABLED` 目前为 `false`，兑换入口不会出现在界面上。
- 存档是 **localStorage**，只在同一浏览器同一站点下有效。换手机 / 清缓存会丢，所以车库面板提供了导出存档；导入前会自动备份，可回滚。
