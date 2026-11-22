"""Build and rig the original Little Racing V4 spirit tiger in Blender."""
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

out=Path(sys.argv[sys.argv.index('--')+1])
out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.fps=30
scene.frame_start,scene.frame_end=1,46
scene.world=bpy.data.worlds.new('Preview World')
scene.world.color=(.16,.16,.16)

def xyz(p):
    return Vector((p[0],-p[1],p[2]))

def rgb(hexadecimal):
    vals=tuple(int(hexadecimal[i:i+2],16)/255 for i in (0,2,4))
    return tuple(v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4 for v in vals)

def smooth(a,b,v):
    q=np.clip((v-a)/(b-a),0,1)
    return q*q*(3-2*q)

def blend(a,b,t):
    return np.asarray(a)*(1-t[...,None])+np.asarray(b)*t[...,None]

resolution=512
N=resolution//2
t,u=np.meshgrid(np.linspace(0,1,N),np.linspace(0,1,N))
theta=u*2*np.pi
skin=np.zeros((resolution,resolution,4),dtype=np.float32)
skin[:,:,3]=1
for tile in range(4):
    belly=smooth(.34,.92,-np.sin(theta)) if tile<2 else smooth(.55,1,-np.sin(theta))*.58
    coat=blend(rgb('e68a0c'),rgb('ffd15b'),.47+.29*np.sin(theta)+.12*np.cos(t*8))
    coat=blend(coat,rgb('fff1bc'),belly)
    band=np.zeros_like(t)
    count=(8,6,5,9)[tile]
    offset=.025*np.cos(theta*3)+.036*np.cos(theta*(4 if tile==1 else 2)+t*17)
    for i in range(count):
        tip=((1+np.cos(theta+(i%3-1)*.67))*0.5)
        center=(i+.69)/(count+.65)+offset*(1 if i%2==0 else -.75)
        width=(.046 if tile==1 else .039)*(1-.52*tip)
        stripe=1-smooth(width*.74,width,np.abs(t-center))
        stripe*=1-smooth(.57,.99,belly)*(.80 if tile==0 else .4)
        band=np.maximum(band,stripe)
    coat=blend(coat,rgb('66310e') if tile!=1 else rgb('63320c'),band*.91)
    grain=(np.sin(t*729+theta*67)*np.sin(t*383-theta*141))*.014
    coat=np.clip(coat+grain[...,None],0,1)
    x,y=(tile%2)*N,(tile//2)*N
    skin[y:y+N,x:x+N,:3]=coat
image=bpy.data.images.new('Tiger Coat - Original hand-authored stripe atlas',width=resolution,height=resolution,alpha=False)
image.colorspace_settings.name='sRGB'
image.pixels.foreach_set(skin.ravel())
image.filepath_raw=str(out/'tiger-coat.png')
image.file_format='PNG'; image.save(); image.pack()

def material(name,color,roughness=.36,emit=.15):
    m=bpy.data.materials.new(name)
    m.diffuse_color=(*rgb(color),1)
    m.use_nodes=True
    n=m.node_tree.nodes.get('Principled BSDF')
    n.inputs['Base Color'].default_value=m.diffuse_color
    n.inputs['Emission Color'].default_value=m.diffuse_color
    n.inputs['Emission Strength'].default_value=emit
    n.inputs['Roughness'].default_value=roughness
    n.inputs['Metallic'].default_value=.12
    return m

coat=material('01 Striped Gold','eda72a',.38,.28)
tex=coat.node_tree.nodes.new('ShaderNodeTexImage')
tex.image=image;tex.label='Embedded original tiger coat';coat.node_tree.nodes.active=tex
coat.node_tree.links.new(tex.outputs['Color'],coat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
coat.node_tree.links.new(tex.outputs['Color'],coat.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'])
ivory=material('02 Pale muzzle and inner legs','fff0b5',.40,.28)
bronze=material('03 Dark bronze markings','642724',.40,.08)
nose=material('04 Ember nose and mouth','782719',.48,.07)
eyes=material('05 Gold-lit eyes','fff89c',.27,.85)
ear=material('06 Copper inner ear','e98a43',.49,.15)

bones={
 'Root':((0,0,0),(0,-1,0),None),
 'Pelvis':((0,-.77,1.16),(0,-.31,1.21),'Root'),
 'Spine':((0,-.31,1.21),(0,.33,1.26),'Pelvis'),
 'Chest':((0,.33,1.26),(0,.78,1.34),'Spine'),
 'Neck':((0,.78,1.34),(0,1.14,1.48),'Chest'),
 'Head':((0,1.14,1.48),(0,1.53,1.52),'Neck'),
 'Jaw':((0,1.28,1.36),(0,1.76,1.26),'Head'),
 'TailA':((0,-1.04,1.22),(0,-1.51,1.18),'Pelvis'),
 'TailB':((0,-1.51,1.18),(0,-1.98,1.29),'TailA'),
 'TailC':((0,-1.98,1.29),(.05,-2.41,1.47),'TailB'),
}
limbs={}
for side,x in [('L',.285),('R',-.285)]:
    for family,points,parent in (
        ('Fore',[(x,.66,1.28),(x*1.06,.49,.77),(x*1.05,.67,.29),(x*1.06,.82,.16)],'Chest'),
        ('Hind',[(x,-.76,1.22),(x*1.12,-.53,.80),(x*1.08,-.93,.40),(x*1.10,-.76,.18)],'Pelvis'),
    ):
        tag=f'{family}.{side}'
        names=[f'{tag}.{part}' for part in ('Upper','Lower','Paw')]
        limbs[tag]=(names,points)
        for i,name in enumerate(names):
            bones[name]=(points[i],points[i+1],parent if i==0 else names[i-1])

arm=bpy.data.armatures.new('Quadruped Rig')
rig=bpy.data.objects.new('Spirit Tiger - Quadruped',arm)
scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig
rig.show_in_front=True
bpy.ops.object.mode_set(mode='EDIT')
for name,(head,tail,parent) in bones.items():
    bone=arm.edit_bones.new(name);bone.head=xyz(head);bone.tail=xyz(tail)
    if parent:
        bone.parent=arm.edit_bones[parent]
        bone.use_connect=(bone.parent.tail-bone.head).length<1e-6
    bone.use_deform=name!='Root'
bpy.ops.object.mode_set(mode='OBJECT')
for bone in rig.pose.bones:bone.rotation_mode='XYZ'
parts=[]

def rings_part(name,rows,sides,mat,tile=0):
    vertices=[];groups={}; faces=[];uvs=[]
    centers=[xyz(row[0]) for row in rows]
    for ri,(center,row) in enumerate(zip(centers,rows)):
        _,rx,rz,weights=row
        tangent=(centers[min(len(rows)-1,ri+1)]-centers[max(0,ri-1)]).normalized()
        side=(Vector((1,0,0))-tangent*tangent.x).normalized()
        up=tangent.cross(side).normalized()
        for q in range(sides):
            a=q*math.tau/sides
            vertices.append(center+side*math.cos(a)*rx+up*math.sin(a)*rz)
            for bone,weight in weights.items():
                if weight>0:groups.setdefault(bone,[]).append((len(vertices)-1,weight))
    def uv(ri,a):
        return ((tile%2+.012+.976*ri/(len(rows)-1))*.5,(tile//2+.012+.976*a/sides)*.5)
    for ri in range(len(rows)-1):
        for q in range(sides):
            a=ri*sides+q;b=ri*sides+(q+1)%sides
            faces.append((a,b,b+sides,a+sides))
            uvs.append((uv(ri,q),uv(ri,q+1),uv(ri+1,q+1),uv(ri+1,q)))
    faces.extend([list(reversed(range(sides))),list(range((len(rows)-1)*sides,len(rows)*sides))])
    uvs.extend([[uv(0,q) for q in reversed(range(sides))],[uv(len(rows)-1,q) for q in range(sides)]])
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(vertices,[],faces);mesh.update()
    layer=mesh.uv_layers.new(name='Coat UV')
    for poly,face_uv in zip(mesh.polygons,uvs):
        poly.use_smooth=True
        for loop,st in zip(poly.loop_indices,face_uv):layer.data[loop].uv=st
    obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj);mesh.materials.append(mat)
    for bone,assignments in groups.items():
        group=obj.vertex_groups.new(name=bone)
        for index,weight in assignments:group.add([index],weight,'REPLACE')
    parts.append(obj)
    return obj

def rows_on_axis(name,profile,bone,material,tile=0,sides=20):
    rows=[(p,a,b,{bone:1}) for p,a,b in profile]
    return rings_part(name,rows,sides,material,tile)

def ellipsoid(name,p,dims,bone,mat,sides=12,steps=7,tilt=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=sides,ring_count=steps,location=xyz(p))
    obj=bpy.context.object;obj.name=name; obj.scale=dims;obj.rotation_euler.x=tilt
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    for poly in obj.data.polygons:poly.use_smooth=True
    obj.data.materials.append(mat)
    obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))),1,'REPLACE')
    parts.append(obj)
    return obj

