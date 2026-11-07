"""
第二章海滨环境资产 —— Blender 5.2.3 生成脚本。

用法：
  blender --background --python tools/blender/build_assets.py

产出：
  public/assets/ch2/*.glb        游戏实际加载的模型（只有几何 + 材质名）
  tools/blender/out/ch2.blend    可继续编辑的工程文件
  tools/blender/out/report.json  面数 / 顶点 / 体积清单

设计约束（iPhone Safari）：
  · 单资产 12 ~ 1500 三角面，全部硬表面低模，不做细分/雕刻；
  · 材质只用「名字 + 纯色」，贴图在游戏端按名字挂 canvas 程序纹理，
    所以 GLB 里没有一张图片，整包只有几十 KB；
  · 同一个资产的所有零件合成一个 mesh（多材质槽），游戏端按材质拆成
    InstancedMesh —— 一个材质一次 draw call。

坐标约定：Blender Z 向上，原点在「地面中心」，+Y 是正面（门朝向）。
"""

import json
import math
import os
import random
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from kit import (  # noqa: E402
    Mesh, TAU, beam, build_object, export_glb, lerp, make_material, reset_scene,
)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
GLB_DIR = os.path.join(ROOT, 'public', 'assets', 'ch2')
OUT_DIR = os.path.join(HERE, 'out')

# --------------------------------------------------------------------------- #
# 材质表：名字 → (颜色, 粗糙度, 金属度)
# 游戏端 src/world/beachMats.js 用同一批名字挂贴图。
# --------------------------------------------------------------------------- #
PALETTE = {
    'M_Wall_White':   ((0.94, 0.93, 0.89), 0.82, 0.0),
    'M_Wall_Red':     ((0.72, 0.24, 0.20), 0.80, 0.0),
    'M_Wall_Ochre':   ((0.88, 0.66, 0.34), 0.88, 0.0),
    'M_Roof_Blue':    ((0.20, 0.45, 0.62), 0.72, 0.0),
    'M_Roof_Slate':   ((0.26, 0.28, 0.31), 0.78, 0.0),
    'M_Thatch':       ((0.80, 0.64, 0.32), 0.94, 0.0),
    'M_Thatch_Dark':  ((0.62, 0.46, 0.22), 0.95, 0.0),
    'M_Trim_White':   ((0.97, 0.97, 0.95), 0.72, 0.0),
    'M_Trim_Blue':    ((0.24, 0.55, 0.72), 0.70, 0.0),
    'M_Trim_Red':     ((0.80, 0.28, 0.24), 0.72, 0.0),
    'M_Wood':         ((0.62, 0.44, 0.26), 0.88, 0.0),
    'M_Wood_Dark':    ((0.38, 0.26, 0.16), 0.90, 0.0),
    'M_Wood_Pale':    ((0.76, 0.62, 0.42), 0.86, 0.0),
    'M_Glass':        ((0.62, 0.80, 0.86), 0.18, 0.0),
    'M_Metal':        ((0.55, 0.57, 0.60), 0.38, 0.85),
    'M_Fabric_Red':   ((0.86, 0.26, 0.24), 0.86, 0.0),
    'M_Fabric_Cream': ((0.96, 0.93, 0.82), 0.88, 0.0),
    # 起点门横幅专用：游戏端按材质名挂一张写字的 canvas 贴图，
    # 不能和其它奶油色布料共用一个材质，否则字会印到遮阳伞上去。
    'M_Gate_Banner':  ((0.96, 0.93, 0.82), 0.90, 0.0),
    'M_Rope':         ((0.86, 0.79, 0.62), 0.95, 0.0),
    'M_Rock_Light':   ((0.74, 0.71, 0.64), 0.95, 0.0),
    'M_Rock_Dark':    ((0.32, 0.32, 0.34), 0.92, 0.0),
    'M_Rock_Wet':     ((0.46, 0.48, 0.46), 0.55, 0.0),
    'M_Moss':         ((0.44, 0.56, 0.31), 0.95, 0.0),
    'M_Trunk':        ((0.50, 0.38, 0.25), 0.92, 0.0),
    'M_Frond':        ((0.30, 0.55, 0.24), 0.86, 0.0),
    'M_Coconut':      ((0.34, 0.26, 0.15), 0.88, 0.0),
    'M_Stone':        ((0.66, 0.63, 0.57), 0.94, 0.0),
    'M_Sand_Grass':   ((0.66, 0.70, 0.44), 0.95, 0.0),
}
MAT_NAMES = list(PALETTE.keys())
M = {n: i for i, n in enumerate(MAT_NAMES)}


def setup_materials():
    for name, (col, rough, metal) in PALETTE.items():
        make_material(name, col, rough, metal)


# --------------------------------------------------------------------------- #
# 造型工具
# --------------------------------------------------------------------------- #
def panel(m, cx, cy, cz, along, thick, hgt, nx, ny, mat, off=0.0, uv=1.0):
    """贴在墙面上的薄板。nx/ny 是墙面法线方向（沿坐标轴，±1）。"""
    if nx:
        m.box((cx + nx * off, cy, cz), (thick, along, hgt), mat, uv=uv)
    else:
        m.box((cx, cy + ny * off, cz), (along, thick, hgt), mat, uv=uv)


def window(m, cx, cy, cz, w, h, mat_frame, mat_glass, nx=0, ny=1,
           frame=0.08, thick=0.10, mullion=True, shutter=None):
    """窗：外框 4 条 + 玻璃 + 竖梃横档 + 可选百叶。"""
    f, t = frame, thick
    panel(m, cx, cy, cz, w, t, h, nx, ny, mat_glass)
    if nx:
        for s in (-1, 1):
            panel(m, cx + s * (w / 2 - f / 2), cy, cz, f, t * 1.6, h, nx, ny, mat_frame)
            panel(m, cx, cy + s * (h / 2 - f / 2), cz, w, t * 1.6, f, nx, ny, mat_frame)
        if mullion:
            panel(m, cx, cy, cz, 0.05, t * 1.9, h - f, nx, ny, mat_frame)
            panel(m, cx, cy, cz, w - f, t * 1.9, 0.05, nx, ny, mat_frame)
    else:
        for s in (-1, 1):
            panel(m, cx, cy + s * (w / 2 - f / 2), cz, f, t * 1.6, h, nx, ny, mat_frame)
            panel(m, cx + s * (w / 2 - f / 2), cy, cz, w, t * 1.6, f, nx, ny, mat_frame)
        if mullion:
            panel(m, cx, cy, cz, 0.05, t * 1.9, h - f, nx, ny, mat_frame)
            panel(m, cx, cy, cz, w - f, t * 1.9, 0.05, nx, ny, mat_frame)
    if shutter is not None:
        for s in (-1, 1):
            if nx:
                m.box((cx + nx * 0.05, cy + s * (w / 2 + w * 0.21), cz),
                      (0.06, w * 0.38, h), shutter)
            else:
                m.box((cx + s * (w / 2 + w * 0.21), cy + ny * 0.05, cz),
                      (w * 0.38, 0.06, h), shutter)


