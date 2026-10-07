import ClipperLib from 'clipper-lib'
type Polygon=Pt[][]
type MultiPolygon=Polygon[]
import {ShapeUtils,Vector2} from 'three'
import {pointInPoly,type CityData,type Pt} from './map'
import {streetCorner,streetJunctions,streetKey} from './streets'

type Mask={polygon:Polygon;y:number;building:boolean;minX:number;maxX:number;minZ:number;maxZ:number}
export type Lamp={x:number;y:number;z:number;heading:number}
const CELL=32
// Clipper performs all intersections on an integer centimetre grid, including intermediate vertices.
export function subtractPavement(subject:Polygon,masks:Polygon[]):MultiPolygon {
  const paths=(polygon:Polygon)=>polygon.map((ring,i)=>{
    const path=ring.map(([x,z])=>({X:Math.round(x*100),Y:Math.round(z*100)}))
    if(ClipperLib.Clipper.Orientation(path)!==(i===0))path.reverse()
    return path
  })
  // Runtime exposes ioStrictlySimple as the numeric constructor flag 2.
  const clipper=new ClipperLib.Clipper(2),tree=new ClipperLib.PolyTree()
  clipper.AddPaths(paths(subject),ClipperLib.PolyType.ptSubject,true)
  for(const mask of masks)clipper.AddPaths(paths(mask),ClipperLib.PolyType.ptClip,true)
  clipper.Execute(ClipperLib.ClipType.ctDifference,tree,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero)
  return ClipperLib.JS.PolyTreeToExPolygons(tree).map(p=>[p.outer,...p.holes].map(r=>r.map(({X,Y}):Pt=>[X/100,Y/100])))
}
function bounds(ring:Pt[]){return {minX:Math.min(...ring.map(p=>p[0])),maxX:Math.max(...ring.map(p=>p[0])),minZ:Math.min(...ring.map(p=>p[1])),maxZ:Math.max(...ring.map(p=>p[1]))}}
function area(ring:Pt[]){let sum=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];sum+=a[0]*b[1]-b[0]*a[1]}return Math.abs(sum)/2}
export function inPavement(p:Pt,polygons:MultiPolygon){return polygons.some(poly=>pointInPoly(p[0],p[1],poly[0])&&!poly.slice(1).some(hole=>pointInPoly(p[0],p[1],hole)))}

/** Local geometric subtraction works even when MVT crossing roads have no shared graph node. */
export class PavementLayout {
  private masks:Mask[]=[]
  private grid=new Map<string,number[]>()
  readonly lamps:Lamp[]=[]
  constructor(city:CityData){
    const junctions=streetJunctions(city.roads)
    for(const road of city.roads)for(let i=1;i<road.pts.length;i++){
      const a=road.pts[i-1],b=road.pts[i],ay=road.heights?.[i-1]??0,by=road.heights?.[i]??0,len=Math.hypot(b[0]-a[0],b[1]-a[1])
      if(len<.01)continue
      const dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len,w=road.width/2
      const first=junctions.get(streetKey(a,ay))??[],last=junctions.get(streetKey(b,by))??[]
      const ring=[streetCorner(a,ay,dx,dz,w,1,first,true),streetCorner(b,by,dx,dz,w,1,last,false),streetCorner(b,by,dx,dz,w,-1,last,false),streetCorner(a,ay,dx,dz,w,-1,first,true)]
      this.add([ring],(ay+by)/2,false)
    }
    for(const b of city.buildings)this.add([b.poly],0,true)
  }
  private cells(b:ReturnType<typeof bounds>){const keys:string[]=[];for(let x=Math.floor(b.minX/CELL);x<=Math.floor(b.maxX/CELL);x++)for(let z=Math.floor(b.minZ/CELL);z<=Math.floor(b.maxZ/CELL);z++)keys.push(`${x},${z}`);return keys}
  private add(polygon:Polygon,y:number,building:boolean){
    const mask={polygon,y,building,...bounds(polygon[0])},i=this.masks.length;this.masks.push(mask)
    for(const key of this.cells(mask)){const list=this.grid.get(key)??[];list.push(i);this.grid.set(key,list)}
  }
  cut(ring:Pt[],y:number):MultiPolygon{
    if(area(ring)<.01)return []
    const box=bounds(ring),ids=new Set<number>()
    for(const key of this.cells(box))for(const id of this.grid.get(key)??[])ids.add(id)
    const masks=[...ids].map(i=>this.masks[i]).filter(m=>(m.building||Math.abs(m.y-y)<.5)&&m.maxX>=box.minX&&m.minX<=box.maxX&&m.maxZ>=box.minZ&&m.minZ<=box.maxZ).map(m=>m.polygon)
    const result=(masks.length?subtractPavement([ring],masks):[[ring]]).filter(p=>area(p[0])-p.slice(1).reduce((sum,h)=>sum+area(h),0)>.15)
    // Reserving the result also removes duplicate and partially overlapping tile features.
    for(const polygon of result)this.add(polygon,y,false)
    return result
  }
  addLamp(lamp:Lamp,polygons:MultiPolygon){
    const p:Pt=[lamp.x,lamp.z],r=.18
    if(![[0,0],[r,0],[-r,0],[0,r],[0,-r]].every(([x,z])=>inPavement([p[0]+x,p[1]+z],polygons)))return false
    if(this.lamps.some(other=>Math.hypot(other.x-lamp.x,other.z-lamp.z)<22))return false
    this.lamps.push(lamp);return true
  }
}

export function appendPavement(target:number[],polygons:MultiPolygon,heightAt:(p:Pt)=>number){
  for(const polygon of polygons){
    const rings=polygon.map(r=>r.length>1&&r[0][0]===r.at(-1)![0]&&r[0][1]===r.at(-1)![1]?r.slice(0,-1):r)
    const contour=rings[0].map(p=>new Vector2(...p)),holes=rings.slice(1).map(r=>r.map(p=>new Vector2(...p)))
    const flat=rings.flat()
    for(const face of ShapeUtils.triangulateShape(contour,holes))for(const i of face){const p=flat[i];target.push(p[0],heightAt(p)+.2,p[1])}
    // Curbs follow the clipped boundary, never the old uncut quad.
    for(const ring of rings)for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],ay=heightAt(a),by=heightAt(b)
      target.push(a[0],ay+.05,a[1],b[0],by+.05,b[1],b[0],by+.2,b[1],a[0],ay+.05,a[1],b[0],by+.2,b[1],a[0],ay+.2,a[1])
    }
  }
}