trunk=[
 (-1.12,1.15,.105,.13,{'Pelvis':1}),(-1.02,1.16,.256,.28,{'Pelvis':1}),
 (-.87,1.19,.355,.365,{'Pelvis':1}),(-.64,1.20,.368,.375,{'Pelvis':.88,'Spine':.12}),
 (-.39,1.22,.333,.324,{'Pelvis':.50,'Spine':.50}),(-.16,1.25,.293,.275,{'Spine':1}),
 (.05,1.26,.305,.287,{'Spine':.80,'Chest':.20}),(.27,1.28,.343,.341,{'Spine':.48,'Chest':.52}),
 (.52,1.29,.401,.403,{'Chest':1}),(.70,1.29,.397,.411,{'Chest':.91,'Neck':.09}),
 (.86,1.35,.357,.350,{'Chest':.60,'Neck':.40}),(.99,1.43,.295,.295,{'Neck':1}),
 (1.16,1.49,.211,.207,{'Neck':.65,'Head':.35}),(1.27,1.51,.133,.156,{'Head':1})]
rings_part('Continuous torso and neck',[((0,y,z),a,b,w) for y,z,a,b,w in trunk],24,coat)
rows_on_axis('Sculpted head and bridge',[
 ((0,.99,1.53),.17,.18),((0,1.09,1.55),.32,.282),((0,1.22,1.57),.365,.302),
 ((0,1.38,1.57),.347,.295),((0,1.53,1.53),.306,.23),((0,1.66,1.48),.236,.162),
 ((0,1.765,1.465),.154,.10),((0,1.79,1.465),.08,.053)],'Head',coat,1,22)
