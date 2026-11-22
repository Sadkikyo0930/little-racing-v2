"""Author V4 flow maps, flipbook discharge, and two editable Effekseer projects."""
import math
import struct
import sys
import zlib
from pathlib import Path
import xml.etree.ElementTree as XML

import numpy as np

out=Path(sys.argv[1])
tex=out/'tex'
tex.mkdir(parents=True,exist_ok=True)
rng=np.random.default_rng(44117)

def png(path,pixels):
    array=np.uint8(np.clip(pixels,0,1)*255+.5)
    h,w,n=array.shape
    def chunk(tag,data):
        return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
    scan=b''.join(b'\x00'+row.tobytes() for row in array)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+
                     chunk(b'IDAT',zlib.compress(scan,9))+chunk(b'IEND',b''))

def ss(a,b,v):
    p=np.clip((v-a)/(b-a),0,1)
    return p*p*(3-2*p)

u,v=np.meshgrid(np.arange(512)/512,np.arange(128)/128)
phase=u*math.tau
section=v*math.tau
def band(angle,power):
    return (.5+.5*np.cos(angle))**power

# Flow maps are intentionally different. Gold has braided irregular flames.
# Thunder has an axial shock-cell row with curved pressure boundaries.
ripple=np.sin(phase*3+section*2)*.58+np.sin(section*3-phase)*.21
gold_fibers=np.maximum(band(phase*7+section*5+ripple,4),
                       .65*band(phase*4-section*9+ripple*1.7,10))
gold_grad=.40+.60*band(phase*2+section*3+np.sin(phase+section)*.9,2)
gold_edge=.27+.73*band(section*5+phase*4+np.sin(phase*3)*1.11,3)
throat=.54+.46*band(section*6+phase*2.0,3)
mach=band(phase*5+np.cos(section*4)*1.06,10)
strands=band(section*7+np.sin(phase*2)*.35,5)
pak=np.stack([gold_fibers,gold_grad,gold_edge,throat],axis=-1)
png(tex/'gold-flow.png',pak)
pak=np.stack([mach,strands,.27+.73*band(phase*5-section*3,6),throat],axis=-1)
png(tex/'thunder-flow.png',pak)

def line(canvas,points,size,intensity):
    y,x=np.mgrid[0:canvas.shape[0],0:canvas.shape[1]]
    for (a,b),(c,d) in zip(points,points[1:]):
        seg=(c-a)**2+(d-b)**2
        t=np.clip(((x-a)*(c-a)+(y-b)*(d-b))/max(.01,seg),0,1)
        dist=np.hypot(x-a-t*(c-a),y-b-t*(d-b))
        canvas[:]=np.maximum(canvas,(1-ss(size*.50,size+1.15,dist))*intensity)

