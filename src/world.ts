import {fitStreetWidths,streetJunctions,streetCorner,streetKey} from './streets'
import { GANGS } from './filter'
import {softDisc} from './art'
import * as THREE from 'three'
import { ShapeUtils } from 'three'
import { pointInPoly, type CityData, type MapDelta, type Pt } from './map'

import { asphaltMaterial, facadeMaterial, pavingMaterial } from './materials'
const TINTS = [0x555f65, 0x5e6666, 0x454b59, 0x6c655a]
const CELL = 40

export interface Pump {
  node: number
  x: number
  z: number
}

export class World {
  group = new THREE.Group()
  city: CityData
  pumps: Pump[] = []
  private grid = new Map<string, number[]>()
  private roadGrid=new Map<string,{road:number;edge:number}[]>()
  private roofRanges=new Map<number,{geo:THREE.BufferGeometry;start:number;count:number}>()
  private ownedGroup = new THREE.Group()
  private pumpRings: THREE.Mesh[] = []
  private time = 0
  private streets=new THREE.Group()

  constructor(city: CityData) {
    this.city = city
    this.group.add(this.streets)
    fitStreetWidths(city)
    this.buildGround()
    this.buildBuildings()
    this.buildRoads()
    this.buildWater()
    this.placePumps()
    this.group.add(this.ownedGroup)
    this.indexBuildings(0)
  }

  private indexBuildings(from: number) {
    this.city.buildings.forEach((b, i) => {
      if (i < from) return
      for (let gx = Math.floor(b.minX / CELL); gx <= Math.floor(b.maxX / CELL); gx++)
        for (let gz = Math.floor(b.minZ / CELL); gz <= Math.floor(b.maxZ / CELL); gz++) {
          const k = `${gx},${gz}`
          const list = this.grid.get(k)
          if (list) list.push(i)
          else this.grid.set(k, [i])
        }
    })
  }

  private disposed = false
  async appendMap(delta: MapDelta) {
    for(let from=delta.buildingsFrom;from<this.city.buildings.length;from+=512){
      if(this.disposed)return
      this.buildBuildings(from, Math.min(from+512,this.city.buildings.length))
      await new Promise<void>(resolve=>setTimeout(resolve,0))
    }
    if(this.disposed)return
    fitStreetWidths(this.city)
    this.streets.traverse(obj=>{if(obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments){obj.geometry.dispose();for(const mat of Array.isArray(obj.material)?obj.material:[obj.material])mat.dispose()}})
    this.streets.clear()
    this.roadGrid.clear()
    this.buildRoads()
    this.buildWater()
    this.placePumps()
    this.indexBuildings(delta.buildingsFrom)
  }

