import * as THREE from 'three'
import type { World } from './world'
import type { Player } from './vehicle'
import { buildVehicleMesh } from './vehicle'
import { vehicleById } from './data'
/** Find a contiguous road-graph cycle; disconnected avenues never form a fabricated circuit. */
export function highwayLoop(world:World,start:number) {
 const nodes=world.city.nodes,visited=new Set<number>()
 const starts=nodes.map((n,i)=>({n,i})).filter(({n})=>(n.width??7.5)>=10&&n.adj.length>1).sort((a,b)=>Math.hypot(a.n.x-nodes[start].x,a.n.z-nodes[start].z)-Math.hypot(b.n.x-nodes[start].x,b.n.z-nodes[start].z))
 for(const root of starts){
  if(visited.has(root.i))continue
  const stack=[{id:root.i,parent:-1,edge:0}],active=new Map<number,number>([[root.i,0]])
  visited.add(root.i)
  while(stack.length){
   const frame=stack[stack.length-1],adj=nodes[frame.id].adj
   if(frame.edge>=adj.length){active.delete(frame.id);stack.pop();continue}
   const next=adj[frame.edge++]
   if(next===frame.parent||(nodes[next].width??7.5)<10)continue
   const ancestor=active.get(next)
   if(ancestor!==undefined){
    const path=stack.slice(ancestor).map(f=>f.id)
    const length=path.reduce((sum,n,i)=>{const a=nodes[n],b=nodes[path[(i+1)%path.length]];return sum+Math.hypot(a.x-b.x,a.z-b.z)},0)
    if(path.length>=3&&length>400)return path
   }else if(!visited.has(next)){visited.add(next);active.set(next,stack.length);stack.push({id:next,parent:frame.id,edge:0})}
  }
 }
 return [] as number[]
}
export class Campaign {
 boss=buildVehicleMesh(vehicleById('hoverghini'),'liar')
 intro=0
 racing=false
 lap=0
 checkpoint=1
 result:'win'|'lose'|null=null
 private path:number[]=[]
 private bossDistance=0
 private bossEdge=0
 private bossLaps=0
 private introOrigin=new THREE.Vector3()
 private introHeading=0
 constructor(privateWorld:World){this.world=privateWorld;this.boss.visible=false}
 private world:World
 coldOpen(player:Player){this.intro=4;this.introOrigin.copy(player.pos);this.introHeading=player.heading;this.boss.visible=true}
 challenge(player:Player){
  this.path=highwayLoop(this.world,player.edgeA)
  if(this.path.length<3)return false
  // Staging at the start is explicit; the race starts after both competitors are placed.
  player.placeAtNode(this.world,this.path[0]);player.edgeB=this.path[1]
  const a=this.world.city.nodes[this.path[0]],b=this.world.city.nodes[this.path[1]]
  player.heading=Math.atan2(b.x-a.x,b.z-a.z)
  this.bossDistance=0;this.bossEdge=0;this.bossLaps=0;this.lap=0;this.checkpoint=1;this.result=null;this.racing=true;this.boss.visible=true
  return true
 }
 get target(){const i=this.path[this.checkpoint%this.path.length];return i===undefined?null:this.world.city.nodes[i]}
 update(dt:number,player:Player){
  if(this.intro>0){
   this.intro=Math.max(0,this.intro-dt)
   const distance=120-(this.intro*60)
   this.boss.position.copy(this.introOrigin).add(new THREE.Vector3(Math.sin(this.introHeading)*distance+Math.cos(this.introHeading)*3,0,Math.cos(this.introHeading)*distance-Math.sin(this.introHeading)*3))
   this.boss.rotation.y=this.introHeading
   if(!this.intro)this.boss.visible=false
  }
  if(!this.racing)return
  const nodes=this.world.city.nodes
  this.bossDistance+=dt*58
  for(let guard=0;guard<20;guard++){
   const a=nodes[this.path[this.bossEdge]],b=nodes[this.path[(this.bossEdge+1)%this.path.length]],length=Math.hypot(b.x-a.x,b.z-a.z)||1
   if(this.bossDistance<length){const t=this.bossDistance/length;this.boss.position.set(a.x+(b.x-a.x)*t,(a.y??0)*(1-t)+(b.y??0)*t+1.3,a.z+(b.z-a.z)*t);this.boss.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);break}
   this.bossDistance-=length;this.bossEdge=(this.bossEdge+1)%this.path.length
   if(this.bossEdge===0)this.bossLaps++
  }
  const target=this.target
  if(target&&Math.hypot(player.pos.x-target.x,player.pos.z-target.z)<14){
   this.checkpoint++
   if(this.checkpoint%this.path.length===1)this.lap++
  }
  if(this.lap>=3||this.bossLaps>=3){this.result=this.lap>=3?'win':'lose';this.racing=false;this.boss.visible=false}
 }
 dispose(){this.boss.traverse(o=>{const m=o as THREE.Mesh;m.geometry?.dispose()})}
}
