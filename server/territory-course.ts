import {distance,validGeo,wrapLon,type Geo} from '../shared/multiplayer'
/** Select a deterministic public road out-and-back, then gate it every <=35 m. */
export function territoryCourse(data:any,center:Geo):Geo[]{
 if(!data||data.remark||!Array.isArray(data.elements)||data.elements.length>4000)throw new Error('Incomplete road data')
 const candidates:{id:number;points:Geo[];length:number;near:number}[]=[]
 for(const e of data.elements){
  if(e.type!=='way'||!Number.isSafeInteger(e.id)||!['residential','unclassified','tertiary','secondary','living_street','service'].includes(e.tags?.highway)||['private','no'].includes(e.tags?.access)||e.tags?.area==='yes'||['yes','1','-1'].includes(e.tags?.oneway)||e.tags?.junction==='roundabout'||!Array.isArray(e.geometry)||e.geometry.length>1000||!e.geometry.every(validGeo))continue
  // Building/road source can overlap a larger district. Keep the whole contest local.
  if(e.geometry.some((p:Geo)=>distance(p,center)>1400))continue
  let length=0;const points:Geo[]=[e.geometry[0]]
  for(const p of e.geometry.slice(1)){const d=distance(points.at(-1)!,p);if(d<.5)continue;if(d>300||length+d>850)break;length+=d;points.push(p)}
  if(length>=250)candidates.push({id:e.id,points,length,near:distance(points[0],center)})
 }
 candidates.sort((a,b)=>a.near-b.near||a.id-b.id)
 const chosen=candidates[0];if(!chosen)throw new Error('No suitable public road delivery route in this district; try a neighbouring district')
 const out:Geo[]=[chosen.points[0]]
 for(let i=1;i<chosen.points.length;i++){
  const a=chosen.points[i-1],b=chosen.points[i],steps=Math.ceil(distance(a,b)/35)
  for(let j=1;j<=steps;j++)out.push({lat:a.lat+(b.lat-a.lat)*j/steps,lon:wrapLon(a.lon+wrapLon(b.lon-a.lon)*j/steps)})
 }
 if(out.length>64)throw new Error('Road route too complex')
 return [...out,...out.slice(0,-1).reverse()]
}
export function routeDistance(p:Geo,a:Geo,b:Geo){
 const sx=111320*Math.cos(p.lat*Math.PI/180),sy=110540,ax=wrapLon(a.lon-p.lon)*sx,ay=(a.lat-p.lat)*sy,bx=wrapLon(b.lon-p.lon)*sx,by=(b.lat-p.lat)*sy,dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)))
 return Math.hypot(ax+t*dx,ay+t*dy)
}