rows_on_axis('Lower jaw',[
 ((0,1.24,1.34),.115,.105),((0,1.41,1.28),.228,.096),((0,1.66,1.25),.169,.069),
 ((0,1.80,1.27),.105,.052),((0,1.82,1.27),.055,.030)],'Jaw',ivory,0,16)
ellipsoid('Broad nose',(0,1.805,1.47),(.144,.054,.056),'Head',nose,14,9)
ellipsoid('Mouth interior',(0,1.57,1.297),(.143,.195,.034),'Jaw',nose)
for s in [-1,1]:
    ellipsoid('Cheek patch',(s*.255,1.455,1.383),(.131,.166,.108),'Head',ivory,14,8)
    ellipsoid('Muzzle pad',(s*.117,1.728,1.420),(.143,.125,.084),'Head',ivory,14,8)
    ellipsoid('Eye surround',(s*.259,1.595,1.592),(.075,.052,.044),'Head',bronze)
    ellipsoid('Eye gold',(s*.286,1.620,1.593),(.050,.036,.030),'Head',eyes)
    ellipsoid('Eye pupil',(s*.306,1.639,1.593),(.021,.017,.022),'Head',bronze,10,6)
    ellipsoid('Expressive brow',(s*.252,1.574,1.648),(.084,.060,.025),'Head',bronze)
    ellipsoid('Round tiger ear',(s*.252,1.164,1.828),(.160,.078,.144),'Head',bronze,14,8)
    ellipsoid('Ear inner gold',(s*.253,1.216,1.835),(.106,.037,.093),'Head',ear,12,8)
    ellipsoid('Small fang',(s*.146,1.741,1.371),(.023,.035,.052),'Head',ivory,10,6)
    for j in range(3):
        ellipsoid('Whisker follicle',(s*(.16+j*.026),1.793-j*.013,1.439-j*.013),(.009,.009,.009),'Head',bronze,6,4)

