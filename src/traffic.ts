import {VEHICLE_SCALE} from './data'
import {PAINTS} from './customization'
import {GANG_INFO} from './gangs'
import type {Gang} from './filter'
import * as THREE from 'three'
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { World } from './world'
import type { HoverjuiceSpray } from './hoverjuice'
interface Site {id:string;node:number;next:number;x:number;y:number;z:number;heading:number;gang?:Gang;occupant:number|null}
interface Agent {a:number;b:number;distance:number;speed:number;seed:number;kind:number;pos:THREE.Vector3;near:boolean;cooldown:number;horn:number;heading:number;leader:Agent|null;site:Site|null;phase:'drive'|'enter'|'park'|'exit';progress:number;wait:number;visits:number;turns:number;from:THREE.Vector3}
export interface TrafficEvents {nearMisses:number;impact:number;boxed:boolean;horn?:{distance:number;side:number;freight:boolean}}
export interface ActivityDealer {id:string;node:number;x:number;z:number;gang:Gang}
function fleetGeometry(kind:number){
 const parts:THREE.BufferGeometry[]=[]
 const box=(w:number,h:number,l:number,x:number,y:number,z:number,color:number)=>{
  const g=new THREE.BoxGeometry(w,h,l).toNonIndexed();g.translate(x,y,z)
  const c=new THREE.Color(color),colors=new Float32Array(g.attributes.position.count*3)
  for(let i=0;i<colors.length;i+=3){colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b}
  g.setAttribute('color',new THREE.BufferAttribute(colors,3));parts.push(g)
 }
 box(2.1,.65,4.6,0,0,0,0xffffff)
 box(kind===1?1.85:1.6,kind===1?.85:.5,kind===1?2.7:2.25,0,.55,kind===1?-.6:-.2,kind===1?0xaeb9bd:0x30434e)
 for(const side of [-1,1]){box(.5,.12,.08,side*.68,.12,2.32,0xfff2cb);box(.55,.1,.08,side*.65,.1,-2.32,0xff5a31);box(.18,.18,2.8,side*1.06,-.15,-.1,0x354c58)}
 const merged=mergeGeometries(parts)!;parts.forEach(p=>p.dispose());return merged
}
/** Bounded vehicle pool with road queues, local trips and reservable venue parking. */
export class TrafficSystem {
 group=new THREE.Group()
 private agents:Agent[]=[]
 private world:World
 private fleets:THREE.InstancedMesh[]=[]
 private matrix=new THREE.Matrix4()
 private rotation=new THREE.Quaternion()
 private scale=new THREE.Vector3()
 private tint=new THREE.Color()
 private nearby:number[]=[]
 private sites:Site[]=[]
 private recycleClock=0
 private time=0
 private queues=new Map<string,Agent[]>()
 private junctions=new Map<number,{seed:number;until:number}>()
 private up=new THREE.Vector3(0,1,0)
 constructor(world:World){
  this.world=world
  for(let kind=0;kind<3;kind++){
   const mesh=new THREE.InstancedMesh(fleetGeometry(kind),new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.65,metalness:.18}),64)
   mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false
   this.fleets.push(mesh);this.group.add(mesh)
  }
  this.ensurePopulation()
 }
 ensurePopulation(){
  const nodes=this.world.city.nodes,candidates=nodes.map((n,i)=>({n,i})).filter(({n})=>n.main&&n.adj.length)
  if(!candidates.length)return
  const desired=Math.min(192,Math.max(72,Math.floor(nodes.length/35)))
  while(this.agents.length<desired){
   const seed=this.agents.length+1,a=candidates[(seed*7919)%candidates.length].i,b=nodes[a].adj[0]
   this.agents.push({a,b,distance:Math.hypot(nodes[b].x-nodes[a].x,nodes[b].z-nodes[a].z)*((seed*.61803398875)%1),speed:12,seed,kind:seed%3,pos:new THREE.Vector3(nodes[a].x,(nodes[a].y??0)+1.3,nodes[a].z),near:false,cooldown:0,horn:0,heading:0,leader:null,site:null,phase:'drive',progress:0,wait:0,visits:0,turns:0,from:new THREE.Vector3()})
  }
 }
 /** Keep existing reservations while streamed dealers and fuel sites change. */
 setActivitySites(dealers:readonly ActivityDealer[],center:THREE.Vector3){
  const nodes=this.world.city.nodes,previous=new Map(this.sites.map(s=>[s.id,s])),next:Site[]=[]
  for(const car of this.agents)if(car.site)previous.set(car.site.id,car.site)
  const venues=[...(this.world.pumps??[]).map(p=>({...p,id:`fuel:${p.node}`,gang:undefined as Gang|undefined})),...dealers]
   .filter(p=>Math.hypot(p.x-center.x,p.z-center.z)<900).sort((a,b)=>Math.hypot(a.x-center.x,a.z-center.z)-Math.hypot(b.x-center.x,b.z-center.z)).slice(0,8)
  for(const venue of venues){
   const node=nodes[venue.node];if(!node?.adj.length||Math.hypot(node.x-venue.x,node.z-venue.z)>60||node.tunnel||Math.abs((node.y??0)-(this.world.city.terrain?.heightAt(node.x,node.z)??0))>.5)continue
   const adjacent=node.adj[0],b=nodes[adjacent],heading=Math.atan2(b.x-node.x,b.z-node.z)
   for(let slot=0;slot<2;slot++){
    const id=`${venue.id}:${venue.node}:${slot}`
    if(previous.has(id)){next.push(previous.get(id)!);continue}
    // Pull into a clear shoulder along the connected road, leaving the dealer/pump entrance clear.
    const along=6+slot*5,offset=(node.width??5)/2+1.25
    if(Math.hypot(b.x-node.x,b.z-node.z)<along+4)continue
    for(const side of [1,-1]){
     const x=node.x+Math.sin(heading)*along+Math.cos(heading)*offset*side,z=node.z+Math.cos(heading)*along-Math.sin(heading)*offset*side
     if(dealers.some(d=>Math.hypot(d.x-x,d.z-z)<4))continue
     let clear=true
     for(const l of [-2.5,0,2.5])for(const w of [-.9,0,.9]){
      const px=x+Math.sin(heading)*l+Math.cos(heading)*w,pz=z+Math.cos(heading)*l-Math.sin(heading)*w
      if(this.world.isWater(px,pz)||this.world.hitBuilding(px,pz,(this.world.city.terrain?.heightAt(px,pz)??0)+1)>=0)clear=false
     }
     // Also validate the short approach so visitors do not cut through a facade.
     for(let step=0;step<=8;step++){const t=step/8,px=node.x+(x-node.x)*t,pz=node.z+(z-node.z)*t;if(this.world.isWater(px,pz)||this.world.hitBuilding(px,pz,(this.world.city.terrain?.heightAt(px,pz)??0)+1)>=0)clear=false}
     if(clear){next.push({id,node:venue.node,next:adjacent,x,y:(this.world.city.terrain?.heightAt(x,z)??node.y??0)+1.3,z,heading,gang:venue.gang,occupant:null});break}
    }
   }
  }
  this.sites=next
 }
 /** Initial placement happens before the city is shown; live recycling stays outside the near field. */
 prime(player:THREE.Vector3){
  const nodes=this.world.city.nodes,near=nodes.map((n,i)=>({n,i})).filter(({n})=>n.main&&n.adj.length&&Math.hypot(n.x-player.x,n.z-player.z)>35&&Math.hypot(n.x-player.x,n.z-player.z)<280)
  if(near.length)for(let i=0;i<Math.min(48,this.agents.length);i++){
   const car=this.agents[i],pick=near[(i*17)%near.length];car.a=pick.i;car.b=pick.n.adj[i%pick.n.adj.length];car.distance=Math.hypot(nodes[car.b].x-pick.n.x,nodes[car.b].z-pick.n.z)*((i*.618)%1)
  }
  for(const site of this.sites){
   const car=this.agents.find(c=>!c.site&&c.kind!==(site.gang?1:2));if(!car)break
   car.site=site;site.occupant=car.seed;car.phase='park';car.wait=8+car.seed%12;car.speed=0;car.pos.set(site.x,site.y,site.z);car.heading=site.heading
  }
  this.update(0,player)
 }
 private release(car:Agent){if(car.site?.occupant===car.seed)car.site.occupant=null;car.site=null;car.phase='drive';car.progress=0;car.wait=0;car.turns=0}
 private assignTrip(car:Agent){
  if(car.site||car.wait>0)return
  const choices=this.sites.filter(s=>s.occupant===null&&Math.hypot(s.x-car.pos.x,s.z-car.pos.z)<650&&(car.kind===2?!!s.gang:true))
  if(!choices.length)return
  const site=choices[(car.seed+car.visits)%choices.length];site.occupant=car.seed;car.site=site;car.turns=0
 }
 update(dt:number,player:THREE.Vector3,playerSpeed=0,heat=0,spray?:HoverjuiceSpray):TrafficEvents {
  dt=Math.min(.1,Math.max(0,dt));this.time+=dt
  const events:TrafficEvents={nearMisses:0,impact:0,boxed:false},nodes=this.world.city.nodes,counts=[0,0,0]
  let closeHostiles=0
  this.recycleClock-=dt
  if(dt>0&&this.recycleClock<=0){
   this.recycleClock=.5;const nearby=this.nearby;nearby.length=0
   for(let i=0;i<nodes.length;i++){const n=nodes[i];if(!n.main||!n.adj.length)continue;const d=(n.x-player.x)**2+(n.z-player.z)**2;if(d>110**2&&d<400**2)nearby.push(i)}
   let budget=3
   for(const car of this.agents){
    if(nearby.length&&budget>0&&car.pos.distanceToSquared(player)>650**2){
     this.release(car);const pick=nearby[(car.seed*7919)%nearby.length];car.a=pick;car.b=nodes[pick].adj[(car.seed+car.visits)%nodes[pick].adj.length];car.distance=0;car.near=false;car.cooldown=1;car.speed=10;budget--
    }
    if(car.phase==='drive'&&car.seed%3!==1)this.assignTrip(car)
   }
   for(const [id,reservation] of this.junctions)if(reservation.until<this.time)this.junctions.delete(id)
  }
  this.queues.clear()
  for(const car of this.agents){car.leader=null;if(car.phase!=='drive')continue;const key=`${car.a}:${car.b}`,queue=this.queues.get(key)??[];queue.push(car);this.queues.set(key,queue)}
  for(const queue of this.queues.values()){queue.sort((a,b)=>b.distance-a.distance);for(let i=1;i<queue.length;i++)queue[i].leader=queue[i-1]}
  for(const car of this.agents){
   car.cooldown=Math.max(0,car.cooldown-dt);car.horn=Math.max(0,car.horn-dt)
   const d=player.distanceTo(car.pos),hostile=car.kind===2&&heat>.75
   if(hostile&&car.phase==='drive'&&car.site)this.release(car)
   if(car.phase!=='drive'&&car.site){
    const site=car.site
    if(car.phase==='park'){
     car.wait-=dt;car.speed=0
     if(car.wait<=0){car.phase='exit';car.progress=0;car.from.copy(car.pos)}
    }else{
     const node=nodes[site.node],next=nodes[site.next],len=Math.hypot(next.x-node.x,next.z-node.z)||1
     const mergeAt=Math.min(len-1,6),lane=Math.max(0,Math.min(1.2,Math.min(node.width??5,next.width??5)/2-1.32*VEHICLE_SCALE-.2)),mergeX=node.x+(next.x-node.x)*mergeAt/len+Math.cos(site.heading)*lane,mergeZ=node.z+(next.z-node.z)*mergeAt/len-Math.sin(site.heading)*lane
     const blocked=car.phase==='exit'&&(this.agents.some(other=>other!==car&&other.phase==='drive'&&Math.hypot(other.pos.x-mergeX,other.pos.z-mergeZ)<7)||Math.hypot(player.x-mergeX,player.z-mergeZ)<7)
     if(!blocked)car.progress=Math.min(1,car.progress+dt/(car.phase==='enter'?2.5:3))
     const t=car.progress*car.progress*(3-2*car.progress),targetX=car.phase==='enter'?site.x:mergeX,targetZ=car.phase==='enter'?site.z:mergeZ
     const targetY=car.phase==='enter'?site.y:(node.y??0)+((next.y??0)-(node.y??0))*mergeAt/len+1.3
     car.pos.set(car.from.x+(targetX-car.from.x)*t,car.from.y+(targetY-car.from.y)*t,car.from.z+(targetZ-car.from.z)*t);car.heading=site.heading;car.speed=blocked?0:3
     if(car.progress>=1){
      if(car.phase==='enter'){car.phase='park';car.wait=8+(car.seed+car.visits)%15;car.visits++}
      else{car.a=site.node;car.b=site.next;car.distance=mergeAt;this.release(car);car.wait=25;car.speed=4}
     }
    }
   }else{
    car.wait=Math.max(0,car.wait-dt)
    let a=nodes[car.a],b=nodes[car.b],len=Math.hypot(b.x-a.x,b.z-a.z)||1
    let wanted=car.kind===1?8:car.kind===0?(car.seed%2?23:14):hostile?30:12
    const leader=car.leader,gap=leader?leader.distance-car.distance:Infinity,safe=((car.kind===1?4.14:car.kind===0?1.955:2.3)+(leader?.kind===1?4.14:leader?.kind===0?1.955:2.3))*VEHICLE_SCALE+.8
    if(leader)wanted=Math.min(wanted,Math.max(0,(gap-safe)*1.5),leader.speed+Math.max(0,gap-12))
    const remaining=len-car.distance
    let junctionStop=Infinity
    if(b.adj.length>=3&&remaining<14){
     wanted=Math.min(wanted,7)
     const reservation=this.junctions.get(car.b)
     if(reservation&&reservation.seed!==car.seed&&reservation.until>this.time){wanted=Math.min(wanted,Math.max(0,(remaining-3)*2));junctionStop=Math.max(0,remaining-2.5)}
     else if(remaining<7&&dt>0)this.junctions.set(car.b,{seed:car.seed,until:this.time+1.8})
    }
    if(!hostile&&d<12&&playerSpeed<5)wanted=Math.min(wanted,Math.max(0,(d-3)*2))
    car.speed+=(wanted-car.speed)*Math.min(1,dt*(wanted<car.speed?6:1.5))
    car.distance+=Math.min(car.speed*dt,Math.max(0,gap-safe),junctionStop)
    for(let guard=0;car.distance>=len&&guard<12;guard++){
     if(car.site&&car.b===car.site.node){car.phase='enter';car.progress=0;car.from.copy(car.pos);car.distance=len;break}
     car.distance-=len
     const opts=b.adj.filter(n=>n!==car.a),prev=car.a;car.a=car.b;car.turns++
     if(car.site&&car.turns>30){this.release(car);car.wait=20}
     const target=hostile?player:car.site?nodes[car.site.node]:null
     if(target)opts.sort((i,j)=>Math.hypot(nodes[i].x-target.x,nodes[i].z-target.z)-Math.hypot(nodes[j].x-target.x,nodes[j].z-target.z))
     car.b=opts.length?opts[target?0:(car.seed+car.turns)%opts.length]:prev
     a=nodes[car.a];b=nodes[car.b];len=Math.hypot(b.x-a.x,b.z-a.z)||1
    }
    const t=Math.min(1,car.distance/len),heading=Math.atan2(b.x-a.x,b.z-a.z)
    const clearance=Math.max(0,Math.min(a.width??5,b.width??5)/2-(car.kind===1?1.32:car.kind===0?.74:1.05)*VEHICLE_SCALE-.2)
    let lane=Math.min(1.2,clearance)
    if(d<16&&playerSpeed>25&&!hostile){lane=Math.min(clearance,lane+.35);if(car.horn===0&&dt>0){events.horn??={distance:d,side:Math.sign(car.pos.x-player.x),freight:car.kind===1};car.horn=4}}
    if(hostile&&d<15){lane=0;closeHostiles++}
    car.pos.set(a.x+(b.x-a.x)*t+Math.cos(heading)*lane,(a.y??0)*(1-t)+(b.y??0)*t+1.3,a.z+(b.z-a.z)*t-Math.sin(heading)*lane)
    if(dt===0)car.heading=heading;else car.heading+=Math.atan2(Math.sin(heading-car.heading),Math.cos(heading-car.heading))*Math.min(1,dt*8)
   }
   if(dt>0){
    const nowDistance=player.distanceTo(car.pos),hit=nowDistance<(car.kind===1?3.1:2.1)*VEHICLE_SCALE
    if(hit&&car.cooldown===0){events.impact=Math.max(events.impact,Math.max(4,Math.abs(playerSpeed-car.speed)));car.cooldown=1}
    if(nowDistance<6&&!hit&&car.phase==='drive')car.near=true
    if(nowDistance>9&&car.near){if(playerSpeed>25&&car.cooldown===0)events.nearMisses++;car.near=false}
   }
   this.rotation.setFromAxisAngle(this.up,car.heading)
   const scale=car.kind===1?this.scale.set(1.25,1.5,1.8):car.kind===0?this.scale.set(.8,.8,.85):this.scale.set(1,1,1)
   this.matrix.compose(car.pos,this.rotation,scale.multiplyScalar(VEHICLE_SCALE))
   const slot=counts[car.kind]++;this.fleets[car.kind].setMatrixAt(slot,this.matrix)
   const gang=car.site?.gang
   this.tint.set(gang?GANG_INFO[gang].color:PAINTS[car.seed%PAINTS.length].color);this.fleets[car.kind].setColorAt(slot,this.tint)
   if(d<65)spray?.emit(car,dt,car.pos,car.heading,car.speed,1.05*scale.x,2.3*scale.z,car.pos.y-1.3,false,car.phase==='park'?.12:.35)
  }
  for(let i=0;i<3;i++){this.fleets[i].count=counts[i];this.fleets[i].instanceMatrix.needsUpdate=true;if(this.fleets[i].instanceColor)this.fleets[i].instanceColor!.needsUpdate=true}
  events.boxed=closeHostiles>=3&&playerSpeed<2
  return events
 }
 dispose(){for(const mesh of this.fleets){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose()}this.agents=[];this.sites=[];this.queues.clear();this.junctions.clear()}
}