def door(m, cx, cy, z_base, w, h, mat_panel, mat_frame, ny=1):
    m.box((cx, cy + ny * 0.02, z_base + h / 2), (w + 0.16, 0.12, h + 0.12), mat_frame)
    m.box((cx, cy + ny * 0.07, z_base + h / 2), (w, 0.12, h), mat_panel)
    for dz in (-h * 0.21, h * 0.21):
        m.box((cx, cy + ny * 0.13, z_base + h / 2 + dz), (w * 0.70, 0.03, h * 0.28), mat_frame)
    m.box((cx + w * 0.32, cy + ny * 0.19, z_base + h * 0.46), (0.07, 0.07, 0.07), M['M_Metal'])


def railing_x(m, x0, x1, y, z, mat, count=6, h=0.92):
    """沿 X 方向的一段栏杆：上横杆 + 中横杆 + 立柱。"""
    m.box(((x0 + x1) / 2, y, z + h), (abs(x1 - x0), 0.10, 0.09), mat)
    m.box(((x0 + x1) / 2, y, z + h * 0.44), (abs(x1 - x0), 0.07, 0.06), mat)
    for i in range(count):
        m.box((lerp(x0, x1, i / (count - 1)), y, z + h / 2), (0.07, 0.07, h), mat)


def gable_roof(m, w, d, wall_top, rise, thickness, mat_roof, mat_trim, mat_wall,
               overhang=0.35, rafters=True, uv=1.0):
    """双坡屋顶：两片坡面 + 屋脊 + 山墙 + 檐口封边 + 椽头。"""
    half = d / 2 + overhang
    slope = math.hypot(half, rise)
    ang = math.atan2(rise, half)
    for s in (-1, 1):
        m.box((0, s * half / 2, wall_top + rise / 2),
              (w + overhang * 2, slope, thickness), mat_roof,
              rot=(-s * ang, 0, 0), uv=uv)
        m.box((0, s * (half - 0.03), wall_top - 0.03),
              (w + overhang * 2, 0.10, 0.17), mat_trim)
    m.box((0, 0, wall_top + rise + 0.02), (w + overhang * 2 + 0.08, 0.26, 0.14), mat_trim)
    for s in (-1, 1):
        x = s * w / 2
        b = len(m.v)
        m.vert((x, -d / 2, wall_top))
        m.vert((x, d / 2, wall_top))
        m.vert((x, 0, wall_top + rise))
        m.face([b, b + 1, b + 2] if s > 0 else [b + 2, b + 1, b], mat_wall, False, uv)
    if rafters:
        n = max(4, int(w / 1.1))
        for i in range(n):
            x = lerp(-w / 2 + 0.14, w / 2 - 0.14, i / (n - 1))
            for s in (-1, 1):
                m.box((x, s * (half - 0.06), wall_top - 0.18), (0.07, 0.36, 0.10), mat_trim)


def recolor_top(m, z0, mat, z1=None):
    for i, f in enumerate(m.f):
        zc = sum(m.v[j][2] for j in f) / len(f)
        if zc >= z0 and (z1 is None or zc <= z1):
            m.fm[i] = mat


# --------------------------------------------------------------------------- #
# A. 蓝白色海滨小屋
# --------------------------------------------------------------------------- #
def house_blue():
    m = Mesh('house_blue')
    W, D, STILT, WALL = 6.6, 5.2, 0.55, 2.85
    wt, tr, tb = M['M_Wall_White'], M['M_Trim_White'], M['M_Trim_Blue']

    for sx in (-1, 1):
        for sy in (-1, 1):
            m.cyl((sx * W * 0.40, sy * D * 0.40, 0), 0.17, STILT + 0.05, 8,
                  M['M_Wood_Dark'], r_top=0.15)
    m.box((0, 0, STILT + 0.07), (W + 0.5, D + 0.5, 0.15), M['M_Wood_Pale'])
    m.box((0, 0, STILT + 0.15 + WALL / 2), (W, D, WALL), wt)
    m.box((0, 0, STILT + 0.27), (W + 0.08, D + 0.08, 0.14), tr)
    m.box((0, 0, STILT + 0.15 + WALL - 0.10), (W + 0.10, D + 0.10, 0.16), tr)
    m.box((0, 0, STILT + 0.15 + WALL * 0.52), (W + 0.06, D + 0.06, 0.09), tr)
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.box((sx * W / 2, sy * D / 2, STILT + 0.15 + WALL / 2), (0.16, 0.16, WALL), tr)
    wall_top = STILT + 0.15 + WALL
    gable_roof(m, W, D, wall_top, 1.55, 0.15, M['M_Roof_Blue'], tr, wt, overhang=0.42)

    # 前廊
    PY = D / 2 + 0.85
    m.box((0, PY - 0.35, STILT + 0.07), (W * 1.02, 1.85, 0.15), M['M_Wood_Pale'])
    for sx in (-1, 1):
        m.cyl((sx * W * 0.46, D / 2 + 1.65, STILT + 0.14), 0.11, 2.35, 8, tr, r_top=0.09)
    m.box((0, D / 2 + 1.65, STILT + 2.52), (W * 1.02, 0.20, 0.16), tr)
    railing_x(m, -W * 0.46, -0.78, D / 2 + 1.72, STILT + 0.14, tr, count=5)
    railing_x(m, 0.78, W * 0.46, D / 2 + 1.72, STILT + 0.14, tr, count=5)
    m.box((0, PY - 0.15, STILT + 2.66), (W * 1.04, 1.9, 0.12), M['M_Roof_Blue'], rot=(0.16, 0, 0))
    for i in range(2):
        m.box((0, D / 2 + 1.88 + i * 0.30, STILT - i * 0.22), (1.5, 0.32, 0.16), M['M_Wood_Pale'])

    door(m, 0, D / 2, STILT + 0.15, 0.98, 2.05, tb, tr, ny=1)
    for sx in (-1, 1):
        window(m, sx * 2.05, D / 2, STILT + 1.78, 1.02, 1.08, tr, M['M_Glass'],
               nx=0, ny=1, shutter=tb)
        m.box((sx * 2.05, D / 2 + 0.12, STILT + 1.14), (1.12, 0.24, 0.20), tb)
        m.box((sx * 2.05, D / 2 + 0.12, STILT + 1.28), (0.98, 0.18, 0.10), M['M_Moss'])
        m.box((sx * 2.05, D / 2 + 0.06, STILT + 2.40), (1.24, 0.26, 0.11), tr)
    window(m, W / 2, 0.6, STILT + 1.78, 0.85, 0.95, tr, M['M_Glass'], nx=1, ny=0)
    window(m, -W / 2, -0.9, STILT + 1.78, 0.85, 0.95, tr, M['M_Glass'], nx=-1, ny=0)
    window(m, 1.2, -D / 2, STILT + 1.78, 0.95, 1.0, tr, M['M_Glass'], nx=0, ny=-1)

    m.box((W * 0.28, -D * 0.18, wall_top + 1.30), (0.52, 0.52, 1.7), tr)
    m.box((W * 0.28, -D * 0.18, wall_top + 2.18), (0.64, 0.64, 0.12), M['M_Stone'])
    return m


