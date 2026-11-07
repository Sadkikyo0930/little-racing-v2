# Little Racing V2

A child-friendly 3D kart racer for roughly **6–8 year olds**, built on top of
[**Old San Juan Kart**](https://github.com/nasilvae/old-san-juan-kart) by
Nathaniel Silva. The original game is a Three.js arcade kart racer; this V2 keeps
its mature systems and re-tunes the *driving feel* so young children can complete
a lap without fighting the car.

> **▶ Play:** https://sadkikyo0930.github.io/little-racing-v2/

This project is a derivative work. The underlying engine, track generation, AI,
items, camera, collision and mobile quality tiers are inherited unchanged from
Old San Juan Kart (MIT). Little Racing V2 only changes how the car *handles* and
adds a child-facing start screen. The track, terrain, sky and sky/road textures
are still generated procedurally at runtime; the only binary assets are the
optional models (player character, two story NPCs, the turtle kart) and the
local audio files (two music loops, six voice lines) described below.

## What changed vs. the original

- **Kids driving mode (default).** Top speed is capped at ~60% of the original,
  the launch is softer, coasting down is gentler, steering is smoothed and less
  twitchy, and a light "straighten-out" assist helps a child who isn't actively
  steering. High-speed corners auto-trail the brakes so they don't overshoot.
- **Collision protection.** Guardrail grazes scrub far less speed and barely
  bounce; a stuck kart recovers automatically sooner, and there is a one-tap
  **"back to track"** button (and a desktop `R` key) to recover instantly.
  Karts still cannot pass through the track boundary.
- **Bigger touch buttons** (gas / brake / item / reset) sized for small fingers,
  with the original relative-analog left-thumb steering kept intact.
- **Start screen mode picker:** **轻松模式 (Easy, default)** vs **普通模式
  (Normal)** — Normal preserves the exact original Old San Juan Kart handling.

All driving ratios are centralised in **`src/config.js`** (`GAME_MODES`) so they
can be tuned in one place.

## Modes

| Mode | Top speed | Steering | Notes |
| --- | --- | --- | --- |
| 轻松模式 (Easy) | ~60% of original (~44 mph) | smoothed, less oversteer, gentle assist | Default. Made for young children. |
| 普通模式 (Normal) | 100% (original) | original | Unchanged Old San Juan Kart feel. |

The mode applies to every kart on the grid (player + AI) so the race stays fair
and a child can keep up with the pack.

## Controls

| Action | Keys | Touch |
| --- | --- | --- |
| Accelerate | `W` / `↑` | hold the green **GO** pedal |
| Brake / reverse | `S` / `↓` | **BRAKE** |
| Steer | `A` `D` / `←` `→` | slide your left thumb (relative analog pad) |
| Hop & drift | `Shift` | blip **GO** mid-corner |
| Use item | `E` | **ITEM** |
| Look back | `C` | — |
| Back to track | `R` | **↺** button |
| Mute | `M` | speaker button |

Play it in **landscape**. On a phone, the page auto-detects the device, picks a
quality tier, and shows on-screen controls.

## 我的车库 (Garage)

The start screen no longer carries an inline kart picker. It has a single
**我的车库 ›** button showing the current coin balance; the garage is where you
browse, unlock, buy and equip karts. The flow is
**home → garage → pick a kart → back → start race**.

The garage is a real 3D scene, not a web list: a separate `Scene`/`Camera` is
swapped in through `engine.useScene()` (the same mechanism the story chapter
uses), so the race scene is never touched. The stage builds a room, a rotating
turntable and lighting; the kart on the turntable is built with the **exact same
code path** as on the track (`buildKart(...)` / `createTurtleModel(...)`), so what
you see is what you drive. The UI reports the bounding box of the display area
(`.gShow`) and the stage pans the camera to fit that rectangle, which is why the
right-hand panel and the bottom cards never overlap the kart at any phone size.

| Kart | How you get it | Drivable |
| --- | --- | --- |
| **红色赛车** (Red kart) | Default, permanently owned | Yes — original procedural kart, unchanged |
| **海龟冲浪车** (Turtle surf kart) | Reward for finishing **chapter 1** (or inherited from an older save) | Yes — external GLB, Tripo + Blender |
| **闪电小摩托** (Lightning moto) | 1500 coins — **not on sale yet** | No. Shown as an unlocked-soon card with a wireframe stand-in on the turntable; no fake model is pretended to be drivable |
| **学习奖励车** (Study-reward kart) | Reserved for the growth-workbench challenge | No. Catalogue entry + reward data shape only |

- **Never lose a kart you already had.** An older save that still has the
  `lrv2.vehicle` key, or a save with chapter 1 marked `done`, is migrated on
  boot and keeps the turtle kart (`source: legacy-version` / `story-chapter1`).
  Old keys are read but never rewritten or deleted.
  The migration commits in **two phases**: ownership is written and then read
  back for verification before the version marker is written. If the write
  fails halfway (quota, private mode) the version marker is *not* written, so
  the next boot re-runs the migration and restores the kart instead of leaving
  a save that claims to be migrated but has no vehicle.
- **Ownership** lives in one place (`lrv2.garage.owned`), so a story reward and a
  coin purchase can never hand out the same kart twice.
- Both karts are **lazy-loaded** via dynamic `import()`: drive the red kart and
  not a single byte of the turtle model is downloaded. If loading fails the game
  falls back to the red kart and says so on the console — it never pretends.
- The turtle kart's four wheels spin (`kart.wheelSpin`), the two front wheels
  steer (`steerVisual × 0.52`), and the driver leans at a reduced 0.3 factor so
  the baked hand pose stays on the wheel rim.

### Coins

In-game currency only — there is nothing to buy with real money anywhere in the
build.

| Finish a 3-lap race in | Coins |
| --- | --- |
| 1st | 120 |
| 2nd | 90 |
| 3rd | 70 |
| 4th–8th | 40 |
| quit before the finish | 0 |

Every race gets a `raceId` when it starts, and the reward is claimed against
that id, so **one race pays out exactly once** — replaying the results screen,
refreshing, or finishing the same race twice cannot mint coins. The amount rolls
up inside the results panel (`+120 共 621`); there is no extra pop-up to dismiss.

### Saves

The garage keeps **eight separate `lrv2.garage.*` keys** (meta / coins / tx /
owned / current / rewards.story / rewards.study / claims) so one damaged slice
cannot take the rest down with it. Nothing outside that namespace is touched:
chapter progress, mute, music volume and the voice settings are all still where
they were.

The garage panel also has **export / import / rollback**: copy or download a JSON
snapshot, paste one back in. Importing always writes a timestamped backup first
(`lrv2.garage.backup.<date>`, newest 5 kept) and rejects anything that is not a
garage save, so a bad paste cannot wipe a child's karts.

If that backup **cannot be written** (storage full, private mode) the import is
**refused** and nothing changes; the panel then shows the risk and offers
`取消, 先不导入` / `仍然导入`. Overwriting without a way back is opt-in, never
silent. Rolling back is itself backed up first, so an accidental rollback can be
rolled back too. See
[存档迁移与回滚说明](../deliver/车库系统/存档迁移与回滚说明.md) for the key-by-key
detail and the rollback steps.

The panel itself is a **three-part layout**: a fixed header (name + state), a
freely scrollable middle (description / stats / unlock conditions), and a fixed
footer (the action button). Long content — an owned turtle kart that still
shows its story conditions, for example — scrolls in the middle while the
button stays pinned; a "下滑看更多" hint appears only while there is more to
see. The whole app sizes itself from `visualViewport` (`--vvh`), so Safari's
collapsing toolbars never push the bottom buttons off-screen.

**Fullscreen**: the home screen (top-left) and the garage top bar both have a
全屏 button. Where the Fullscreen API exists it is really used; on iPhone
Safari — which does not support element fullscreen — the button opens a
three-step "添加到主屏幕" guide instead of faking it, and once the game runs
as a standalone web app (manifest + apple-touch-icon are shipped, all relative
paths so the GitHub Pages subpath works) the entry hides itself.

## Running locally

```bash
npm install
npm run dev      # open the URL Vite prints (default http://localhost:5173)
npm run build    # production build into dist/
npm run preview  # serve the production build
```

Append `?course=expreso` or `?course=viejo` to jump straight to a circuit, and
`?quality=high|mid|low` to force a quality tier.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the site
and publishes it to **GitHub Pages** (project URL `/little-racing-v2/`). The
Vite config uses a relative `base: './'`, so the build works from any path —
including the Pages sub-path — without hard-coding the repository name.

## License

Released under the [MIT License](LICENSE).

- Original MIT Copyright (c) 2026 Nathaniel Silva — Old San Juan Kart.
- Little Racing V2 modifications Copyright (c) 2026 Sadkikyo0930.

You are free to use, copy, modify, merge, publish, distribute, sublicense and
sell copies of this software, provided the copyright notice and permission notice
are included. The software is provided "as is", without warranty of any kind.

### Notices

This project bundles **three.js** (MIT, © 2010–2025 three.js authors) and links
the **Bungee** and **Rubik** fonts (SIL OFL 1.1) from the Google Fonts CDN.
Track, terrain, vehicle bodies, textures and engine/tyre sound effects are all
generated by code at runtime. The binary assets that do ship are:

| File | Origin |
| --- | --- |
| `src/assets/hero-a-driving.glb` | Original model for this project (Tripo + Blender) |
| `src/assets/karts/turtle-kart.glb` | Original model for this project (Tripo + Blender) |
| `src/assets/characters/*.glb` | Original models for this project (Tripo + Blender) |
| `src/assets/audio/music-*.mp3` | Original recordings supplied by the project author |
| `src/assets/audio/voice/*.mp3` | Original voice recordings supplied by the project author |

Full details, including the music and likeness rationale, are in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

This is an independent, non-commercial fan project. It is **not affiliated
with, endorsed by, or sponsored by** Nintendo or any other company, and it
contains no assets from any commercial game.