for tag,(names,points) in limbs.items():
    a,b,c,d=[Vector(p) for p in points]
    hind=tag.startswith('Hind')
    def mix(i,j,t):return {names[i]:1-t,names[j]:t}
    leg=[
        (a+Vector((0,0,.10)),.091,.134,{names[0]:1}),
        (a,.17 if hind else .151,.24 if hind else .19,{names[0]:1}),
        (a.lerp(b,.44),.162 if hind else .143,.192 if hind else .153,{names[0]:1}),
        (a.lerp(b,.82),.120,.131,mix(0,1,.20)),
        (b,.112,.119,mix(0,1,.51)),
        (b.lerp(c,.30),.098,.104,mix(0,1,.87)),
        (b.lerp(c,.64),.076,.083,{names[1]:1}),
        (b.lerp(c,.89),.068,.080,mix(1,2,.18)),
        (c,.076,.088,mix(1,2,.60)),
        (c.lerp(d,.51),.111,.099,{names[2]:1}),
        (d,.122,.071,{names[2]:1}),
        (d+Vector((0,.10,.013)),.085,.053,{names[2]:1}),
        (d+Vector((0,.15,.024)),.049,.035,{names[2]:1}),
    ]
    rings_part(tag+' anatomical leg',leg,14,coat,2)
    for offset in [-.060,0,.060]:
        ellipsoid('Toe tip',(d.x+offset,d.y+.108,d.z-.015),(.039,.059,.039),names[2],ivory,8,5)

tail=[
 ((0,-1.02,1.23),.122,.118,{'TailA':1}),((0,-1.25,1.20),.106,.096,{'TailA':1}),
 ((0,-1.49,1.18),.089,.085,{'TailA':.60,'TailB':.40}),
 ((0,-1.72,1.21),.075,.070,{'TailB':1}),((.015,-1.98,1.29),.059,.057,{'TailB':.50,'TailC':.50}),
 ((.036,-2.18,1.37),.049,.050,{'TailC':1}),((.06,-2.37,1.46),.039,.040,{'TailC':1}),
 ((.073,-2.48,1.52),.020,.022,{'TailC':1})]
rings_part('Flexible striped tail',tail,14,coat,3)

bpy.ops.object.select_all(action='DESELECT')
for obj in parts:obj.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.join()
tiger=bpy.context.object;tiger.name='Spirit Tiger - Skinned Coat'
tiger.parent=rig
mod=tiger.modifiers.new('Quadruped skin','ARMATURE');mod.object=rig
mod.use_deform_preserve_volume=True
# Merge duplicated material slots introduced when modeling separate parts.
slots=list(dict.fromkeys(tiger.data.materials))
assignment=[slots.index(tiger.data.materials[p.material_index]) for p in tiger.data.polygons]
tiger.data.materials.clear()
for slot in slots:tiger.data.materials.append(slot)
for poly,i in zip(tiger.data.polygons,assignment):poly.material_index=i