# --------------------------------------------------------------------------- #
# B. 橙黄色茅草屋
# --------------------------------------------------------------------------- #
def house_thatch():
    m = Mesh('house_thatch')
    R, WALL, BASE, SIDES = 2.75, 2.55, 0.42, 10
    ochre = M['M_Wall_Ochre']

    m.cyl((0, 0, 0), R + 0.22, BASE, SIDES, M['M_Stone'], r_top=R + 0.18)
    m.cyl((0, 0, BASE), R + 0.10, 0.14, SIDES, M['M_Wood_Pale'], r_top=R + 0.10)
    z0 = BASE + 0.14
    m.cyl((0, 0, z0), R, WALL, SIDES, ochre, r_top=R * 0.97, phase=math.pi / SIDES)
    for zz in (z0 + 0.10, z0 + WALL * 0.5, z0 + WALL - 0.08):
        m.cyl((0, 0, zz), R + 0.05, 0.075, SIDES, M['M_Wood'], r_top=R + 0.05,
              cap=False, phase=math.pi / SIDES)
    for k in range(6):
        a = math.pi * 0.5 + TAU * k / 6 + 0.42
        px, py = math.cos(a) * (R + 0.30), math.sin(a) * (R + 0.30)
        m.cyl((px, py, z0 - 0.02), 0.10, WALL + 0.42, 7, M['M_Wood'], r_top=0.09)

    wall_top = z0 + WALL
    tiers = [(R + 0.95, wall_top - 0.10, 1.05, 'M_Thatch'),
             (R + 0.55, wall_top + 0.72, 0.95, 'M_Thatch_Dark'),
             (R + 0.12, wall_top + 1.44, 0.82, 'M_Thatch')]
    for rr, zz, hh, mt in tiers:
        m.cyl((0, 0, zz), rr, hh, 14, M[mt], r_top=rr * 0.62, cap=False, smooth=False)
    m.cyl((0, 0, wall_top + 2.24), 0.36, 0.30, 12, M['M_Thatch'], r_top=0.02, smooth=False)

    n = 22
    for k in range(n):
        a = TAU * k / n
        px, py = math.cos(a) * (R + 0.92), math.sin(a) * (R + 0.92)
        m.box((px, py, wall_top - 0.20), (0.20, 0.13, 0.46),
              M['M_Thatch'] if k % 2 else M['M_Thatch_Dark'], rot=(0, 0, a))
    m.cyl((0, 0, wall_top + 2.46), 0.09, 0.30, 6, M['M_Wood_Dark'], r_top=0.03)

    m.box((0, R - 0.02, z0 + 1.02), (1.15, 0.18, 2.02), M['M_Wood_Dark'])
    m.box((0, R + 0.05, z0 + 1.02), (1.34, 0.10, 2.16), M['M_Wood'])
    m.box((0, R + 0.12, z0 + 2.06), (1.52, 0.30, 0.16), M['M_Wood'])

    cwx, cwy = R * 0.50, R * 0.74
    m.cyl((cwx, cwy, z0 + 1.55), 0.44, 0.12, 10, M['M_Wood'], axis='Y', cap=False)
    m.cyl((cwx, cwy + 0.04, z0 + 1.55), 0.36, 0.08, 10, M['M_Glass'], axis='Y')

    m.cyl((0, R + 0.95, BASE + 0.02), 1.60, 0.16, 9, M['M_Wood_Pale'], r_top=1.55)
    for s in (-1, 1):
        for i in range(3):
            m.cyl((s * 1.30, R + 0.36 + i * 0.55, BASE + 0.18), 0.045, 0.80, 5,
                  M['M_Thatch_Dark'], cap=False)
        m.cyl((s * 1.30, R + 0.38, BASE + 1.00), 0.055, 1.20, 5, M['M_Wood'], axis='Y', cap=False)
    m.box((0.95, R + 0.30, wall_top - 0.14), (0.24, 0.24, 0.30), M['M_Metal'])
    m.box((0.95, R + 0.30, z0 + WALL - 0.50), (0.19, 0.19, 0.28), M['M_Glass'])
    m.sphere((1.80, R + 0.60, BASE + 0.90), 1.0, 1, M['M_Fabric_Cream'],
             scale=(0.28, 0.05, 1.00), smooth=True)
    m.box((1.80, R + 0.66, BASE + 1.36), (0.10, 0.04, 0.62), M['M_Fabric_Red'])
    return m


