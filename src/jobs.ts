import type {RoadNode} from './map'
/** Prefer long routes in the player's connected street network; never duplicate pickup clusters. */
export function jobPair(nodes:RoadNode[],pool:number[],x:number,z:number,used:number[]){
 const candidates=pool.filter(i=>{
  const n=nodes[i],d=Math.hypot(n.x-x,n.z-z)
  return d>=650&&d<=4000&&used.every(j=>Math.hypot(n.x-nodes[j].x,n.z-nodes[j].z)>=900)
 })
 if(!candidates.length)return null
 const start=Math.floor(Math.random()*candidates.length)
 for(let k=0;k<candidates.length;k++){
  const from=candidates[(start+k)%candidates.length],a=nodes[from]
  const destinations=pool.filter(i=>{const b=nodes[i],d=Math.hypot(a.x-b.x,a.z-b.z);return d>=1600&&d<=5000})
  if(destinations.length){const to=destinations[Math.floor(Math.random()*destinations.length)];return {from,to,dist:Math.hypot(a.x-nodes[to].x,a.z-nodes[to].z)}}
 }
 return null
}
