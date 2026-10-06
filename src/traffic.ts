import * as THREE from 'three'
import type { World } from './world'
interface Agent {a:number;b:number;distance:number;speed:number;seed:number;kind:number;pos:THREE.Vector3;near:boolean;cooldown:number}
export interface TrafficEvents {nearMisses:number;impact:number;boxed:boolean}
/** Three instanced fleets: couriers, freight and territorial interceptors. */
export class TrafficSystem {
 group=new THREE.Group()
 private agents:Agent[]=[]
 private world:World
 private fleets:THREE.InstancedMesh[]=[]
 private matrix=new THREE.Matrix4()
 private rotation=new THREE.Quaternion()
 private up=new THREE.Vector3(0,1,0)
 constructor(world:World){
  this.world=world
  for(const color of [0x34383d,0x55564e,0x1b1d2e]){
   const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(2.1,1.1,4.6),new THREE.MeshStandardMaterial({color,roughness:0.72,metalness:0.35}),48)
   mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false
   this.fleets.push(mesh);this.group.add(mesh)
  }
  this.ensurePopulation()
 }
 ensurePopulation(){
  const nodes=this.world.city.nodes,candidates=nodes.map((n,i)=>({n,i})).filter(({n})=>n.main&&n.adj.length)
  if(!candidates.length)return
  const desired=Math.min(96,Math.max(24,Math.floor(nodes.length/70)))
  while(this.agents.length<desired){
   const seed=this.agents.length+1,a=candidates[(seed*7919)%candidates.length].i,b=nodes[a].adj[0]
   this.agents.push({a,b,distance:0,speed:12,seed,kind:seed%3,pos:new THREE.Vector3(nodes[a].x,1.3,nodes[a].z),near:false,cooldown:0})
  }
 }
 update(dt:number,player:THREE.Vector3,playerSpeed=0,heat=0):TrafficEvents {
  const events={nearMisses:0,impact:0,boxed:false},nodes=this.world.city.nodes,counts=[0,0,0]
  let closeHostiles=0
  for(const car of this.agents){
   car.cooldown=Math.max(0,car.cooldown-dt)
   let a=nodes[car.a],b=nodes[car.b],len=Math.hypot(b.x-a.x,b.z-a.z)||1
   const d=player.distanceTo(car.pos),hostile=car.kind===2&&heat>0.75
   const wanted=car.kind===1?8:car.kind===0?22:hostile?30:14
   car.speed+=(wanted-car.speed)*Math.min(1,dt*2);car.distance+=car.speed*dt
   for(let guard=0;car.distance>=len&&guard<12;guard++){
    car.distance-=len
    const opts=b.adj.filter(n=>n!==car.a),prev=car.a
    car.a=car.b
    if(hostile)opts.sort((i,j)=>Math.hypot(nodes[i].x-player.x,nodes[i].z-player.z)-Math.hypot(nodes[j].x-player.x,nodes[j].z-player.z))
    car.b=opts.length?opts[hostile?0:car.seed%opts.length]:prev
    a=nodes[car.a];b=nodes[car.b];len=Math.hypot(b.x-a.x,b.z-a.z)||1
   }
   const t=Math.min(1,car.distance/len),heading=Math.atan2(b.x-a.x,b.z-a.z)
   let lane=car.seed%2?3.2:-3.2
   if(d<15&&playerSpeed>25&&!hostile)lane*=1.12
   if(hostile&&d<15){lane=0;closeHostiles++}
   car.pos.set(a.x+(b.x-a.x)*t+Math.cos(heading)*lane,(a.y??0)*(1-t)+(b.y??0)*t+1.3,a.z+(b.z-a.z)*t-Math.sin(heading)*lane)
   if(dt>0){
    const hit=player.distanceTo(car.pos)<(car.kind===1?3.1:2.1)
    if(hit&&car.cooldown===0){events.impact=Math.max(events.impact,Math.max(4,Math.abs(playerSpeed-car.speed)));car.cooldown=1}
    if(d<6&&!hit)car.near=true
    if(d>9&&car.near){if(playerSpeed>25&&car.cooldown===0)events.nearMisses++;car.near=false}
   }
   this.rotation.setFromAxisAngle(this.up,heading)
   const scale=car.kind===1?new THREE.Vector3(1.25,2,1.8):car.kind===0?new THREE.Vector3(0.7,0.5,0.8):new THREE.Vector3(1,1,1)
   this.matrix.compose(car.pos,this.rotation,scale)
   this.fleets[car.kind].setMatrixAt(counts[car.kind]++,this.matrix)
  }
  for(let i=0;i<3;i++){this.fleets[i].count=counts[i];this.fleets[i].instanceMatrix.needsUpdate=true}
  events.boxed=closeHostiles>=3&&playerSpeed<2
  return events
 }
 dispose(){for(const mesh of this.fleets){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose()}}
}