# --------------------------------------------------------------------------- #
# C. 红白色渔村小屋
# --------------------------------------------------------------------------- #
def house_fishing():
    m = Mesh('house_fishing')
    W, D, BASE, WALL = 5.9, 4.9, 0.30, 3.15
    red, tr = M['M_Wall_Red'], M['M_Trim_White']

    m.box((0, 0, BASE / 2), (W + 0.30, D + 0.30, BASE), M['M_Stone'])
    m.box((0, 0, BASE + WALL / 2), (W, D, WALL), red)
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.box((sx * W / 2, sy * D / 2, BASE + WALL / 2), (0.18, 0.18, WALL), tr)
    m.box((0, 0, BASE + 0.10), (W + 0.10, D + 0.10, 0.20), tr)
    m.box((0, 0, BASE + WALL - 0.08), (W + 0.10, D + 0.10, 0.16), tr)
    wall_top = BASE + WALL
    gable_roof(m, W, D, wall_top, 1.95, 0.16, M['M_Roof_Slate'], tr, red, overhang=0.38)

    for s in (-1, 1):
        half = D / 2 + 0.38
        ang = math.atan2(1.95, half)
        slope = math.hypot(half, 1.95)
        for sx in (-1, 1):
            m.box((sx * (W / 2 + 0.30), s * half / 2, wall_top + 1.02),
                  (0.10, slope, 0.26), tr, rot=(-s * ang, 0, 0))

    door(m, 0, D / 2, BASE, 1.00, 2.10, tr, tr, ny=1)
    m.box((0, D / 2 + 0.30, BASE + 2.30), (1.60, 0.62, 0.10), M['M_Roof_Slate'], rot=(0.22, 0, 0))
    for s in (-1, 1):
        m.box((s * 0.66, D / 2 + 0.16, BASE + 2.12), (0.07, 0.34, 0.30), tr)

    for sx in (-1, 1):
        wx = sx * 1.78
        window(m, wx, D / 2, BASE + 1.92, 1.05, 1.08, tr, M['M_Glass'], nx=0, ny=1)
        m.box((wx, D / 2 + 0.12, BASE + 1.22), (1.16, 0.26, 0.22), tr)
        m.box((wx, D / 2 + 0.12, BASE + 1.38), (1.02, 0.20, 0.12), M['M_Moss'])
        m.box((wx, D / 2 + 0.10, BASE + 2.52), (1.24, 0.30, 0.12), tr)
    window(m, W / 2, -0.4, BASE + 1.92, 0.90, 1.0, tr, M['M_Glass'], nx=1, ny=0)

    m.box((0.9, D * 0.28, wall_top + 0.95), (1.30, 1.0, 0.95), red)
    m.box((0.9, D * 0.28 + 0.53, wall_top + 1.14), (0.86, 0.08, 0.70), tr)
    m.box((0.9, D * 0.28 + 0.57, wall_top + 1.14), (0.70, 0.06, 0.56), M['M_Glass'])
    m.box((0.9, D * 0.28, wall_top + 1.56), (1.52, 1.24, 0.12), M['M_Roof_Slate'], rot=(0.30, 0, 0))

    m.cyl((0, 0, wall_top + 2.0), 0.045, 1.05, 6, M['M_Metal'])
    m.box((0, 0, wall_top + 2.78), (0.62, 0.05, 0.05), M['M_Metal'])
    m.box((0, 0, wall_top + 2.78), (0.05, 0.62, 0.05), M['M_Metal'])
    m.box((0, 0, wall_top + 2.56), (0.05, 0.58, 0.28), M['M_Metal'])

    nx = -W / 2 - 1.40
    for sy in (-1.25, 1.25):
        m.cyl((nx, sy, 0), 0.09, 1.85, 6, M['M_Wood_Dark'], r_top=0.07)
    m.box((nx, 0, 1.80), (0.10, 2.70, 0.10), M['M_Wood_Dark'])
    for i in range(5):
        m.box((nx + 0.03, lerp(-1.15, 1.15, i / 4), 1.49), (0.05, 0.05, 0.62), M['M_Rope'])
    for i in range(3):
        m.box((nx + 0.03, 0, 1.16 - i * 0.13), (0.05, 2.36, 0.045), M['M_Rope'])
    m.box((-W / 2 - 0.55, D / 2 - 0.35, 0.30), (0.72, 0.52, 0.60), M['M_Wood'])
    m.box((-W / 2 - 0.55, D / 2 - 0.35, 0.62), (0.76, 0.56, 0.06), M['M_Wood_Dark'])
    m.box((W / 2 + 0.62, D / 2 - 0.55, 0.55), (0.66, 0.66, 0.56), M['M_Wood'])
    m.cyl((W / 2 + 1.55, D / 2 - 0.6, 0), 0.30, 0.78, 10, M['M_Wood_Dark'], r_top=0.34)
    for zz in (0.14, 0.62):
        m.cyl((W / 2 + 1.55, D / 2 - 0.6, zz), 0.335, 0.07, 10, M['M_Metal'],
              r_top=0.335, cap=False)
    return m


# --------------------------------------------------------------------------- #
# 礁石
# --------------------------------------------------------------------------- #
def rock_round():
    """圆润的海岸礁石：主块压得略扁但不到「面包」的程度，侧面带两块小石。

    之前 z 缩到 0.62 + 抖动 0.14，出来是一个过扁过亮的椭圆体，在阳光下
    像一块白面包。改成 0.74 并且把抖动提到 0.20，轮廓才有起伏。
    """
    m = Mesh('rock_round')
    m.sphere((0, 0, 0.44), 1.0, 2, M['M_Rock_Light'],
             scale=(1.0, 0.84, 0.74), jitter=0.20, smooth=True, seed=7)
    m.sphere((0.66, 0.30, 0.26), 0.50, 2, M['M_Rock_Light'],
             scale=(1.0, 0.9, 0.78), jitter=0.22, smooth=True, seed=11)
    m.sphere((-0.58, -0.44, 0.20), 0.36, 2, M['M_Rock_Light'],
             scale=(1.0, 1.0, 0.80), jitter=0.24, smooth=True, seed=13)
    recolor_top(m, 0.58, M['M_Rock_Wet'])
    return m


