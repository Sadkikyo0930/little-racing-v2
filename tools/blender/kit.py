"""
几何工具库 —— 纯 Python 顶点/面构建，不依赖 bmesh。

为什么要自己写而不 bpy.ops.mesh.primitive_*：
  · 每个道具是「一个小场景里几十个零件」，用 ops 需要建几十个临时对象再
    join，慢且容易在 background 模式下因为上下文不对而失败；
  · 我们要精确控制每个面的材质槽、平滑/硬边、UV 投影方式；
  · 顶点数可控 —— 目标是 iPhone，每个资产的面数必须能算出来。

坐标：Blender Z-up，单位米。导出 GLB 时由导出器转成 Y-up。
"""

import math
import random
from mathutils import Matrix, Vector

TAU = math.pi * 2


# --------------------------------------------------------------------------- #
# 网格累加器
# --------------------------------------------------------------------------- #
class Mesh:
    """顶点 + 多边形 + 每面材质槽 + 每面平滑标记 + 每面 UV 缩放。"""

    def __init__(self, name):
        self.name = name
        self.v = []            # [(x,y,z)]
        self.f = []            # [(i0,i1,i2[,i3])]
        self.fm = []           # 每面材质槽
        self.fs = []           # 每面 smooth 标记
        self.fu = []           # 每面 UV 缩放（米 → UV），None 表示不铺 UV

    # -- 底层 ---------------------------------------------------------------
    def vert(self, p):
        self.v.append((p[0], p[1], p[2]))
        return len(self.v) - 1

    def face(self, idx, mat=0, smooth=False, uv=1.0):
        self.f.append(tuple(idx))
        self.fm.append(mat)
        self.fs.append(smooth)
        self.fu.append(uv)

    def stats(self):
        tris = sum(len(f) - 2 for f in self.f)
        return len(self.v), tris

    # -- 变换 ---------------------------------------------------------------
    def transform(self, mat, start=0):
        for i in range(start, len(self.v)):
            x, y, z = self.v[i]
            p = mat @ Vector((x, y, z))
            self.v[i] = (p.x, p.y, p.z)

    def translate(self, dx, dy, dz):
        self.transform(Matrix.Translation((dx, dy, dz)))

    # -- 图元 ---------------------------------------------------------------
    def box(self, center, size, mat=0, rot=None, uv=1.0, smooth=False):
        """轴对齐长方体，可选绕自身中心的欧拉旋转。"""
        cx, cy, cz = center
        sx, sy, sz = (size[0] / 2, size[1] / 2, size[2] / 2)
        base = len(self.v)
        corners = [
            (-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
            (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz),
        ]
        if rot is not None:
            R = Matrix.Rotation(rot[2], 3, 'Z') @ Matrix.Rotation(rot[1], 3, 'Y') @ Matrix.Rotation(rot[0], 3, 'X')
            corners = [tuple(R @ Vector(c)) for c in corners]
        for c in corners:
            self.vert((cx + c[0], cy + c[1], cz + c[2]))
        quads = [
            (0, 3, 2, 1), (4, 5, 6, 7),      # -Z, +Z
            (0, 1, 5, 4), (1, 2, 6, 5),      # -Y, +X
            (2, 3, 7, 6), (3, 0, 4, 7),      # +Y, -X
        ]
        for q in quads:
            self.face([base + i for i in q], mat, smooth, uv)

    def cyl(self, base_center, radius, height, sides=8, mat=0, r_top=None,
            axis='Z', cap=True, uv=1.0, smooth=True, rot=None, phase=0.0):
        """棱柱 / 圆柱。base_center 是底面中心，沿 +Z 生长（axis 可改）。"""
        r_top = radius if r_top is None else r_top
        bx, by, bz = base_center
        base = len(self.v)
        for ring in range(2):
            r = radius if ring == 0 else r_top
            z = 0 if ring == 0 else height
            for k in range(sides):
                a = phase + TAU * k / sides
                self.vert((math.cos(a) * r, math.sin(a) * r, z))
        for k in range(sides):
            k2 = (k + 1) % sides
            self.face([base + k, base + k2, base + sides + k2, base + sides + k], mat, smooth, uv)
        if cap:
            # 用扇形三角剖分避免 n-gon 在导出时被随意三角化
            c0 = len(self.v)
            self.vert((0, 0, 0))
            c1 = len(self.v)
            self.vert((0, 0, height))
            for k in range(sides):
                k2 = (k + 1) % sides
                self.face([c0, base + k2, base + k], mat, False, uv)
                self.face([c1, base + sides + k, base + sides + k2], mat, False, uv)
        # 变换
        M = Matrix.Translation((bx, by, bz))
        if axis == 'X':
            M = M @ Matrix.Rotation(math.radians(90), 4, 'Y')
        elif axis == 'Y':
            M = M @ Matrix.Rotation(math.radians(-90), 4, 'X')
        if rot is not None:
            M = M @ (Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y')
                     @ Matrix.Rotation(rot[0], 4, 'X'))
        self.transform(M, base)

    def sphere(self, center, radius, subdiv=2, mat=0, scale=(1, 1, 1),
               jitter=None, uv=1.0, smooth=True, seed=0):
        """八面体递归细分球。subdiv=0 → 8 面，1 → 32，2 → 128，3 → 512。"""
        verts = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
        faces = [
            (0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4),
            (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5),
        ]
        for _ in range(subdiv):
            mid = {}
            nf = []

            def m(a, b):
                key = (a, b) if a < b else (b, a)
                if key in mid:
                    return mid[key]
                va, vb = Vector(verts[a]), Vector(verts[b])
                p = (va + vb).normalized()
                verts.append(tuple(p))
                mid[key] = len(verts) - 1
                return mid[key]

            for a, b, c in faces:
                ab, bc, ca = m(a, b), m(b, c), m(c, a)
                nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
            faces = nf

        rnd = random.Random(seed)
        base = len(self.v)
        for p in verts:
            q = Vector(p).normalized()
            k = 1.0
            if jitter is not None:
                k = 1.0 + (rnd.random() - 0.5) * 2 * jitter
            self.vert((center[0] + q.x * radius * scale[0] * k,
                       center[1] + q.y * radius * scale[1] * k,
                       center[2] + q.z * radius * scale[2] * k))
        for a, b, c in faces:
            self.face([base + a, base + b, base + c], mat, smooth, uv)

    def quad_strip(self, rows, mat=0, uv=1.0, smooth=True, close=False):
        """rows: [[(x,y,z), ...同列数...], ...] 沿行连接成带子。"""
        base = len(self.v)
        cols = len(rows[0])
        for row in rows:
            for p in row:
                self.vert(p)
        rn = len(rows)
        for r in range(rn - 1 if not close else rn):
            r2 = (r + 1) % rn
            for c in range(cols - 1):
                a = base + r * cols + c
                b = a + 1
                cc = base + r2 * cols + c
                d = cc + 1
                self.face([a, cc, b, b, cc, d], mat, smooth, uv)

    def mesh_merge(self, other, dx=0.0, dy=0.0, dz=0.0, rotate_z=0.0, scale=1.0):
        """把另一个 Mesh 合并进来（可平移/旋转/缩放），材质槽保持不变。"""
        base = len(self.v)
        R = Matrix.Rotation(rotate_z, 3, 'Z')
        for x, y, z in other.v:
            p = R @ Vector((x * scale, y * scale, z * scale))
            self.vert((p.x + dx, p.y + dy, p.z + dz))
        for i, f in enumerate(other.f):
            self.face([base + j for j in f], other.fm[i], other.fs[i], other.fu[i])

    def mirrored_x(self):
        """X 轴镜像副本（绕序翻回来，保持法线朝外）。"""
        m = Mesh(self.name + '_mx')
        m.v = [(-x, y, z) for (x, y, z) in self.v]
        m.f = [tuple(reversed(f)) for f in self.f]
        m.fm = list(self.fm)
        m.fs = list(self.fs)
        m.fu = list(self.fu)
        return m


# --------------------------------------------------------------------------- #
# Blender 对象装配
# --------------------------------------------------------------------------- #
def build_object(mesh, materials, obj_name=None):
    """
    Mesh → bpy 对象。materials 是材质名列表（顺序 = 材质槽）。

    UV 用「按面法线选主轴做平面投影」，相当于烘死的三平面映射：
    盒状道具不会拉伸，圆形道具也不会出现极点挤压。斜面的 UV 方向
    精度略差，但这些资产都是低模硬表面，肉眼看不出。
    """
    import bpy

    me = bpy.data.meshes.new(obj_name or mesh.name)
    me.from_pydata(mesh.v, [], list(mesh.f))
    me.validate(verbose=False)
    me.update()

    # 材质槽
    for name in materials:
        mat = bpy.data.materials.get(name)
        if mat is None:
            raise RuntimeError('material %r not defined' % name)
        me.materials.append(mat)

    # 材质下标 / 平滑
    for i, poly in enumerate(me.polygons):
        poly.material_index = mesh.fm[i] if i < len(mesh.fm) else 0
        poly.use_smooth = mesh.fs[i] if i < len(mesh.fs) else False
    me.update()

    # UV：每面单独铺，按主法线轴选投影平面
    uv = me.uv_layers.new(name='UVMap')
    vcount = len(me.vertices)
    co = [v.co for v in me.vertices]
    for poly in me.polygons:
        n = poly.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        s = mesh.fu[poly.index] if poly.index < len(mesh.fu) and mesh.fu[poly.index] else 1.0
        for li in poly.loop_indices:
            c = co[me.loops[li].vertex_index]
            if az >= ax and az >= ay:
                u, vv = c.x, c.y
            elif ax >= ay:
                u, vv = c.y, c.z
            else:
                u, vv = c.x, c.z
            uv.data[li].uv = (u * s, vv * s)

    obj = bpy.data.objects.new(obj_name or mesh.name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def make_material(name, color, roughness=0.85, metallic=0.0, alpha=1.0, emission=0.0):
    """
    简洁 PBR 材质。GLB 只导出 baseColor / roughness / metallic，
    真正的贴图在游戏端按材质名挂（见 src/world/beachMats.js）——
    这样 GLB 体积只有几何，没有几百 KB 的贴图。
    """
    import bpy

    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    r, g, b = color
    bsdf.inputs['Base Color'].default_value = (r, g, b, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if 'Alpha' in bsdf.inputs:
        bsdf.inputs['Alpha'].default_value = alpha
    if emission > 0:
        for key in ('Emission Color', 'Emission'):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (r, g, b, 1.0)
                break
        if 'Emission Strength' in bsdf.inputs:
            bsdf.inputs['Emission Strength'].default_value = emission
    if alpha < 1.0:
        mat.blend_method = 'BLEND'
    mat.diffuse_color = (r, g, b, alpha)
    return mat


def reset_scene():
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0


def export_glb(obj, path, extra=None):
    import bpy
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    kw = dict(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
    )
    if extra:
        kw.update(extra)
    bpy.ops.export_scene.gltf(**kw)


# --------------------------------------------------------------------------- #
# 造型小工具
# --------------------------------------------------------------------------- #
def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def beam(m, p0, p1, w, h, mat=0, uv=1.0, up=(0, 0, 1)):
    """
    两点之间的方梁（栏杆、椽子、斜撑都用它）。给定起止点和截面尺寸，
    自动算朝向，比手工摆 box 可靠。
    """
    a, b = Vector(p0), Vector(p1)
    d = b - a
    L = d.length
    if L < 1e-6:
        return
    z = d.normalized()
    upv = Vector(up)
    if abs(z.dot(upv)) > 0.98:
        upv = Vector((1, 0, 0))
    x = z.cross(upv).normalized()
    y = x.cross(z).normalized()
    base = len(m.v)
    for sz in (-0.5, 0.5):
        for sy, sx in ((-0.5, -0.5), (-0.5, 0.5), (0.5, 0.5), (0.5, -0.5)):
            p = a + z * (L * (sz + 0.5)) + x * (sx * w) + y * (sy * h)
            m.vert((p.x, p.y, p.z))
    for q in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 3, 7, 4), (1, 5, 6, 2),
              (3, 2, 6, 7), (0, 4, 5, 1)):
        m.face([base + i for i in q], mat, False, uv)
