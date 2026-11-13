"""AE86「秋名疾影」V9 —— 稀有车视觉重建（保真版）

  blender -b -P bl_rare_v9.py -- <in.glb> <out.glb> [--report=json] [--blend=path] [--texdir=dir]

V8 的教训：原始图集是 34 个 island 的乱序 UV，用「几何分区→重新上色」会在
贴图上切出白斑 / 黑块，车身反而更脏。

V9 换成**保形调色**：
  · 不改贴图分区，只在色相/明度上把原图烘死的灰脏，重新映射成
    「珍珠白 / 碳纤黑 / 冷调玻璃 / 高饱和灯组」四档干净色阶；
  · 面板缝、格栅、灯壳这些原图已经画好的细节全部保留；
  · 材质上升级成「清漆珍珠 + 缎面碳纤 + 钛银轮辐 + 香槟金轮唇 + 金色卡钳」；
  · 去掉 V8 那两块外挂前唇 / 扩散器（悬空成板），只留金色拖车钩。

  姿态   车壳下压 + 轮距加宽 + 轮组放大 + 贴地对齐
  轮组   四轮拆成可转向可旋转节点（wheel_xx_pivot 约定），轮面重做八辐
"""
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
REPORT, BLEND_OUT, TEXDIR = "", "", ""
for a in argv[2:]:
    if a.startswith("--report="):
        REPORT = a.split("=", 1)[1]
    elif a.startswith("--blend="):
        BLEND_OUT = a.split("=", 1)[1]
    elif a.startswith("--texdir="):
        TEXDIR = a.split("=", 1)[1]

HERE = os.path.dirname(os.path.abspath(__file__))
if not TEXDIR:
    TEXDIR = os.path.join(os.path.dirname(HERE), "out", "v9tex")
os.makedirs(TEXDIR, exist_ok=True)


def srgb(hexv, a=1.0):
    r, g, b = ((hexv >> 16) & 255) / 255.0, ((hexv >> 8) & 255) / 255.0, (hexv & 255) / 255.0
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), a)


def sc(hexv):
    return np.array([((hexv >> 16) & 255), ((hexv >> 8) & 255), (hexv & 255)], dtype=np.float32) / 255.0


# 珍珠白 / 碳纤黑 / 玻璃 / 轮毂 / 金色
PEARL, CARBON, GLASS = 0xEDF0F2, 0x14161A, 0x090D13
RIMC, GOLD, DISC = 0xC9CED3, 0xCBAD7E, 0x8F959C
CARBON_TRIM = 0x1A1D22
LAMP_R, LAMP_A = 0xFF2A14, 0xFF9A18

R = {}

# ------------------------------------------------------------------ import
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scn = bpy.context.scene
shell = [o for o in scn.objects if o.type == "MESH"][0]

img = None
for n in bpy.data.images:
    if n.size[0] > 64:
        img = n
        break
W, H = img.size
PX = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[:, :, :3]

shell.data.transform(shell.matrix_world)
shell.matrix_world = Matrix.Identity(4)
me = shell.data

co = np.array([list(v.co) for v in me.vertices], dtype=np.float64)
LO, HI = co.min(axis=0), co.max(axis=0)
DIM = HI - LO
R["src"] = {"bbox": [LO.round(3).tolist(), HI.round(3).tolist()],
            "verts": len(me.vertices), "faces": len(me.polygons),
            "materials": [m.name for m in me.materials]}
OLD = {m.name: i for i, m in enumerate(me.materials)}
if "ae86_rim" not in OLD:
    raise SystemExit("[bl_rare_v9] 输入模型已经是成品（找不到 ae86_rim），请用 out/ae86-src-rare.glb 作为输入")
OLD_RIM, OLD_RUB = OLD.get("ae86_rim", 2), OLD.get("ae86_rubber", 1)

# ------------------------------------------------------------------ 1. 轮心
rub = np.array([list(me.polygons[p.index].center) for p in me.polygons
                if p.material_index == OLD_RUB])
WHEELS = {}
for c in rub:
    WHEELS.setdefault((1 if c[0] > 0 else -1, 1 if c[1] > 0 else -1), []).append(c)
for k in WHEELS:
    p = np.array(WHEELS[k])
    WHEELS[k] = dict(x=float(k[0] * (abs(p[:, 0]).max() + abs(p[:, 0]).min()) / 2),
                     y=float((p[:, 1].min() + p[:, 1].max()) / 2),
                     z=float((p[:, 2].min() + p[:, 2].max()) / 2),
                     half=float((abs(p[:, 0]).max() - abs(p[:, 0]).min()) / 2),
                     r=float(max(p[:, 1].max() - p[:, 1].min(),
                                 p[:, 2].max() - p[:, 2].min()) / 2))