def rock_dark():
    """深灰色岩石：有棱角的碎块。

    原来 subdiv=1 只有 32 个面，再叠 ±30% 的顶点抖动，每个面都被拉成一根
    尖锥 —— 远看是一排黑色金字塔，完全不像石头。细分提到 2（128 面）再
    把抖动降到 0.16，保留平直着色的棱角感，但轮廓回到石头。
    """
    m = Mesh('rock_dark')
    m.sphere((0, 0, 0.62), 1.0, 2, M['M_Rock_Dark'],
             scale=(1.0, 0.80, 1.02), jitter=0.16, smooth=False, seed=23)
    m.sphere((0.74, -0.20, 0.40), 0.54, 2, M['M_Rock_Dark'],
             scale=(1.0, 0.9, 1.16), jitter=0.17, smooth=False, seed=29)
    m.sphere((-0.70, 0.36, 0.30), 0.42, 2, M['M_Rock_Dark'],
             scale=(0.9, 1.0, 1.05), jitter=0.18, smooth=False, seed=31)
    return m


def rock_shallow():
    """半浸水的潮池礁：矮而宽，边沿一圈石唇，顶上带湿绿。"""
    m = Mesh('rock_shallow')
    m.sphere((0, 0, 0.16), 1.0, 2, M['M_Rock_Wet'],
             scale=(1.15, 1.0, 0.30), jitter=0.10, smooth=True, seed=41)
    for k in range(12):
        a = TAU * k / 12
        r = 1.02 + 0.04 * math.sin(k * 2.1)
        m.sphere((math.cos(a) * r, math.sin(a) * r, 0.22), 0.19, 1, M['M_Rock_Wet'],
                 scale=(1.0, 1.0, 0.7), jitter=0.22, smooth=True, seed=50 + k)
    m.sphere((0, 0, 0.15), 0.55, 1, M['M_Moss'], scale=(1.0, 1.0, 0.22),
             jitter=0.12, smooth=True, seed=61)
    m.sphere((0.88, 0.55, 0.10), 0.34, 1, M['M_Rock_Wet'], scale=(1.0, 1.0, 0.4),
             jitter=0.18, smooth=True, seed=67)
    return m


# --------------------------------------------------------------------------- #
# 棕榈树
# --------------------------------------------------------------------------- #
def palm():
    m = Mesh('palm')
    H, RINGS, SIDES, LEAN = 7.2, 15, 8, 1.55

    def center(t):
        return (LEAN * (t ** 1.75), 0.0, t * H)

    # 树干：一环一环，半径随高度收缩并带环状起伏
    base = len(m.v)
    for r in range(RINGS + 1):
        t = r / RINGS
        cx, cy, cz = center(t)
        rad = (0.30 - 0.15 * t) * (1.0 + 0.07 * math.sin(t * 26.0))
        for k in range(SIDES):
            a = TAU * k / SIDES
            m.vert((cx + math.cos(a) * rad, cy + math.sin(a) * rad, cz))
    for r in range(RINGS):
        for k in range(SIDES):
            k2 = (k + 1) % SIDES
            m.face([base + r * SIDES + k, base + r * SIDES + k2,
                    base + (r + 1) * SIDES + k2, base + (r + 1) * SIDES + k],
                   M['M_Trunk'], True, 1.0)
    # 根部膨大
    for k in range(6):
        a = TAU * k / 6
        m.sphere((math.cos(a) * 0.22, math.sin(a) * 0.22, 0.12), 0.15, 1,
                 M['M_Trunk'], scale=(1.0, 1.0, 0.6), smooth=True, seed=200 + k)

    topx, topy, topz = center(1.0)
    m.sphere((topx, topy, topz + 0.04), 0.32, 1, M['M_Trunk'],
             scale=(1, 1, 0.85), smooth=True, seed=3)

    rnd = random.Random(97)
    NF = 13
    RIB = 12                       # 中肋分 12 段（原来是 8 段）
    for i in range(NF):
        a = TAU * i / NF + rnd.random() * 0.20
        layer = i % 2
        tilt = math.radians(16 if layer == 0 else 42)
        length = (3.10 if layer == 0 else 2.60) + rnd.random() * 0.55
        droop = 0.60 if layer == 0 else 1.05
        dx, dy = math.cos(a), math.sin(a)
        nx, ny = -dy, dx
        pts = []
        for s in range(RIB + 1):
            t = s / RIB
            pts.append((topx + dx * math.cos(tilt) * length * t,
                        topy + dy * math.cos(tilt) * length * t,
                        topz + math.sin(tilt) * length * t * 0.55 - droop * length * t * t))
        # 中肋（薄带，往叶尖收窄）
        b = len(m.v)
        for s, p in enumerate(pts):
            hw = 0.045 * (1.0 - 0.62 * s / RIB)
            m.vert((p[0] - nx * hw, p[1] - ny * hw, p[2]))
        for s, p in enumerate(pts):
            hw = 0.045 * (1.0 - 0.62 * s / RIB)
            m.vert((p[0] + nx * hw, p[1] + ny * hw, p[2]))
        for s in range(RIB):
            m.face([b + s, b + s + 1, b + RIB + 1 + s + 1, b + RIB + 1 + s],
                   M['M_Frond'], True, 1.0)

        # 小叶：沿中肋每段一对，向外下方展开。
        #
        # 原来每片小叶只有 1 个三角、而且所有小叶共面（都在中肋的
        # 展开方向上），从下往上看整个树冠就是一只扁平的绿色刺盘。
        # 现在：叶尖各带一点上下抖动和长度差，一片叶子是收尖的四边形，
        # 一片复叶有 11 对小叶，轮廓是羽状而不是锯齿状。
        for s in range(1, RIB):
            t = s / RIB
            px, py, pz = pts[s]
            # 中段最长、往叶尖变短，是棕榈复叶的形状
            env = math.sin(math.pi * (0.18 + 0.78 * t)) ** 0.75
            leaf = (0.58 + 0.42 * env) * (0.95 + 0.10 * rnd.random())
            for sgn in (-1, 1):
                w0 = 0.085 * (1.0 - 0.30 * t)
                bx, by = px + nx * sgn * 0.02, py + ny * sgn * 0.02
                # 叶子不是完全共面：叶尖在竖直方向上下错开
                jz = (rnd.random() - 0.5) * 0.26
                tipx = px + nx * sgn * leaf * (1.02 + 0.10 * rnd.random())
                tipy = py + ny * sgn * leaf * (1.02 + 0.10 * rnd.random())
                tipz = pz - leaf * (0.30 + 0.42 * env) + jz
                v0 = m.vert((bx - dx * w0, by - dy * w0, pz))
                v1 = m.vert((bx + dx * w0, by + dy * w0, pz))
                v2 = m.vert((tipx - dx * w0 * 0.28, tipy - dy * w0 * 0.28, tipz))
                v3 = m.vert((tipx + dx * w0 * 0.28, tipy + dy * w0 * 0.28, tipz))
                m.face([v0, v1, v3, v2], M['M_Frond'], True, 1.0)

    for i in range(4):
        a = TAU * i / 4 + 0.4
        m.sphere((topx + math.cos(a) * 0.30, topy + math.sin(a) * 0.30, topz - 0.24),
                 0.15, 1, M['M_Coconut'], scale=(1, 1, 1.1), smooth=True, seed=70 + i)
    return m