  private buildGround() {
    const size = this.city.procedural ? this.city.radius * 6 : 40000
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), asphaltMaterial(0x191f23))
    ground.position.y = 0
    ground.renderOrder = 2
    const material=ground.material as THREE.MeshStandardMaterial
    material.stencilWrite=true;material.stencilRef=1;material.stencilFunc=THREE.NotEqualStencilFunc
    material.stencilFail=THREE.KeepStencilOp;material.stencilZFail=THREE.KeepStencilOp;material.stencilZPass=THREE.KeepStencilOp
    ground.rotation.x = -Math.PI / 2
    this.group.add(ground)
  }

  private buildBuildings(from = 0, end = this.city.buildings.length) {
    const buckets = [0, 1].map(() => ({ pos: [] as number[], uv: [] as number[], col: [] as number[] }))
    const roofPos: number[] = [], roofCol: number[] = [], roofGang:number[]=[]
    const ranges:{bi:number;start:number;count:number}[]=[]
    const edgePos: number[] = [], edgeCol: number[] = []
    const roofProps: { x: number; z: number; y: number; sx: number; sz: number; color: number }[] = []
    const antennaPos: number[] = []
    const trims: THREE.Matrix4[] = []
    const trimObject=new THREE.Object3D()
    const trim=(x:number,y:number,z:number,w:number,h:number,d:number,angle:number)=>{
      trimObject.position.set(x,y,z);trimObject.rotation.set(0,angle,0);trimObject.scale.set(w,h,d);trimObject.updateMatrix();trims.push(trimObject.matrix.clone())
    }
    const col = new THREE.Color()
    const roofC = new THREE.Color()

    this.city.buildings.forEach((b, bi) => {
      if (bi < from || bi >= end) return
      const tint = TINTS[(bi * 7 + (bi >> 2)) % TINTS.length]
      col.set(tint).multiplyScalar(0.6 + ((bi * 97) % 40) / 100)
      roofC.set(tint).multiplyScalar(0.65)
      const bk = buckets[bi % 3 === 0 ? 1 : 0]
      const tall = b.height > 45
      const h = b.height
      if (b.area > 90 && (bi * 17) % 5 < 3) {
        const sx = Math.min(8, Math.max(2.2, (b.maxX - b.minX) * 0.22))
        const sz = Math.min(7, Math.max(2, (b.maxZ - b.minZ) * 0.2))
        roofProps.push({ x: b.cx, z: b.cz, y: h + 1.1, sx, sz, color: tint })
        if (tall && bi % 3 === 0) {
          const ah = 8 + (bi % 7) * 2
          antennaPos.push(b.cx, h + 2.2, b.cz, b.cx, h + ah, b.cz)
        }
      }
      let d = 0
      const n = b.poly.length
      for (let i = 0; i < n; i++) {
        const [x1, z1] = b.poly[i]
        const [x2, z2] = b.poly[(i + 1) % n]
        const len = Math.hypot(x2 - x1, z2 - z1)
        if(len>5 && trims.length<6000){
          const angle=Math.atan2(-(z2-z1),x2-x1)
          trim((x1+x2)/2,h,(z1+z2)/2,len+.25,.32,.45,angle)
          trim((x1+x2)/2,3.8,(z1+z2)/2,len,.22,.4,angle)
          if(bi%3===0)for(let t=0;t<len;t+=10)trim(x1+(x2-x1)*t/len,h/2,z1+(z2-z1)*t/len,.26,h,.38,angle)
          if(bi%5===0)trim((x1+x2)/2,1.0,(z1+z2)/2,1.1,2,.65,angle)
        }
        const u1 = d / 32, u2 = (d + len) / 32, v = h / 32
        d += len
        bk.pos.push(x1, 0, z1, x2, 0, z2, x2, h, z2, x1, 0, z1, x2, h, z2, x1, h, z1)
        bk.uv.push(u1, 0, u2, 0, u2, v, u1, 0, u2, v, u1, v)
        for (let k = 0; k < 6; k++) bk.col.push(col.r, col.g, col.b)
        const e = 0.15
        edgePos.push(x1, h, z1, x2, h, z2)
        edgeCol.push(col.r * e, col.g * e, col.b * e, col.r * e, col.g * e, col.b * e)
        if (tall && len > 6) {
          edgePos.push(x1, 0, z1, x1, h, z1)
          edgeCol.push(col.r * 0.4, col.g * 0.4, col.b * 0.4, col.r * e, col.g * e, col.b * e)
        }
      }
      const roofStart=roofPos.length/3
      const contour = b.poly.map(([x, z]) => new THREE.Vector2(x, z))
      if (ShapeUtils.isClockWise(contour)) contour.reverse()
      const tris = ShapeUtils.triangulateShape(contour, [])
      for (const t of tris)
        for (const k of [t[0], t[2], t[1]]) {
          roofPos.push(contour[k].x, h, contour[k].y)
          roofCol.push(roofC.r, roofC.g, roofC.b)
          roofGang.push(0)
        }
      ranges.push({bi,start:roofStart,count:roofPos.length/3-roofStart})
    })

    if(trims.length){
      const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x424a4d,roughness:.9}),trims.length)
      trims.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));this.group.add(mesh)
    }
    buckets.forEach((bk,style) => {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(bk.col, 3))
      geo.computeVertexNormals()
      this.group.add(new THREE.Mesh(geo, facadeMaterial(style)))
    })

    const roofGeo = new THREE.BufferGeometry()
    roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3))
    roofGeo.setAttribute('color', new THREE.Float32BufferAttribute(roofCol, 3))
    roofGeo.setAttribute('gangId',new THREE.Float32BufferAttribute(roofGang,1))
    ranges.forEach(r=>this.roofRanges.set(r.bi,{geo:roofGeo,start:r.start,count:r.count}))
    const roofMat=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide})
    roofMat.onBeforeCompile=shader=>{
      shader.vertexShader='attribute float gangId; varying float vGangId;\n'+shader.vertexShader
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGangId=gangId;')
      shader.fragmentShader='varying float vGangId;\n'+shader.fragmentShader
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nif(vGangId>0.5)diffuseColor.rgb+=vGangId<1.5?vec3(0.0,0.45,0.5):vGangId<2.5?vec3(0.35):vGangId<3.5?vec3(0.25,0.1,0.32):vec3(0.4,0.06,0.16);')
    }
    this.group.add(new THREE.Mesh(roofGeo,roofMat))

    const edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3))
    edgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(edgeCol, 3))
    this.group.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ vertexColors: true })))

    if (roofProps.length) {
      const units = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x161328, metalness: 0.75, roughness: 0.35 }),
        roofProps.length,
      )
      const matrix = new THREE.Matrix4(), color = new THREE.Color()
      roofProps.forEach((p, i) => {
        matrix.compose(
          new THREE.Vector3(p.x, p.y, p.z),
          new THREE.Quaternion(),
          new THREE.Vector3(p.sx, 2.2, p.sz),
        )
        units.setMatrixAt(i, matrix)
        units.setColorAt(i, color.setHex(p.color).multiplyScalar(0.45))
      })
      this.group.add(units)
    }
    if (antennaPos.length) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(antennaPos, 3))
      this.group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff9d00 })))
    }
  }

  private buildRoads(from = 0) {
    const junctions=streetJunctions(this.city.roads)
    const tunnelWalls:number[] = [], tunnelCaps:number[] = [], tunnelCuts:number[] = []
    const pos: number[] = [], line: number[] = [], lineMajor: number[] = [], shoulders: number[] = []
    const paint:number[]=[],sidewalks:number[]=[]
    const lamps:{x:number;y:number;z:number;heading:number}[]=[]
    const pillars: THREE.Matrix4[] = []
    for (let ri = from; ri < this.city.roads.length; ri++) {
      const road = this.city.roads[ri]
      for(let edge=1;edge<road.pts.length;edge++) {
        const a=road.pts[edge-1],b=road.pts[edge],pad=road.width
        for(let x=Math.floor((Math.min(a[0],b[0])-pad)/CELL);x<=Math.floor((Math.max(a[0],b[0])+pad)/CELL);x++)for(let z=Math.floor((Math.min(a[1],b[1])-pad)/CELL);z<=Math.floor((Math.max(a[1],b[1])+pad)/CELL);z++){
          const key=`${x},${z}`,arr=this.roadGrid.get(key)??[];arr.push({road:ri,edge});this.roadGrid.set(key,arr)
        }
      }
      const w = road.width / 2
      let distance=0, nextPillar=25
      for (let i = 0; i < road.pts.length - 1; i++) {
        const [x1, z1] = road.pts[i]
        const [x2, z2] = road.pts[i + 1]
        const y1 = road.heights?.[i] ?? 0, y2 = road.heights?.[i + 1] ?? 0
        const len = Math.hypot(x2 - x1, z2 - z1) || 1
        const nx = (-(z2 - z1) / len) * w, nz = ((x2 - x1) / len) * w
        const branchesA=junctions.get(streetKey([x1,z1],y1))??[],branchesB=junctions.get(streetKey([x2,z2],y2))??[]
        const dX=(x2-x1)/len,dZ=(z2-z1)/len
        const lA=streetCorner([x1,z1],y1,dX,dZ,w,1,branchesA,true),rA=streetCorner([x1,z1],y1,dX,dZ,w,-1,branchesA,true)
        const lB=streetCorner([x2,z2],y2,dX,dZ,w,1,branchesB,false),rB=streetCorner([x2,z2],y2,dX,dZ,w,-1,branchesB,false)
        pos.push(lA[0],y1+.05,lA[1],lB[0],y2+.05,lB[1],rB[0],y2+.05,rB[1],lA[0],y1+.05,lA[1],rB[0],y2+.05,rB[1],rA[0],y1+.05,rA[1])
        const pavement=road.sidewalkWidth??1.1
        if(pavement>0.05)for(const side of [-1,1]) {
          const first=junctions.get(streetKey([x1,z1],y1))??[],last=junctions.get(streetKey([x2,z2],y2))??[]
          const cutA=first.length>2?Math.min(len*.45,Math.max(...first.map(b=>b.width))/2+.25):0
          const cutB=last.length>2?Math.min(len*.45,Math.max(...last.map(b=>b.width))/2+.25):0
          const dx=(x2-x1)/len,dz=(z2-z1)/len
          const a:Pt=[x1+dx*cutA,z1+dz*cutA],b:Pt=[x2-dx*cutB,z2-dz*cutB]
          const ay=y1+(y2-y1)*cutA/len,by=y2-(y2-y1)*cutB/len
          const [ax,az]=streetCorner(a,ay,dx,dz,w,side,cutA?[]:first,true)
          const [bx,bz]=streetCorner(b,by,dx,dz,w,side,cutB?[]:last,false)
          const [cx,cz]=streetCorner(a,ay,dx,dz,w+pavement,side,cutA?[]:first,true)
          const [ex,ez]=streetCorner(b,by,dx,dz,w+pavement,side,cutB?[]:last,false)
          sidewalks.push(ax,ay+.2,az,bx,by+.2,bz,ex,by+.2,ez,ax,ay+.2,az,ex,by+.2,ez,cx,ay+.2,cz)
          sidewalks.push(ax,ay+.05,az,bx,by+.05,bz,bx,by+.2,bz,ax,ay+.05,az,bx,by+.2,bz,ax,ay+.2,az)
          const ox=-dz*.1*side,oz=dx*.1*side
          shoulders.push(ax,ay+.21,az,bx,by+.21,bz,bx+ox,by+.21,bz+oz,ax,ay+.21,az,bx+ox,by+.21,bz+oz,ax+ox,ay+.21,az+oz)
        }
        if (road.bridge) {
          while(nextPillar<=distance+len){
            const t=(nextPillar-distance)/len,h=y1+(y2-y1)*t
            if(h>1)pillars.push(new THREE.Matrix4().compose(new THREE.Vector3(x1+(x2-x1)*t,h/2,z1+(z2-z1)*t),new THREE.Quaternion(),new THREE.Vector3(1.5,h,1.5)))
            nextPillar+=25
          }
        }
        if(!road.tunnel && pavement>.5 && len>8 && lamps.length<1000){const side=ri%2?1:-1;lamps.push({x:(x1+x2)/2+nx/w*(w+pavement*.65)*side,y:(y1+y2)/2,z:(z1+z2)/2+nz/w*(w+pavement*.65)*side,heading:Math.atan2(nx*side,nz*side)})}
        distance+=len
        if(road.tunnel) {
          tunnelCuts.push(x1+nx,0.02,z1+nz,x2+nx,0.02,z2+nz,x2-nx,0.02,z2-nz,x1+nx,0.02,z1+nz,x2-nx,0.02,z2-nz,x1-nx,0.02,z1-nz)
          for(const side of [-1,1])tunnelWalls.push(x1+nx*side,y1,z1+nz*side,x2+nx*side,y2,z2+nz*side,x2+nx*side,0.1,z2+nz*side,x1+nx*side,y1,z1+nz*side,x2+nx*side,0.1,z2+nz*side,x1+nx*side,0.1,z1+nz*side)
          if(y1<=-3.5&&y2<=-3.5)tunnelCaps.push(x1+nx,0.1,z1+nz,x2+nx,0.1,z2+nz,x2-nx,0.1,z2-nz,x1+nx,0.1,z1+nz,x2-nx,0.1,z2-nz,x1-nx,0.1,z1-nz)
        }
        for(let at=6;at<len-6;at+=12)for(const side of [-1,1]){
          const a=at/len,b=Math.min(at+3,len-6)/len,offset=w*0.48*side,ux=nx/w,uz=nz/w
          const ax=x1+(x2-x1)*a+ux*offset,az=z1+(z2-z1)*a+uz*offset,bx=x1+(x2-x1)*b+ux*offset,bz=z1+(z2-z1)*b+uz*offset
          const ay=y1+(y2-y1)*a+0.07,by=y1+(y2-y1)*b+0.07,r=0.045
          paint.push(ax-ux*r,ay,az-uz*r,bx-ux*r,by,bz-uz*r,bx+ux*r,by,bz+uz*r,ax-ux*r,ay,az-uz*r,bx+ux*r,by,bz+uz*r,ax+ux*r,ay,az+uz*r)
        }
        const target = road.major ? lineMajor : line
        target.push(x1, y1 + 0.12, z1, x2, y2 + 0.12, z2)
        if (road.major) {
          const e = w * 0.85
          const ex = (nx / w) * e, ez = (nz / w) * e
          line.push(x1 + ex, y1 + 0.1, z1 + ez, x2 + ex, y2 + 0.1, z2 + ez, x1 - ex, y1 + 0.1, z1 - ez, x2 - ex, y2 + 0.1, z2 - ez)
        }
      }
    }
    for(const arr of [tunnelWalls,tunnelCaps])if(arr.length){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));g.computeVertexNormals()
      this.streets.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x4b4f4d,roughness:0.9,side:THREE.DoubleSide})))
    }
    if(tunnelCuts.length){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(tunnelCuts,3))
      const m=new THREE.MeshBasicMaterial({side:THREE.DoubleSide,colorWrite:false,depthWrite:false,depthTest:false,stencilWrite:true,stencilRef:1,stencilFunc:THREE.AlwaysStencilFunc,stencilZPass:THREE.ReplaceStencilOp})
      const cut=new THREE.Mesh(g,m);cut.renderOrder=1;this.streets.add(cut)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.computeVertexNormals()
    const roadMat=asphaltMaterial(0x28343e);roadMat.polygonOffset=true;roadMat.polygonOffsetFactor=-2;roadMat.polygonOffsetUnits=-2
    const ribbon=new THREE.Mesh(geo,roadMat);ribbon.renderOrder=3;this.streets.add(ribbon)
    if(sidewalks.length){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(sidewalks,3));geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,pavingMaterial());mesh.renderOrder=3;this.streets.add(mesh)}
    if(paint.length){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(paint,3));const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x8b8d7e,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}));mesh.renderOrder=4;this.streets.add(mesh)}
    this.addStreetLights(lamps)
    if(shoulders.length){
      const verge=new THREE.BufferGeometry();verge.setAttribute('position',new THREE.Float32BufferAttribute(shoulders,3));verge.computeVertexNormals()
      this.streets.add(new THREE.Mesh(verge,new THREE.MeshStandardMaterial({color:0x444b4f,roughness:0.95,side:THREE.DoubleSide})))
    }
    if(pillars.length) {
      const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x484b4e,roughness:0.9}),pillars.length)
      pillars.forEach((m,i)=>mesh.setMatrixAt(i,m)); this.streets.add(mesh)
    }
    const mk = (arr: number[], color: number, opacity: number) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }))
    }
    this.streets.add(mk(line, 0x00a4b6, 0.24))
    this.streets.add(mk(lineMajor, 0x00b9c9, 0.34))
  }

  private addStreetLights(lamps:{x:number;y:number;z:number;heading:number}[]) {
    if(!lamps.length)return
    const pole=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06,0.10,5.6,6),new THREE.MeshStandardMaterial({color:0x454c50,roughness:0.8}),lamps.length)
    const head=new THREE.InstancedMesh(new THREE.BoxGeometry(0.35,0.065,0.7),new THREE.MeshBasicMaterial({color:0xffc174}),lamps.length)
    const arm=new THREE.InstancedMesh(new THREE.BoxGeometry(.09,.12,1.3),pole.material,lamps.length)
    const housing=new THREE.InstancedMesh(new THREE.BoxGeometry(.45,.16,.8),pole.material,lamps.length)
    const pool=new THREE.InstancedMesh(new THREE.PlaneGeometry(18,25),new THREE.MeshBasicMaterial({color:0xffb35b,map:softDisc,transparent:true,opacity:0.4,depthWrite:false,blending:THREE.AdditiveBlending}),lamps.length)
    const obj=new THREE.Object3D()
    lamps.forEach((l,i)=>{
      obj.position.set(l.x,l.y+2.8,l.z);obj.rotation.set(0,l.heading,0);obj.updateMatrix();pole.setMatrixAt(i,obj.matrix)
      obj.position.set(l.x-Math.sin(l.heading)*.6,l.y+5.6,l.z-Math.cos(l.heading)*.6);obj.updateMatrix();arm.setMatrixAt(i,obj.matrix)
      obj.position.set(l.x-Math.sin(l.heading)*1.15,l.y+5.6,l.z-Math.cos(l.heading)*1.15);obj.updateMatrix();housing.setMatrixAt(i,obj.matrix)
      obj.position.y-=.1;obj.updateMatrix();head.setMatrixAt(i,obj.matrix)
      obj.position.set(l.x-Math.sin(l.heading)*3,l.y+0.16,l.z-Math.cos(l.heading)*3);obj.rotation.set(-Math.PI/2,0,-l.heading);obj.updateMatrix();pool.setMatrixAt(i,obj.matrix)
    });this.streets.add(pole,arm,housing,head,pool)
  }

  private placePumps() {
    const main = this.city.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.main)
    if (!main.length) return
    const chosen: { node: number; x: number; z: number }[] = []
    const venues = this.city.venues.filter(v => v.tags.amenity === 'fuel' || v.tags.subclass === 'fuel')
    for(const venue of venues) {
      if(this.pumps.some(p => Math.hypot(p.x-venue.x,p.z-venue.z)<3)) continue
      const nearest=main.reduce((a,b)=>Math.hypot(a.n.x-venue.x,a.n.z-venue.z)<Math.hypot(b.n.x-venue.x,b.n.z-venue.z)?a:b)
      chosen.push({node:nearest.i,x:venue.x,z:venue.z})
    }
    if(this.city.procedural && !this.pumps.length) {
      for(let i=0;i<main.length;i+=Math.max(1,Math.floor(main.length/9))) chosen.push({node:main[i].i,x:main[i].n.x,z:main[i].n.z})
    }
    if(!chosen.length)return
    const pillarGeo = new THREE.CylinderGeometry(0.5, 0.7, 2.5, 8)
    const pillarMat = new THREE.MeshBasicMaterial({ color: 0x19ffe6 })
    const ringGeo = new THREE.TorusGeometry(1.3, 0.035, 6, 24)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x19ffe6, transparent: true, opacity: 0.45 })
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x19ffe6, transparent: true, opacity: 0.12, depthWrite: false })
    for (const p of chosen) {
      const i = p.node, n = { ...this.city.nodes[i], x: p.x, z: p.z }
      this.pumps.push(p)
      const g = new THREE.Group()
      g.position.set(n.x, 0, n.z)
      const m = this.city.nodes[n.adj[0] ?? i]
      const len = Math.hypot(m.x - n.x, m.z - n.z) || 1
      const pillar = new THREE.Mesh(pillarGeo, pillarMat)
      pillar.position.set(((m.z - n.z) / len) * 10, 1.25, (-(m.x - n.x) / len) * 10)
      g.add(pillar)
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.5
      g.add(ring)
      this.pumpRings.push(ring)
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 8, 8, 1, true), beamMat)
      beam.position.set(pillar.position.x, 4, pillar.position.z)
      g.add(beam)
      this.group.add(g)
    }
  }

  setOwned(buildingIdx:number[]) {this.setTurf(buildingIdx.map(building=>({building,gang:'SHINOBI'})))}
  setTurf(claims:{building:number;gang:string}[]) {
    for(const {geo,start,count} of this.roofRanges.values()) {const attr=geo.getAttribute('gangId') as THREE.BufferAttribute;for(let i=start;i<start+count;i++)attr.setX(i,0);attr.needsUpdate=true}
    for(const claim of claims){
      const r=this.roofRanges.get(claim.building);if(!r)continue
      const id=GANGS.indexOf(claim.gang as typeof GANGS[number])+1,attr=r.geo.getAttribute('gangId') as THREE.BufferAttribute
      for(let i=r.start;i<r.start+r.count;i++)attr.setX(i,id);attr.needsUpdate=true
    }
  }

  update(dt: number) {
    this.time += dt
    const s = 1 + Math.sin(this.time * 3) * 0.08
    for (const r of this.pumpRings) r.scale.set(s, s, s)
    for (const c of this.ownedGroup.children) if (c.userData.spin) c.rotation.y += dt * 1.5

  }

  /** Returns the building index if (x,z) at altitude y is inside a building. */
  hitBuilding(x: number, z: number, y: number) {
    if(y<0)return -1
    const list = this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)
    if (!list) return -1
    for (const i of list) {
      const b = this.city.buildings[i]
      if (y > b.height || x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue
      if (pointInPoly(x, z, b.poly as Pt[])) return i
    }
    return -1
  }

  groundHeightAt(x: number, z: number, y: number) {
    let height = this.isWater(x,z) ? -2.5 : 0, best=Infinity
    for(const entry of this.roadGrid.get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`)??[]) {
      const road=this.city.roads[entry.road],i=entry.edge
      const a=road.pts[i-1],b=road.pts[i],dx=b[0]-a[0],dz=b[1]-a[1]
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)))
      const d=Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)
      const h=(road.heights?.[i-1]??0)*(1-t)+(road.heights?.[i]??0)*t
      if(d<road.width/2 && Math.abs(h+1.3-y)<best) {height=h;best=Math.abs(h+1.3-y)}
    }
    return height
  }

  isTunnel(x:number,z:number,y:number){
    if(y>=0.5)return false
    return (this.roadGrid.get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`)??[]).some(({road:ri,edge:i})=>{
      const road=this.city.roads[ri];if(!road.tunnel)return false
      const a=road.pts[i-1],b=road.pts[i],dx=b[0]-a[0],dz=b[1]-a[1]
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)))
      return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<road.width/2
    })
  }
  isWater(x: number,z: number) { return this.city.waters.some(w=>pointInPoly(x,z,w.poly)&&!w.holes.some(h=>pointInPoly(x,z,h))) }
  gangAt(x: number,z: number) { return this.city.zones.find(w=>pointInPoly(x,z,w.poly))?.gang ?? 'SHINOBI' }
  eligibleAt(x: number,z: number) {
    if(this.city.zones.some(w=>w.tags.landuse==='residential'&&pointInPoly(x,z,w.poly))) return false
    const ids=new Set<number>()
    for(let gx=Math.floor((x-50)/CELL);gx<=Math.floor((x+50)/CELL);gx++)
      for(let gz=Math.floor((z-50)/CELL);gz<=Math.floor((z+50)/CELL);gz++)
        for(const i of this.grid.get(`${gx},${gz}`)??[])ids.add(i)
    const nearby=[...ids].map(i=>this.city.buildings[i]).filter(b=>Math.hypot(x-b.cx,z-b.cz)<50)
    return nearby.some(b=>b.eligible) && !nearby.some(b=>b.tags && ['school','kindergarten','hospital','place_of_worship','residential'].some(t=>Object.values(b.tags!).includes(t)))
  }
  private waterCount=0
  private buildWater() {
    for(const water of this.city.waters.slice(this.waterCount)) {
      const shape=new THREE.Shape(water.poly.map(([x,z])=>new THREE.Vector2(x,-z)))
      shape.holes=water.holes.map(h=>new THREE.Path(h.map(([x,z])=>new THREE.Vector2(x,-z))))
      const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshStandardMaterial({color:0x12151c,roughness:0.12,metalness:0.5,side:THREE.DoubleSide,stencilWrite:true,stencilRef:1,stencilFunc:THREE.AlwaysStencilFunc,stencilZPass:THREE.ReplaceStencilOp}))
      mesh.renderOrder=1;mesh.rotation.x=-Math.PI/2; mesh.position.y=-2.5;this.group.add(mesh)
      const wall:number[]=[]
      for(const ring of [water.poly,...water.holes]) for(let i=0;i<ring.length;i++) {
        const [x,z]=ring[i], [a,b]=ring[(i+1)%ring.length]
        wall.push(x,0,z,a,0,b,a,-2.5,b,x,0,z,a,-2.5,b,x,-2.5,z)
      }
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(wall,3));geo.computeVertexNormals()
      this.group.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x454846,roughness:0.9,side:THREE.DoubleSide})))
    }
    this.waterCount=this.city.waters.length
  }

  nearestPump(x: number, z: number) {
    let best: Pump | null = null, bd = Infinity
    for (const p of this.pumps) {
      const d = Math.hypot(p.x - x, p.z - z)
      if (d < bd) { bd = d; best = p }
    }
    return { pump: best, dist: bd }
  }

  dispose() {
    this.disposed = true
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else if (mat) {
        ;(mat as THREE.MeshBasicMaterial).map?.dispose()
        mat.userData.atlas?.dispose()
        mat.dispose()
      }
    })
  }
}