w,h=128,96
sheet=np.zeros((4*h,4*w,4))
for frame in range(16):
    local=np.zeros((h,w))
    xs=np.linspace(4,122,12)
    ys=49+np.sin(xs*.074+frame*.26)*11+rng.uniform(-8,8,size=12)
    ys[0]=h/2
    main=list(zip(xs,ys))
    line(local,main,2.0,1)
    for n,direction in [(2,-1),(4,1),(7,-1),(8,1)]:
        ax,ay=main[n]
        offsets=rng.uniform(3,10,size=3)
        fork=[(ax,ay),(ax+9,ay+direction*(10+offsets[0])),
                         (ax+19,ay+direction*(17+offsets[1])),
                         (min(w-3,ax+34),ay+direction*(22+offsets[2]))]
        line(local,fork,1.25,.86)
        if n in (2,7):
            ax,ay=fork[2];line(local,[(ax,ay),(ax+5,ay-direction*4),(ax+14,ay+direction*2)],.64,.68)
    colors=np.zeros((h,w,4));colors[:,:,:3]=(1,1,1);colors[:,:,3]=local
    x,y=(frame%4)*w,(frame//4)*h
    sheet[y:y+h,x:x+w]=colors
png(tex/'electric-forks.png',sheet)
png(tex/'electric-card.png',sheet[:h,:w])

y,x=np.mgrid[0:48,0:128]
mid=26+np.sin(x/32)*1.7
r=np.abs(y-mid)
tail=np.clip(x/128,0,1)
taper=(1-ss(.62,1,tail))*(.58+.42*ss(0,.19,tail))
alpha=(1-ss(1.2,6.4*taper+1.4,r))*(1-ss(.75,1,tail))*ss(0,.10,tail)
spark=np.zeros((48,128,4));spark[:,:,:3]=(1,.81,.33);spark[:,:,3]=alpha
spark[:,:,:3]+=((1-ss(.4,2.8,r))*alpha)[...,None]*np.array([0,.19,.60])
png(tex/'cinder.png',spark)

def child(parent,tag,value=None):
    obj=XML.SubElement(parent,tag)
    if value is not None:obj.text=str(value)
    return obj
def span(parent,tag,low,high=None):
    high=low if high is None else high
    node=child(parent,tag)
    child(node,'Center',(low+high)/2);child(node,'Min',low);child(node,'Max',high)
    return node
def vector(parent,tag,axes):
    node=child(parent,tag)
    for k,values in zip('XYZ',axes):span(node,k,*values)
    return node
def pva(parent,section,values):
    node=child(parent,section);child(node,'Type',1)
    return child(node,'PVA')

def emitter(parent,name,texture,color,count,life,period,velocity,size,delay=0,spread=.12):
    node=child(parent,'Node');child(node,'Name',name)
    common=child(node,'CommonValues')
    child(child(common,'MaxGeneration'),'Value',count)
    span(common,'Life',*life);span(common,'GenerationTime',period)
    if delay:span(common,'GenerationTimeOffset',delay)
    location=pva(node,'LocationValues',None)
    vector(location,'Location',((-spread,spread),(-.03,spread),(-.05,.12)))
    vector(location,'Velocity',velocity)
    vector(location,'Acceleration',((0,),(0,),(.001,)))
    rotate=pva(node,'RotationValues',None)
    vector(rotate,'Rotation',((0,),(0,),(-35,35)))
    vector(rotate,'Velocity',((0,),(0,),(-1.8,1.8)))
    scale=pva(node,'ScalingValues',None)
    vector(scale,'Scale',size)
    material=child(node,'RendererCommonValues')
    child(material,'ColorTexture',texture);child(material,'AlphaBlend',2)
    child(material,'FadeInType',1);child(child(material,'FadeIn'),'Frame',2)
    child(material,'FadeOutType',1);child(child(material,'FadeOut'),'Frame',7)
    draw=child(node,'DrawingValues')
    sprite=child(draw,'Sprite'); fixed=child(sprite,'ColorAll_Fixed')
    for key,value in zip('RGBA',color):child(fixed,key,value)
    child(node,'Children')

def project(name,nodes):
    project=XML.Element('EffekseerProject')
    root=child(project,'Root'); child(root,'Name','Root')
    children=child(root,'Children')
    for values in nodes:emitter(children,*values)
    child(project,'ToolVersion','1.60')
    child(project,'Version',3)
    child(project,'StartFrame',0);child(project,'EndFrame',66);child(project,'IsLoop','False')
    XML.indent(project)
    XML.ElementTree(project).write(out/(name+'.efkproj'),encoding='utf-8',xml_declaration=True)

project('Tiger_Ignition',[
 ('White-gold ignition','tex/cinder.png',(255,236,186,230),7,(12,19),.72,((-.05,.05),(-.02,.070),(-.21,-.12)),((.57,.86),(.18,.29),(.25,))),
 ('Sleeved orange sparks','tex/cinder.png',(255,153,48,230),20,(13,22),.66,((-.09,.09),(.003,.105),(-.23,-.10)),((.15,.40),(.11,.19),(.2,)),3,.19),
 ('Thin ember outrunners','tex/cinder.png',(255,202,71,164),9,(13,23),.92,((-.11,.11),(.018,.089),(-.29,-.15)),((.25,.42),(.037,.07),(.22,)),7,.30),
])
project('Thunder_Discharge',[
 ('White-blue branch envelope','tex/electric-card.png',(196,236,255,225),10,(13,16),1.6,((-.075,.075),(.005,.059),(-.19,-.12)),((.85,1.28),(.65,.89),(.31,))),
 ('Blue ion streamer','tex/cinder.png',(63,196,255,205),13,(12,24),.9,((-.09,.09),(-.015,.075),(-.26,-.16)),((.28,.75),(.045,.110),(.20,)),3,.17),
 ('Near-nozzle short forks','tex/electric-card.png',(124,162,255,180),9,(9,14),1.8,((-.061,.061),(.005,.044),(-.12,-.07)),((.7,1.18),(.29,.65),(.20,)),8,.29),
])
print('Authored original flow maps and Effekseer projects:',out)