R["wheels"] = {f"{k[0]}_{k[1]}": {a: round(b, 4) for a, b in w.items()} for k, w in WHEELS.items()}
print("WHEELS", json.dumps(R["wheels"]))

# ------------------------------------------------------------------ 2. 拆轮
NAMES = {(-1, -1): "fl", (1, -1): "fr", (-1, 1): "rl", (1, 1): "rr"}


def in_wheel_zone(c, w, f=0.985):
    return math.hypot(c[1] - w["y"], c[2] - w["z"]) < w["r"] * f and abs(c[0]) > w["half"] * 0.92


def new_obj(name, bm, mats):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new(name, mesh)
    scn.collection.objects.link(o)
    for m in mats:
        mesh.materials.append(m)
    return o


wheel_objs = {}
for key, w in WHEELS.items():
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    drop = []
    for f in bm.faces:
        c = f.calc_center_median()
        same = (1 if c[0] > 0 else -1, 1 if c[1] > 0 else -1) == key
        if not (same and in_wheel_zone(c, w)):
            drop.append(f)
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    wheel_objs[key] = new_obj("wheel_" + NAMES[key], bm, list(me.materials))

bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
drop = []
for f in bm.faces:
    c = f.calc_center_median()
    for key, w in WHEELS.items():
        if (1 if c[0] > 0 else -1, 1 if c[1] > 0 else -1) == key and in_wheel_zone(c, w):
            drop.append(f)
            break
bmesh.ops.delete(bm, geom=drop, context="FACES")
bm.to_mesh(me)
bm.free()
me.update()
R["split"] = {"shell_faces": len(me.polygons),
              "wheels": {NAMES[k]: len(wheel_objs[k].data.polygons) for k in wheel_objs}}

# ------------------------------------------------------------------ 3. 姿态
DROP, WS, TRACK = 0.012, 1.032, 0.014
for key, w in WHEELS.items():
    o = wheel_objs[key]
    ctr = Vector((w["x"], w["y"], w["z"]))
    o.data.transform(Matrix.Translation(-ctr))
    o.data.transform(Matrix.Scale(WS, 4))
    o.data.transform(Matrix.Translation(Vector((ctr.x, ctr.y, ctr.z * WS))))
    shift = math.copysign(TRACK, w["x"])
    o.data.transform(Matrix.Translation(Vector((shift, 0, 0))))
    w["r"] *= WS
    w["half"] *= WS
    w["x"] += shift
    w["z"] = w["r"]
shell.data.transform(Matrix.Translation(Vector((0, 0, -DROP))))
me.update()

# ------------------------------------------------------------------ 4. 保形调色（不重新分区）
r_, g_, b_ = PX[:, :, 0], PX[:, :, 1], PX[:, :, 2]
lum = 0.299 * r_ + 0.587 * g_ + 0.114 * b_
sat = (PX.max(axis=2) - PX.min(axis=2)) / np.maximum(PX.max(axis=2), 1e-4)

PEARL_S, CARBON_S, GLASS_S = sc(PEARL), sc(CARBON), sc(GLASS)

# 4a. 白 / 黑两档色阶：白漆抬到珍珠白，黑漆压成缎面碳纤，中缝用 smoothstep 过渡
t = np.clip((lum - 0.26) / 0.30, 0, 1)
t = t * t * (3 - 2 * t)
pearl = PEARL_S[None, None, :] * (0.93 + 0.11 * np.clip(lum, 0, 1))[..., None]
carbon = CARBON_S[None, None, :] * (0.55 + 1.55 * np.clip(lum, 0, 1))[..., None]
paint = carbon * (1 - t[..., None]) + pearl * t[..., None]

# 4b. 只对「中性色」像素换色，带颜色的细节（灯、标识、格栅金边）原样保留
neutral = np.clip(1.0 - sat * 1.35, 0, 1)
out = PX * (1 - neutral[..., None]) + paint * neutral[..., None]

# 4c. 玻璃：原图是发暖的暗红，换成冷调深蓝灰 + 轻微天光渐变
glass = ((lum < 0.34) & (sat > 0.10) & (r_ > g_ * 1.10)).astype(np.float32)
gy = np.linspace(0, 1, H, dtype=np.float32)[:, None][..., None]
GB = GLASS_S[None, None, :] * (0.75 + 1.35 * (1 - gy))
out = out * (1 - glass[..., None]) + GB * glass[..., None]