def palm_lod():
    """远距离棕榈：树干只留 6 环 6 边，叶片从 13 片带小叶的复叶降到 7 片
    单张条带，去掉椰子和根部鼓包 —— 982 面 → 约 150 面。

    近处（离路 40 m 内）用完整模型，外侧一律用这个。棕榈林要密，但
    密到 150 棵全用完整模型就是 15 万面，手机端直接掉帧。"""
    m = Mesh('palm_lod')
    H, RINGS, SIDES, LEAN = 7.2, 6, 6, 1.55

    base = len(m.v)
    for r in range(RINGS + 1):
        t = r / RINGS
        cx = LEAN * (t ** 1.75)
        rad = 0.30 - 0.15 * t
        for k in range(SIDES):
            a = TAU * k / SIDES
            m.vert((cx + math.cos(a) * rad, math.sin(a) * rad, t * H))
    for r in range(RINGS):
        for k in range(SIDES):
            k2 = (k + 1) % SIDES
            m.face([base + r * SIDES + k, base + r * SIDES + k2,
                    base + (r + 1) * SIDES + k2, base + (r + 1) * SIDES + k],
                   M['M_Trunk'], True, 1.0)

    topx, topz = LEAN, H
    rnd = random.Random(97)
    NF, SEG = 7, 3
    for i in range(NF):
        a = TAU * i / NF + rnd.random() * 0.20
        tilt = math.radians(16 if i % 2 == 0 else 42)
        length = (3.10 if i % 2 == 0 else 2.60) + rnd.random() * 0.55
        droop = 0.60 if i % 2 == 0 else 1.05
        dx, dy = math.cos(a), math.sin(a)
        nx, ny = -dy, dx
        prev = None
        for s in range(SEG + 1):
            t = s / SEG
            px = topx + dx * math.cos(tilt) * length * t
            py = dy * math.cos(tilt) * length * t
            pz = topz + math.sin(tilt) * length * t * 0.55 - droop * length * t * t
            # 叶带从根部 0.30 m 宽收到叶尖 0.02 m
            hw = 0.30 * (1.0 - t) + 0.02
            v0 = m.vert((px - nx * hw, py - ny * hw, pz))
            v1 = m.vert((px + nx * hw, py + ny * hw, pz))
            if prev:
                m.face([prev[0], prev[1], v1, v0], M['M_Frond'], True, 1.0)
            prev = (v0, v1)
    return m


# --------------------------------------------------------------------------- #
# 木桥模块
# --------------------------------------------------------------------------- #
def bridge_plank():
    """单块桥板：1.0 × 0.34 × 0.075。游戏端沿桥宽方向拉伸铺满。"""
    m = Mesh('bridge_plank')
    m.box((0, 0, 0), (1.0, 0.34, 0.075), M['M_Wood_Pale'])
    return m


def bridge_plank_worn():
    m = Mesh('bridge_plank_worn')
    m.box((0, 0, 0), (1.0, 0.34, 0.075), M['M_Wood'])
    for s in (-1, 1):
        m.box((s * 0.46, 0, 0.037), (0.07, 0.335, 0.006), M['M_Wood_Dark'])
    return m


def bridge_post():
    m = Mesh('bridge_post')
    m.box((0, 0, 0.53), (0.13, 0.13, 1.06), M['M_Wood_Dark'])
    m.box((0, 0, 1.09), (0.17, 0.17, 0.07), M['M_Wood'])
    m.box((0, 0, 1.135), (0.10, 0.10, 0.05), M['M_Wood'])
    for s in (-1, 1):
        m.box((0.068, s * 0.05, 0.86), (0.02, 0.02, 0.02), M['M_Metal'])
    return m


def bridge_rail():
    """2.4 m 一段横梁（上下两道各用一次）。"""
    m = Mesh('bridge_rail')
    m.box((0, 0, 0), (0.10, 2.4, 0.19), M['M_Wood'])
    m.box((0, 0, 0.10), (0.115, 2.4, 0.02), M['M_Wood_Pale'])
    return m


def bridge_brace():
    m = Mesh('bridge_brace')
    m.box((0, 0, 0), (0.075, 0.95, 0.13), M['M_Wood_Dark'])
    return m


def bridge_kerb():
    m = Mesh('bridge_kerb')
    m.box((0, 0, 0), (0.24, 2.4, 0.30), M['M_Wood_Dark'])
    m.box((0, 0, 0.155), (0.28, 2.4, 0.03), M['M_Wood'])
    return m


