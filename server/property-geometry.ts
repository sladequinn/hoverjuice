import ClipperLib from 'clipper-lib'
import {distance,validGeo,wrapLon,type Geo} from '../shared/multiplayer'
import {HttpError} from './security'
export interface SourceBuilding {id:string;aliases:string[];name:string;version:number;rings:Geo[][];lat:number;lon:number;area:number;levels:number;use:string;eligible:boolean}
const close=(a:Geo,b:Geo)=>a.lat===b.lat&&a.lon===b.lon
const key=(p:Geo)=>`${p.lat.toFixed(7)},${wrapLon(p.lon).toFixed(7)}`
function assemble(parts:Geo[][]){
 const pending=parts.map(p=>p.slice()),rings:Geo[][]=[]
 while(pending.length){let ring=pending.pop()!;let guard=0
  while(!close(ring[0],ring.at(-1)!)){
   const end=ring.at(-1)!,index=pending.findIndex(p=>close(p[0],end)||close(p.at(-1)!,end))
   if(index<0||guard++>512)throw Error('Incomplete building relation')
   const next=pending.splice(index,1)[0];if(!close(next[0],end))next.reverse();ring.push(...next.slice(1))
  }
  if(ring.length<4)throw Error('Invalid ring');rings.push(ring.slice(0,-1))
 }
 return rings
}
function canonical(rings:Geo[][]){return rings.map(r=>{
 const points=r.map(p=>({lat:Math.round(p.lat*1e7)/1e7,lon:Math.round(wrapLon(p.lon)*1e7)/1e7}))
 const rotate=(a:Geo[])=>{let index=0;for(let i=1;i<a.length;i++)if(key(a[i])<key(a[index]))index=i;return [...a.slice(index),...a.slice(0,index)]}
 const a=rotate(points),b=rotate([...points].reverse());return JSON.stringify(a)<JSON.stringify(b)?a:b
 }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}
function paths(rings:Geo[][],origin:Geo){return rings.map(r=>r.map(p=>({X:Math.round(wrapLon(p.lon-origin.lon)*111320*Math.cos(origin.lat*Math.PI/180)*100),Y:Math.round((p.lat-origin.lat)*110540*100)})))}
export function contains(rings:Geo[][],p:Geo){let inside=false;for(const ring of paths(rings,p)){const hit=ClipperLib.Clipper.PointInPolygon({X:0,Y:0},ring);if(hit===-1)return true;if(hit===1)inside=!inside}return inside}
export function overlap(a:Geo[][],b:Geo[][]){
 const clip=new ClipperLib.Clipper(),solution:any[]=[];clip.AddPaths(paths(a,a[0][0]),ClipperLib.PolyType.ptSubject,true);clip.AddPaths(paths(b,a[0][0]),ClipperLib.PolyType.ptClip,true)
 clip.Execute(ClipperLib.ClipType.ctIntersection,solution,ClipperLib.PolyFillType.pftEvenOdd,ClipperLib.PolyFillType.pftEvenOdd)
 return Math.abs(solution.reduce((sum,path)=>sum+ClipperLib.Clipper.Area(path),0))/10000
}
export function geometryArea(rings:Geo[][]){const clip=new ClipperLib.Clipper(),solution:any[]=[];clip.AddPaths(paths(rings,rings[0][0]),ClipperLib.PolyType.ptSubject,true);clip.Execute(ClipperLib.ClipType.ctUnion,solution,ClipperLib.PolyFillType.pftEvenOdd,ClipperLib.PolyFillType.pftEvenOdd);return Math.abs(solution.reduce((sum,path)=>sum+ClipperLib.Clipper.Area(path),0))/10000}
/** Only complete, server-fetched OSM building ways/multipolygon relations enter the catalog. */
export function parseBuildings(data:any):SourceBuilding[]{
 if(!data||data.remark||!Array.isArray(data.elements)||data.elements.length>4000)throw new HttpError(503,'Incomplete or excessive map source response')
 const result:SourceBuilding[]=[],members=new Set<number>()
 for(const e of data.elements)if(e.type==='relation'&&e.tags?.building&&e.tags.type==='multipolygon')for(const m of e.members??[])if(m.type==='way')members.add(m.ref)
 for(const e of data.elements){
  if(!['way','relation'].includes(e.type)||!Number.isSafeInteger(e.id)||e.id<1||!Number.isSafeInteger(e.version)||e.version<1||!e.tags?.building||e.tags.building==='no'||e.tags['building:part']||members.has(e.id)&&e.type==='way')continue
  try{
   let raw:any[][],aliases:string[]=[]
   if(e.type==='way')raw=[e.geometry]
   else {if(e.tags.type!=='multipolygon'||!Array.isArray(e.members)||e.members.length>512)continue;if(e.members.some((m:any)=>m.type==='relation'||m.type==='way'&&(!Number.isSafeInteger(m.ref)||m.ref<1||!['outer','inner',''].includes(m.role))))continue;const ways=e.members.filter((m:any)=>m.type==='way');raw=ways.map((m:any)=>m.geometry);aliases=ways.map((m:any)=>`osm:way:${m.ref}`)}
   if(!raw.length||raw.some(r=>!Array.isArray(r)||r.length<2)||raw.flat().length>5000||raw.flat().some(p=>!validGeo(p)))continue
   const rings=canonical(assemble(raw)),first=rings[0][0],all=rings.flat()
   // Coordinate mean is only a spatial index anchor; selection uses the full footprint, including holes.
   const lat=all.reduce((s,p)=>s+p.lat,0)/all.length,lon=wrapLon(first.lon+all.reduce((s,p)=>s+wrapLon(p.lon-first.lon),0)/all.length),center={lat,lon}
   if(all.some(p=>distance(center,p)>500)||Math.abs(lat)>85)continue
   const area=Math.round(geometryArea(rings));if(area<12||area>500000)continue
   const tags=e.tags,levels=Math.max(1,Math.min(80,Math.round(Number(tags['building:levels'])||Number.parseFloat(tags.height)/3.4||1)))
   const use=String(tags.building),eligible=!['school','kindergarten','hospital','place_of_worship','police','fire_station','prison'].includes(String(tags.amenity))&&!['school','hospital','church','cathedral','mosque','synagogue','temple','civic','government','ruins','construction'].includes(use)
   result.push({id:`osm:${e.type}:${e.id}`,aliases,name:String(tags.name||tags['addr:street']&&`${tags['addr:housenumber']||''} ${tags['addr:street']}`||`Building ${e.id}`).slice(0,120),version:e.version,rings,lat,lon,area,levels,use,eligible})
  }catch{ /* Incomplete/unsupported geometry is never made purchasable. */ }
 }
 return result
}
/** Game valuation, not a real estate appraisal. Same source snapshot => same integer price worldwide. */
export function valueBuilding(b:SourceBuilding,neighbours:SourceBuilding[]){
 const density=neighbours.filter(n=>n.id!==b.id&&distance(n,b)<300).length
 const use=['commercial','retail','office'].includes(b.use)?1.3:['industrial','warehouse'].includes(b.use)?.8:1
 return Math.round(Math.min(100000000,Math.max(5000,b.area*b.levels*60)*use*(1+Math.min(200,density)/100))/100)*10000
}
export const sourceCell=(p:Geo)=>`${Math.floor((p.lat+90)/.005)}:${Math.floor((wrapLon(p.lon)+180)/.005)}`
export function sourceCenter(key:string){const [r,c]=key.split(':').map(Number);return {lat:-90+(r+.5)*.005,lon:-180+(c+.5)*.005}}
