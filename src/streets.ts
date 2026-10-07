import type { CityData, Pt, Road } from './map'

export const SIDEWALK_WIDTH = 1.1
export const MIN_DRIVABLE_WIDTH = 3.2
export const streetKey = (p:Pt,y=0) => `${Math.round(p[0]*4)},${Math.round(p[1]*4)},${Math.round(y*10)}`
type Branch={dx:number;dz:number;width:number;key:string}
export function streetJunctions(roads:Road[]) {
  const junctions=new Map<string,Branch[]>()
  for(const road of roads)for(let i=0;i<road.pts.length;i++){
    const p=road.pts[i],key=streetKey(p,road.heights?.[i]),branches=junctions.get(key)??[]
    for(const j of [i-1,i+1])if(j>=0&&j<road.pts.length){
      const q=road.pts[j],other=streetKey(q,road.heights?.[j]),len=Math.hypot(q[0]-p[0],q[1]-p[1])
      if(len>0&&!branches.some(b=>b.key===other))branches.push({dx:(q[0]-p[0])/len,dz:(q[1]-p[1])/len,width:road.width,key:other})
    }
    junctions.set(key,branches)
  }
  return junctions
}
/** Shared miter at ordinary shape nodes; only actual junctions have curb openings. */
export function streetCorner(p:Pt,y:number,dx:number,dz:number,radius:number,side:number,branches:Branch[],start:boolean):Pt {
  let nx=-dz,nz=dx
  if(branches.length===2){
    const forward=start?1:-1
    const other=branches.find(b=>b.dx*dx*forward+b.dz*dz*forward<.999)
    if(other){
      const ox=other.dx*(start?-1:1),oz=other.dz*(start?-1:1)
      const mx=nx-oz,mz=nz+ox,den=mx*nx+mz*nz
      if(den>1e-5){const factor=Math.min(1/den,1.5/Math.hypot(mx,mz));nx=mx*factor;nz=mz*factor}
    }
  }
  void y
  return [p[0]+nx*radius*side,p[1]+nz*radius*side]
}
function pointSegment(p:Pt,a:Pt,b:Pt) {
  const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)))
  return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t)
}
function cross(a:Pt,b:Pt,c:Pt){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])}
function segmentDistance(a:Pt,b:Pt,c:Pt,d:Pt){
  if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0
  return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b))
}
/** Fit pavement to mapped corridors, but do not collapse carriageways on noisy building data. */
export function fitStreetWidths(city:CityData){
  const grid=new Map<string,number[]>(),cell=40
  city.buildings.forEach((b,i)=>{for(let x=Math.floor(b.minX/cell);x<=Math.floor(b.maxX/cell);x++)for(let z=Math.floor(b.minZ/cell);z<=Math.floor(b.maxZ/cell);z++){const key=`${x},${z}`,list=grid.get(key)??[];list.push(i);grid.set(key,list)}})
  for(const road of city.roads){
    road.requestedWidth??=road.width
    let clearance=Infinity
    if(!road.bridge&&!road.tunnel)for(let i=1;i<road.pts.length;i++){
      const a=road.pts[i-1],b=road.pts[i],margin=road.requestedWidth/2+SIDEWALK_WIDTH+.25,candidates=new Set<number>()
      for(let x=Math.floor((Math.min(a[0],b[0])-margin)/cell);x<=Math.floor((Math.max(a[0],b[0])+margin)/cell);x++)for(let z=Math.floor((Math.min(a[1],b[1])-margin)/cell);z<=Math.floor((Math.max(a[1],b[1])+margin)/cell);z++)for(const index of grid.get(`${x},${z}`)??[])candidates.add(index)
      for(const index of candidates){const poly=city.buildings[index].poly;for(let j=0;j<poly.length;j++)clearance=Math.min(clearance,segmentDistance(a,b,poly[j],poly[(j+1)%poly.length]))}
    }
    // Keep useful carriageway space first, then reduce pavement in tight alleys.
    const availableWidth=2*(clearance-.25-Math.min(SIDEWALK_WIDTH,Math.max(0,clearance-1.9)))
    road.width=Math.max(MIN_DRIVABLE_WIDTH,Math.min(road.requestedWidth,availableWidth))
    road.sidewalkWidth=road.tunnel||road.bridge?0:Math.max(0,Math.min(SIDEWALK_WIDTH,clearance-road.width/2-.25))
  }
  const widths=new Map<string,number>()
  for(const road of city.roads)road.pts.forEach((p,i)=>{const key=streetKey(p,road.heights?.[i]);widths.set(key,Math.min(widths.get(key)??Infinity,road.width))})
  city.nodes.forEach(n=>{n.width=widths.get(streetKey([n.x,n.z],n.y))??n.width})
}