def bridge_pier():
    m = Mesh('bridge_pier')
    H = 6.6
    for s in (-1, 1):
        m.cyl((s * 0.62, 0, -H + 0.4), 0.26, H, 8, M['M_Wood_Dark'], r_top=0.22)
        m.cyl((s * 0.62, 0, -H + 0.4), 0.30, 0.35, 8, M['M_Stone'], r_top=0.30)
    m.box((0, 0, -1.15), (1.85, 0.16, 0.20), M['M_Wood_Dark'])
    m.box((0, 0, -3.40), (1.85, 0.14, 0.18), M['M_Wood_Dark'])
    for sy in (-1, 1):
        m.box((0, 0, -2.30), (0.09, 0.09, 2.60), M['M_Wood'],
              rot=(math.atan2(1.24, 2.25) * sy, 0, 0))
    m.box((0, 0, 0.12), (1.75, 0.44, 0.16), M['M_Wood'])
    return m


# --------------------------------------------------------------------------- #
# 沙滩道具
# --------------------------------------------------------------------------- #
def umbrella():
    m = Mesh('umbrella')
    m.cyl((0, 0, 0), 0.045, 2.35, 6, M['M_Wood_Pale'])
    m.cyl((0, 0, 0), 0.20, 0.05, 6, M['M_Wood_Dark'], r_top=0.16)
    apex, rim, N = 2.98, 1.62, 10
    for k in range(N):
        a0, a1 = TAU * k / N, TAU * (k + 1) / N
        mat = M['M_Fabric_Red'] if k % 2 == 0 else M['M_Fabric_Cream']
        dip = 0.10 if k % 2 else 0.02
        b = len(m.v)
        m.vert((0, 0, apex))
        m.vert((math.cos(a0) * rim, math.sin(a0) * rim, 2.30 - dip))
        m.vert((math.cos(a1) * rim, math.sin(a1) * rim, 2.30 - dip * 0.6))
        m.face([b, b + 1, b + 2], mat, True, 1.0)
        c = len(m.v)
        m.vert((math.cos(a0) * rim, math.sin(a0) * rim, 2.30 - dip))
        m.vert((math.cos(a1) * rim, math.sin(a1) * rim, 2.30 - dip * 0.6))
        m.vert((math.cos(a1) * (rim + 0.07), math.sin(a1) * (rim + 0.07), 2.13 - dip * 0.8))
        m.vert((math.cos(a0) * (rim + 0.07), math.sin(a0) * (rim + 0.07), 2.15 - dip))
        m.face([c, c + 1, c + 2, c + 3], mat, True, 1.0)
    m.sphere((0, 0, apex + 0.05), 0.075, 1, M['M_Wood_Dark'], smooth=True, seed=5)
    return m


def lounger():
    m = Mesh('lounger')
    for s in (-1, 1):
        m.box((s * 0.32, 0, 0.20), (0.07, 1.85, 0.42), M['M_Wood'])
    for i in range(5):
        m.box((0, lerp(-0.82, 0.34, i / 4), 0.40), (0.76, 0.24, 0.05), M['M_Wood_Pale'])
    m.box((0, 0.62, 0.50), (0.76, 0.66, 0.06), M['M_Fabric_Red'], rot=(-0.62, 0, 0))
    m.box((0, 0.80, 0.70), (0.70, 0.44, 0.06), M['M_Fabric_Cream'], rot=(-0.62, 0, 0))
    return m


def crate():
    m = Mesh('crate')
    m.box((0, 0, 0.3), (0.66, 0.60, 0.60), M['M_Wood'])
    for s in (-1, 1):
        m.box((0, s * 0.305, 0.3), (0.70, 0.05, 0.09), M['M_Wood_Dark'])
        m.box((s * 0.335, 0, 0.3), (0.05, 0.64, 0.09), M['M_Wood_Dark'])
    m.box((0, 0, 0.61), (0.70, 0.64, 0.05), M['M_Wood_Dark'])
    return m


def barrel():
    m = Mesh('barrel')
    m.cyl((0, 0, 0), 0.28, 0.78, 10, M['M_Wood'], r_top=0.28)
    for zz in (0.13, 0.62):
        m.cyl((0, 0, zz), 0.295, 0.06, 10, M['M_Metal'], r_top=0.295, cap=False)
    return m


def surfboard():
    m = Mesh('surfboard')
    m.sphere((0, 0, 0), 1.0, 2, M['M_Fabric_Cream'], scale=(0.32, 1.05, 0.055),
             smooth=True, seed=1)
    m.box((0, 0.02, 0.06), (0.10, 1.42, 0.02), M['M_Fabric_Red'])
    return m


def sign():
    m = Mesh('sign')
    for s in (-1, 1):
        m.cyl((s * 1.05, 0, 0), 0.08, 1.55, 6, M['M_Wood_Dark'], r_top=0.07)
    m.box((0, 0, 1.48), (2.50, 0.12, 0.86), M['M_Wood'])
    m.box((0, 0.08, 1.48), (2.34, 0.04, 0.70), M['M_Trim_White'])
    m.box((0, 0, 1.95), (2.60, 0.16, 0.10), M['M_Wood_Dark'])
    return m


def flagpole():
    m = Mesh('flagpole')
    m.cyl((0, 0, 0), 0.055, 4.2, 6, M['M_Metal'], r_top=0.04)
    m.sphere((0, 0, 4.24), 0.07, 1, M['M_Metal'], smooth=True, seed=9)
    b = len(m.v)
    m.vert((0.02, 0, 4.05))
    m.vert((0.02, 0, 3.10))
    m.vert((0.02, 0.95, 3.62))
    m.face([b, b + 1, b + 2], M['M_Fabric_Red'], False, 1.0)
    m.face([b + 2, b + 1, b], M['M_Fabric_Red'], False, 1.0)
    return m