# Angles are local anatomical joint rotations in degrees. Forelimbs travel in staggered pairs.
poses=[
 (1,-.06,8,-10,10,-6,  (30,-47,26),(23,-39,21), (-22,35,-14),(-17,31,-11), 0,4),
 (6,-.19,16,-18,15,-8, (45,-62,31),(39,-53,28),(-36,56,-25),(-27,45,-23), 8,4),
 (10,-.02,-3,0,8,-9,  (-34,33,-13),(41,-39,17),(22,-38,25),(-44,52,-32), 3,11),
 (14,.045,-6,3,7,-7,  (35,-47,24),(-43,27,-3),(-19,34,-10),(30,-40,28), -8,14),
 (18,.20,-12,8,-1,-3, (-45,36,-13),(-28,47,-11),(37,-19,-16),(44,-24,-21), -6,22),
 (21,.41,-11,13,-6,7, (-66,19,-6),(-60,27,-8),(44,-26,-19),(31,-26,-20), 1,32),
 (25,.51,-4,7,-1,6, (-74,4,-2),(-65,8,-5),(36,-25,-17),(25,-22,-27), 10,30),
 (30,.34,3,-1,6,8, (-47,4,16),(-41,12,7),(17,-31,8),(26,-34,-6), 14,23),
 (35,.065,12,-8,4,4, (-22,15,-4),(-30,21,5),(2,-8,0),(13,-26,14), 6,15),
 (40,-.045,9,-10,7,-3, (15,-24,7),(-30,23,-8),(-15,17,-5),(15,-23,13), -4,6),
 (46,0,0,0,0,0, (0,0,0),(0,0,0),(0,0,0),(0,0,0), 0,2),
]
rad=math.radians
for frame,height,pelvis,spine,chest,head,fl,fr,hl,hr,tail_wave,jaw in poses:
    pb=rig.pose.bones
    pb['Root'].location.z=height
    pb['Root'].keyframe_insert('location',frame=frame,group='Root jump arc')
    for name,angles in {
        'Pelvis':(pelvis,0,0),'Spine':(spine,0,0),'Chest':(chest,0,0),'Neck':(-chest*.54,0,0),
        'Head':(head,0,4),'Jaw':(jaw,0,0),'TailA':(-12-tail_wave,4,0),
        'TailB':(tail_wave*.8,-7,8),'TailC':(13+tail_wave*.65,3,-10),
    }.items():
        pb[name].rotation_euler=[rad(a) for a in angles]
        pb[name].keyframe_insert('rotation_euler',frame=frame,group=name)
    for tag,values in [('Fore.L',fl),('Fore.R',fr),('Hind.L',hl),('Hind.R',hr)]:
        for name,angle in zip(limbs[tag][0],values):
            pb[name].rotation_euler.x=rad(angle)
            pb[name].keyframe_insert('rotation_euler',frame=frame,group=tag)

action=rig.animation_data.action
action.name='SpiritPounce';action.use_fake_user=True
for label,frame in [('Gather',1),('Stride',10),('Takeoff',18),('Extend claws',25),('Dissolve',31)]:
    scene.timeline_markers.new(label,frame=frame)

bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True);tiger.select_set(True)
bpy.context.view_layer.objects.active=rig
scene.frame_set(1)
bpy.ops.export_scene.gltf(filepath=str(out/'spirit-tiger.glb'),export_format='GLB',
    use_selection=True,export_yup=True,export_animations=True,export_frame_range=True,
    export_animation_mode='ACTIONS',export_image_format='AUTO')
scene.frame_set(25)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'spirit-tiger.blend'))
print('ART:',len(arm.bones),'bones',len(tiger.data.vertices),'vertices',len(tiger.data.polygons),'polygons',len(slots),'materials')