# 4d. 灯组：红尾灯 / 橙色转向灯，高饱和保留并给自发光图
red = ((r_ > 0.34) & (r_ > g_ * 1.65) & (r_ > b_ * 1.65) & (lum > 0.10)).astype(np.float32)
amb = ((r_ > 0.45) & (g_ > 0.20) & (g_ < 0.72) & (b_ < 0.26) & (r_ > b_ * 2.2)).astype(np.float32)
RED_S, AMB_S = sc(LAMP_R), sc(LAMP_A)


def dilate(m, r=2):
    o = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            o = np.maximum(o, np.roll(np.roll(m, dy, 0), dx, 1))
    return o


redm, ambm = dilate(red, 1), dilate(amb, 1)
out = out * (1 - redm[..., None] * 0.55) + RED_S[None, None, :] * (redm[..., None] * 0.55)
out = out * (1 - ambm[..., None] * 0.45) + AMB_S[None, None, :] * (ambm[..., None] * 0.45)

# 暗部极淡的碳纤斜纹（±7%），远看是哑光质感，近看有织纹
GYg, GXg = np.meshgrid(np.arange(H), np.arange(W), indexing="ij")
weave = (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * (GXg + GYg) / 13.0))) *         (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * (GXg - GYg) / 13.0)))
darkish = ((lum < 0.30) & (neutral > 0.35)).astype(np.float32)
out = np.clip(out * (1 + 0.14 * darkish[..., None] * (weave[..., None] - 0.5)), 0, 1)

emis = np.maximum(RED_S[None, None, :] * redm[..., None] * 1.0,
                  AMB_S[None, None, :] * ambm[..., None] * 0.85)
# 空白区压暗，避免图集缝隙闪白
blank = (lum < 0.012)
out[blank] *= 0.3
emis[blank] = 0


def save_jpg(arr, name, quality=92):
    p = os.path.join(TEXDIR, name)
    if os.path.exists(p):
        os.remove(p)
    im = bpy.data.images.new(name, arr.shape[1], arr.shape[0], alpha=False)
    buf = np.concatenate([np.clip(arr, 0, 1), np.ones(arr.shape[:2] + (1,), np.float32)], 2)
    im.pixels = buf.reshape(-1).tolist()
    im.file_format = "JPEG"
    im.filepath_raw = p
    im.save(quality=quality)
    bpy.data.images.remove(im)
    return p


P_BASE = save_jpg(out, "ae86_v11_base.jpg", 92)
P_EMIS = save_jpg(emis, "ae86_v11_emissive.jpg", 90)
TEX_BASE = bpy.data.images.load(P_BASE)
TEX_BASE.colorspace_settings.name = "sRGB"
TEX_EMIS = bpy.data.images.load(P_EMIS)
TEX_EMIS.colorspace_settings.name = "sRGB"
R["tex"] = {"base": os.path.getsize(P_BASE), "emissive": os.path.getsize(P_EMIS)}
R["px"] = {"glass": round(float(glass.mean()), 4), "red": round(float(red.mean()), 4),
           "amber": round(float(amb.mean()), 4)}
print("TEX", R["tex"], R["px"])