def grandstand():
    m = Mesh('grandstand')
    W = 15.0
    for i in range(4):
        m.box((0, -i * 1.0, 0.28 + i * 0.55), (W, 1.05, 0.55), M['M_Wood_Pale'])
        m.box((0, -i * 1.0 + 0.42, 0.58 + i * 0.55), (W * 0.98, 0.30, 0.07), M['M_Fabric_Red'])
    m.box((0, -4.2, 1.45), (W, 0.32, 2.9), M['M_Trim_White'])
    for s in (-1, 1):
        for i in range(3):
            m.box((s * (W / 2 - 0.22), -i * 1.1 + 0.2, 1.5 + i * 0.1),
                  (0.22, 0.22, 3.0), M['M_Trim_White'])
    m.box((0, -1.9, 3.35), (W + 1.4, 4.6, 0.18), M['M_Fabric_Cream'], rot=(0.055, 0, 0))
    m.box((0, -4.2, 3.44), (W + 1.5, 0.24, 0.24), M['M_Trim_Blue'])
    for s in (-1, 1):
        b = len(m.v)
        x = s * (W / 2 + 0.06)
        m.vert((x, 0.55, 0.02))
        m.vert((x, -4.0, 0.02))
        m.vert((x, -4.0, 3.40))
        m.vert((x, 0.55, 3.40))
        m.face([b, b + 1, b + 2, b + 3] if s > 0 else [b + 3, b + 2, b + 1, b],
               M['M_Trim_Blue'], False, 1.0)
    return m


def start_gate():
    m = Mesh('start_gate')
    for s in (-1, 1):
        m.cyl((s * 9.2, 0, 0), 0.42, 0.55, 8, M['M_Stone'], r_top=0.36)
        m.cyl((s * 9.2, 0, 0.50), 0.26, 6.90, 8, M['M_Trim_White'], r_top=0.24)
        m.box((s * 9.9, 0, 7.90), (0.30, 0.30, 1.90), M['M_Trim_White'])
        m.cyl((s * 9.9, 0, 8.55), 0.04, 0.90, 5, M['M_Metal'])
        b = len(m.v)
        m.vert((s * 9.9, 0.0, 9.40))
        m.vert((s * 9.9, 0.0, 8.62))
        m.vert((s * 9.9, 0.70, 9.00))
        m.face([b, b + 1, b + 2], M['M_Fabric_Red'], False, 1.0)
        m.face([b + 2, b + 1, b], M['M_Fabric_Red'], False, 1.0)
    m.box((0, 0, 7.50), (19.6, 0.55, 1.55), M['M_Trim_Blue'])
    m.box((0, 0, 7.50), (18.6, 0.62, 1.15), M['M_Gate_Banner'])
    m.box((0, 0, 8.42), (19.9, 0.70, 0.22), M['M_Trim_White'])
    m.box((0, 0, 6.66), (19.6, 0.55, 0.12), M['M_Trim_White'])
    return m


def buoy():
    m = Mesh('buoy')
    m.cyl((0, 0, 0), 0.26, 0.20, 10, M['M_Fabric_Red'], r_top=0.30)
    m.cyl((0, 0, 0.20), 0.30, 0.34, 10, M['M_Trim_White'], r_top=0.22)
    m.cyl((0, 0, 0.54), 0.22, 0.20, 10, M['M_Fabric_Red'], r_top=0.10)
    m.box((0, 0, 0.80), (0.06, 0.06, 0.24), M['M_Metal'])
    return m


def grass_tuft():
    m = Mesh('grass_tuft')
    rnd = random.Random(17)
    for i in range(7):
        a = TAU * i / 7 + rnd.random() * 0.4
        h = 0.55 + rnd.random() * 0.35
        tilt = 0.22 + rnd.random() * 0.20
        dx, dy = math.cos(a), math.sin(a)
        w = 0.05
        b = len(m.v)
        m.vert((-dy * w, dx * w, 0))
        m.vert((dy * w, -dx * w, 0))
        m.vert((dx * h * tilt, dy * h * tilt, h))
        m.face([b, b + 1, b + 2], M['M_Sand_Grass'], True, 1.0)
        m.face([b + 2, b + 1, b], M['M_Sand_Grass'], True, 1.0)
    return m


# --------------------------------------------------------------------------- #
ASSETS = [
    ('house_blue', house_blue),
    ('house_thatch', house_thatch),
    ('house_fishing', house_fishing),
    ('rock_round', rock_round),
    ('rock_dark', rock_dark),
    ('rock_shallow', rock_shallow),
    ('palm', palm),
    ('palm_lod', palm_lod),
    ('bridge_plank', bridge_plank),
    ('bridge_plank_worn', bridge_plank_worn),
    ('bridge_post', bridge_post),
    ('bridge_rail', bridge_rail),
    ('bridge_brace', bridge_brace),
    ('bridge_kerb', bridge_kerb),
    ('bridge_pier', bridge_pier),
    ('umbrella', umbrella),
    ('lounger', lounger),
    ('crate', crate),
    ('barrel', barrel),
    ('surfboard', surfboard),
    ('sign', sign),
    ('flagpole', flagpole),
    ('grandstand', grandstand),
    ('start_gate', start_gate),
    ('buoy', buoy),
    ('grass_tuft', grass_tuft),
]


def main():
    os.makedirs(GLB_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    reset_scene()
    setup_materials()

    report = {'blender': bpy.app.version_string, 'assets': [], 'materials': MAT_NAMES}
    objs = []
    for name, fn in ASSETS:
        mesh = fn()
        nv, nt = mesh.stats()
        obj = build_object(mesh, MAT_NAMES, name)
        used = sorted({MAT_NAMES[i] for i in mesh.fm})
        path = os.path.join(GLB_DIR, name + '.glb')
        export_glb(obj, path)
        size = os.path.getsize(path)
        report['assets'].append({
            'name': name, 'verts': nv, 'tris': nt, 'materials': used,
            'bytes': size, 'kb': round(size / 1024, 1),
        })
        print(f'  {name:20s} {nv:5d} v  {nt:5d} tri  {size / 1024:6.1f} KB  {len(used)} mat')
        objs.append(obj)

    cols = 6
    for i, obj in enumerate(objs):
        obj.location = ((i % cols) * 16.0, (i // cols) * 16.0, 0)
    blend = os.path.join(OUT_DIR, 'ch2.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend)

    total_tri = sum(a['tris'] for a in report['assets'])
    total_kb = sum(a['kb'] for a in report['assets'])
    report['total_tris'] = total_tri
    report['total_kb'] = round(total_kb, 1)
    report['blend'] = os.path.relpath(blend, ROOT).replace('\\', '/')
    with open(os.path.join(OUT_DIR, 'report.json'), 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(f'\n合计 {total_tri} 三角面 / {total_kb:.1f} KB / {len(ASSETS)} 个资产')


if __name__ == '__main__':
    main()