# ------------------------------------------------------------------ 5. 材质
def mkmat(name, tex=None, color=None, metal=0.0, rough=0.5, coat=0.0, coat_r=0.06,
          emit_tex=None, emit_s=0.0, emit_col=None, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    if tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = tex
        t.interpolation = "Linear"
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    else:
        b.inputs["Base Color"].default_value = srgb(color)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = spec
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = coat_r
    if emit_tex is not None:
        e = nt.nodes.new("ShaderNodeTexImage")
        e.image = emit_tex
        e.interpolation = "Linear"
        nt.links.new(e.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = emit_s
    elif emit_col is not None:
        b.inputs["Emission Color"].default_value = srgb(emit_col)
        b.inputs["Emission Strength"].default_value = emit_s
    m.use_backface_culling = True
    return m


# 清漆粗糙度给到 0.09：车库棚灯不会在机盖上打出死白高光
M_BODY = mkmat("ae86_body", tex=TEX_BASE, metal=0.05, rough=0.26, coat=1.0, coat_r=0.14,
               emit_tex=TEX_EMIS, emit_s=0.55)
M_TIRE = mkmat("ae86_tire", color=0x0C0C0F, metal=0.0, rough=0.92)
M_RIM = mkmat("ae86_rim", color=RIMC, metal=0.62, rough=0.30, coat=0.45, coat_r=0.06)
M_GOLD = mkmat("ae86_gold", color=GOLD, metal=0.85, rough=0.28, coat=0.5, coat_r=0.06)
M_DISC = mkmat("ae86_disc", color=DISC, metal=0.85, rough=0.38)
M_DARK = mkmat("ae86_dark", color=0x101216, metal=0.2, rough=0.55)

shell.data.materials.clear()
shell.data.materials.append(M_BODY)
for p in me.polygons:
    p.material_index = 0
me.update()


# ------------------------------------------------------------------ 6. 轮组重建
def bm_obj(name, bm, mat):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new(name, mesh)
    scn.collection.objects.link(o)
    mesh.materials.append(mat)
    return o


AXIS_X = Matrix(((0, 0, 1, 0), (0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 0, 1)))


def cyl(name, r, depth, x, mat, segs=30):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r, radius2=r, depth=depth, matrix=AXIS_X)
    bm.transform(Matrix.Translation(Vector((x, 0, 0))))
    return bm_obj(name, bm, mat)


def box(name, sx, sy, sz, loc, rot, mat):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    mtx = (Matrix.Translation(Vector(loc)) @ Euler(rot, "XYZ").to_matrix().to_4x4()
           @ Matrix.Diagonal(Vector((sx, sy, sz, 1.0))))
    bm.transform(mtx)
    return bm_obj(name, bm, mat)


def washer(name, r_out, r_in, thick, x, mat, segs=40):
    bm = bmesh.new()
    ang = [i * 2 * math.pi / segs for i in range(segs)]
    rings = []
    for xi, ri in ((x - thick / 2, r_in), (x - thick / 2, r_out),
                   (x + thick / 2, r_out), (x + thick / 2, r_in)):
        rings.append([bm.verts.new((xi, ri * math.sin(a), ri * math.cos(a))) for a in ang])
    bm.verts.ensure_lookup_table()
    for k in range(4):
        a, b = rings[k], rings[(k + 1) % 4]
        for i in range(segs):
            j = (i + 1) % segs
            try:
                bm.faces.new((a[i], a[j], b[j], b[i]))
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm_obj(name, bm, mat)


def build_wheel(key, w):
    obj = wheel_objs[key]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    drop = [f for f in bm.faces if f.material_index == OLD_RIM]
    hole_r = w["r"] * 0.66
    if drop:
        rr0 = 0.0
        for f in drop:
            c = f.calc_center_median()
            rr0 = max(rr0, math.hypot(c.y - w["y"], c.z - w["z"]))
        hole_r = max(hole_r, rr0)
        bmesh.ops.delete(bm, geom=drop, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.materials.clear()
    obj.data.materials.append(M_TIRE)
    for p in obj.data.polygons:
        p.material_index = 0

    outward = 1.0 if w["x"] > 0 else -1.0
    xf = w["half"] * 0.84
    rr = w["r"]
    rout = hole_r + 0.012
    parts = [
        cyl("backplate", hole_r - 0.004, 0.012, xf - 0.086, M_DARK, segs=36),
        washer("lip", rout, rout - 0.024, 0.014, xf, M_GOLD),
        washer("face", rout - 0.016, rr * 0.500, 0.010, xf - 0.007, M_RIM),
        cyl("barrel", rout - 0.010, 0.068, xf - 0.045, M_RIM, segs=36),
        cyl("hub", rr * 0.210, 0.028, xf - 0.026, M_RIM, segs=24),
        cyl("cap", rr * 0.082, 0.012, xf - 0.008, M_GOLD, segs=20),
        cyl("disc", rr * 0.470, 0.012, xf - 0.060, M_DISC, segs=32),
        cyl("discbell", rr * 0.190, 0.032, xf - 0.047, M_DISC, segs=20),
    ]
    for i in range(8):
        a = i * math.pi / 4
        ro = rr * 0.420
        parts.append(box("spoke%d" % i, 0.030, 0.020, rr * 0.455,
                         (xf - 0.020, ro * math.sin(a), ro * math.cos(a)), (a, 0, 0), M_RIM))
    a = math.radians(32)
    parts.append(box("caliper", 0.026, 0.050, rr * 0.300,
                     (xf - 0.048, rr * 0.44 * math.sin(a), rr * 0.44 * math.cos(a)), (a, 0, 0), M_GOLD))

    for p in parts:
        p.data.transform(Matrix.Diagonal(Vector((outward, 1, 1, 1))))
        p.data.transform(Matrix.Translation(Vector((w["x"], w["y"], w["z"]))))
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = "wheel_" + NAMES[key]
    obj.data.transform(Matrix.Translation(Vector((-w["x"], -w["y"], -w["z"]))))
    pivot = bpy.data.objects.new("wheel_%s_pivot" % NAMES[key], None)
    pivot.empty_display_size = 0.2
    scn.collection.objects.link(pivot)
    pivot.location = Vector((w["x"], w["y"], w["z"]))
    obj.location = Vector((0, 0, 0))
    obj.parent = pivot
    obj.matrix_parent_inverse = Matrix.Identity(4)
    return obj


# V10：保留原厂轮面几何（重建版在真车比例下会读成「黑色齿轮」），
# 只把材质换成钛银金属 + 深色胎壁，卡钳沿用原图里的红色。
for key in wheel_objs:
    o = wheel_objs[key]
    o.data.materials.clear()
    for m in (M_BODY, M_TIRE, M_RIM):
        o.data.materials.append(m)
    for p in o.data.polygons:
        if p.material_index <= 0:
            p.material_index = 0
        elif p.material_index == 1:
            p.material_index = 1
        else:
            p.material_index = 2
    pivot = bpy.data.objects.new("wheel_%s_pivot" % NAMES[key], None)
    pivot.empty_display_size = 0.2
    scn.collection.objects.link(pivot)
    w = WHEELS[key]
    pivot.location = Vector((w["x"], w["y"], w["z"]))
    o.data.transform(Matrix.Translation(Vector((-w["x"], -w["y"], -w["z"]))))
    o.location = Vector((0, 0, 0))
    o.parent = pivot
    o.matrix_parent_inverse = Matrix.Identity(4)
    # 香槟金轮唇
    sign = 1.0 if w["x"] > 0 else -1.0
    bpy.ops.mesh.primitive_torus_add(major_radius=w["r"] * 0.665, minor_radius=0.0062,
                                     major_segments=40, minor_segments=6,
                                     location=(0, 0, 0), rotation=(0, math.pi / 2, 0))
    lip = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    lip.data.materials.clear()
    lip.data.materials.append(M_GOLD)
    lip.data.transform(Matrix.Translation(Vector((w["x"] + sign * w["half"] * 0.90, w["y"], w["z"]))))
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    lip.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.join()

# ------------------------------------------------------------------ 7. 金色拖车钩（唯一的附加小件）
bpy.ops.mesh.primitive_torus_add(major_radius=0.026, minor_radius=0.007, major_segments=20,
                                 minor_segments=8, location=(0.52, LO[1] + 0.020, 0.150),
                                 rotation=(math.pi / 2, 0, 0))
hook = bpy.context.active_object
hook.name = "towhook"
hook.data.materials.clear()
hook.data.materials.append(M_GOLD)

bpy.ops.object.select_all(action="DESELECT")
shell.select_set(True)
hook.select_set(True)
bpy.context.view_layer.objects.active = shell
bpy.ops.object.join()
shell = bpy.context.active_object
shell.name = "frag_car_rare_01"

# ------------------------------------------------------------------ 8. 贴地对齐
allobj = [o for o in bpy.context.scene.objects if o.type == "MESH"]
minz = min(min((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in allobj)
R["ground_fix"] = round(-minz, 4)
if abs(minz) > 1e-4:
    for o in allobj:
        if o.parent:
            continue
        o.data.transform(Matrix.Translation(Vector((0, 0, -minz))))

bpy.context.view_layer.update()
R["final"] = {"objects": len(bpy.context.scene.objects),
              "faces": sum(len(o.data.polygons) for o in allobj),
              "verts": sum(len(o.data.vertices) for o in allobj)}
R["nodes"] = [o.name for o in bpy.context.scene.objects]

# ------------------------------------------------------------------ 9. 导出
if BLEND_OUT:
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=False,
    export_apply=True, export_yup=True, export_image_format="AUTO",
    export_normals=True, export_tangents=False, export_materials="EXPORT",
    export_animations=False, export_skins=False, export_cameras=False,
    export_lights=False, export_extras=False,
)
R["glb"] = {"path": OUT, "bytes": os.path.getsize(OUT)}
if REPORT:
    with open(REPORT, "w", encoding="utf-8") as fh:
        json.dump(R, fh, indent=1, ensure_ascii=False)
print("V11_DONE " + json.dumps({k: R[k] for k in ("wheels", "split", "ground_fix", "final", "glb")},
                              ensure_ascii=False))
