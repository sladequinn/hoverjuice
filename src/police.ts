import * as THREE from 'three'
import type {World} from './world'
import {PhysicalWorld,clipBuildings,type Body,type Point} from './physical'
import {localTrip} from './traffic'
export type PursuitState='patrol'|'suspicion'|'stop'|'pursuit'|'search'|'escaped'
interface Unit {id:number;a:number;b:number;s:number;speed:number;heading:number;pos:THREE.Vector3;path:number[];stun:number;block:boolean;goal?:number}
/** Local road-based law enforcement. No authority over global wallets, freight or remote players. */
export class PoliceSystem {
 group=new THREE.Group();roadCandidates:readonly number[]|null=null;state:PursuitState='patrol';units:Unit[]=[];message='Dispatch: no active pursuit.';busted=false;heatDelta=0;lastSeen=new THREE.Vector3();private lost=0;private suspicion=0;private stopTime=0;private custody=0;private cooldown=0;private spawnClock=0;private routeClock=0;private time=0;private crime=0;private target=0;private nextId=1;private physics=new PhysicalWorld();private world:World;private mesh:THREE.InstancedMesh;private lights:THREE.InstancedMesh;private dummy=new THREE.Object3D();private tint=new THREE.Color()
 constructor(world:World){this.world=world;this.mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1.3,.65,2.65),new THREE.MeshStandardMaterial({color:0x172538,roughness:.5}),6);this.lights=new THREE.InstancedMesh(new THREE.BoxGeometry(.95,.13,.3),new THREE.MeshBasicMaterial({color:0xffffff}),6);this.mesh.count=this.lights.count=0;this.group.add(this.mesh,this.lights)}
 reset(){this.state='patrol';this.lost=this.suspicion=this.stopTime=this.custody=this.crime=0;this.cooldown=20;this.busted=false;this.message='Dispatch: incident closed. Units return to patrol.';for(const u of this.units){u.block=false;u.path=[]}}
 reportCrash(severity:number){if(severity>7)this.crime=6}
 private transition(next:PursuitState){if(this.state===next)return;this.state=next;this.message=next==='suspicion'?'Patrol has visual on reckless driving. Observing.':next==='stop'?'Traffic stop: pull over and remain stationary.':next==='pursuit'?'Active pursuit. Units following the suspect.':next==='search'?'Visual lost. Searching the last known location.':next==='escaped'?'Search discontinued. Suspect escaped.':'Dispatch: no active pursuit.'}
 private nearest(p:Point){let best=Infinity,id=0;for(let i=0;i<this.world.city.nodes.length;i++){const n=this.world.city.nodes[i];if(!n.main||!n.adj.length)continue;const d=(n.x-p.x)**2+(n.z-p.z)**2;if(d<best){best=d;id=i}}return id}
 sees(unit:Unit,p:Point){const d=unit.pos.distanceTo(new THREE.Vector3(p.x,p.y,p.z)),range=this.state==='pursuit'?190:120;if(d>range||Math.abs(unit.pos.y-p.y)>7)return false;const dx=p.x-unit.pos.x,dz=p.z-unit.pos.z;if(this.state!=='pursuit'&&d>15&&(dx*Math.sin(unit.heading)+dz*Math.cos(unit.heading))/(d||1)<.1)return false;const steps=Math.ceil(d/3);for(let i=1;i<steps;i++){const t=i/steps;if(this.world.hitBuilding(unit.pos.x+dx*t,unit.pos.z+dz*t,unit.pos.y+(p.y-unit.pos.y)*t)>=0)return false}return true}
 private spawn(p:Point){const nodes=this.world.city.nodes;for(let k=0;k<Math.min(nodes.length,512);k++){const i=this.roadCandidates?.length?this.roadCandidates[(k+this.nextId*17)%this.roadCandidates.length]:(k+this.nextId*97)%nodes.length,n=nodes[i],d=Math.hypot(n.x-p.x,n.z-p.z);if(!n.main||!n.adj.length||n.tunnel||d<160||d>450||this.units.some(u=>Math.hypot(u.pos.x-n.x,u.pos.z-n.z)<20))continue;this.units.push({id:this.nextId++,a:i,b:n.adj[0],s:0,speed:10,heading:0,pos:new THREE.Vector3(n.x,(n.y??0)+1.1,n.z),path:[],stun:0,block:false});return}}
 update(dt:number,p:Point,speed:number,heat:number,heading=0,obstacles:Body[]=[]){if(dt<=0)return;dt=Math.min(.1,dt);this.time+=dt;this.heatDelta=0;this.crime=Math.max(0,this.crime-dt);this.cooldown=Math.max(0,this.cooldown-dt);this.spawnClock-=dt;this.routeClock-=dt
  this.units=this.units.filter(u=>u.pos.distanceTo(new THREE.Vector3(p.x,p.y,p.z))<1000)
  const wanted=this.state==='pursuit'?Math.min(6,2+Math.floor(heat)):2
  if(this.units.length<wanted&&this.spawnClock<=0){this.spawnClock=8;this.spawn(p)}
  const visible=this.units.filter(u=>this.sees(u,p)),seen=visible.length>0,offence=heat>.4||speed>30||this.crime>0
  if(seen&&this.cooldown===0&&offence&&['patrol','escaped'].includes(this.state)){this.transition('suspicion');this.suspicion=0}
  if(this.state==='suspicion'){this.suspicion=seen&&offence?this.suspicion+dt:Math.max(0,this.suspicion-dt*2);if(this.suspicion>2){this.transition(heat>=2?'pursuit':'stop');this.stopTime=0;this.heatDelta=.5}else if(!seen&&this.suspicion===0)this.transition('patrol')}
  if(this.state==='stop'){this.stopTime+=dt;if(this.stopTime>8&&speed>5||heat>=2){this.transition('pursuit');this.heatDelta=1}}
  if(['stop','pursuit','search'].includes(this.state)){
   if(seen){this.lastSeen.set(p.x,p.y,p.z);this.lost=0;if(this.state==='search')this.transition('pursuit')}else this.lost+=dt
   if(this.lost>12&&this.state!=='search')this.transition('search')
   if(this.lost>32){this.transition('escaped');this.cooldown=25;this.heatDelta=-heat;this.custody=0}
   this.custody=seen&&speed<2&&visible.some(u=>u.pos.distanceTo(new THREE.Vector3(p.x,p.y,p.z))<12)?this.custody+dt:0
   if(this.custody>=4){this.busted=true;this.reset();this.busted=true}
  }
  if(seen&&['stop','pursuit'].includes(this.state))this.lastSeen.set(p.x,p.y,p.z)
  const routing=this.routeClock<=0;if(routing){this.routeClock=1;this.target=this.nearest(this.state==='search'?this.lastSeen:p)}
  const nodes=this.world.city.nodes;this.physics.setBodies([...obstacles,...this.bodies()])
  for(const [index,u]of this.units.entries()){
   const before=u.pos.clone();const chasing=['stop','pursuit','search'].includes(this.state);u.stun=Math.max(0,u.stun-dt)
   if(routing&&chasing){let goal=this.target;const wasBlock=u.block;u.block=this.state==='pursuit'&&heat>=4&&index>=3;if(u.block&&!wasBlock)u.goal=undefined;if(u.block&&u.goal!==undefined)goal=u.goal;else if(u.block){const ahead={x:this.lastSeen.x+Math.sin(heading)*90,y:p.y,z:this.lastSeen.z+Math.cos(heading)*90};goal=this.nearest(ahead)}u.goal=goal;u.path=localTrip(nodes,u.b,goal,512)??[]}
   if(!chasing)u.block=false
   let a=nodes[u.a],b=nodes[u.b],len=Math.hypot(b.x-a.x,b.z-a.z)||1
   const distance=u.pos.distanceTo(new THREE.Vector3(p.x,p.y,p.z)),arrived=u.block&&u.goal!==undefined&&Math.hypot(u.pos.x-nodes[u.goal].x,u.pos.z-nodes[u.goal].z)<5,targetSpeed=u.stun>0||arrived?0:this.state==='stop'&&distance<10?0:chasing?Math.min(48,28+heat*4):12
   u.speed+=(targetSpeed-u.speed)*Math.min(1,dt*3);u.s+=u.speed*dt;if(u.block&&u.b===u.goal&&u.s>len-2){u.s=Math.max(0,len-2);u.speed=0}
   for(let guard=0;u.s>=len&&guard<8;guard++){u.s-=len;const prev=u.a;u.a=u.b;const pathIndex=u.path.indexOf(u.a),next=u.path[pathIndex+1],options=b.adj.filter(n=>n!==prev);u.b=next!==undefined&&b.adj.includes(next)?next:options[(u.id+Math.floor(this.time/20))%options.length]??prev;a=nodes[u.a];b=nodes[u.b];len=Math.hypot(b.x-a.x,b.z-a.z)||1}
   u.heading=Math.atan2(b.x-a.x,b.z-a.z);const t=Math.min(1,u.s/len);u.pos.set(a.x+(b.x-a.x)*t+Math.cos(u.heading)*.7,(a.y??0)*(1-t)+(b.y??0)*t+1.1,a.z+(b.z-a.z)*t-Math.sin(u.heading)*.7)
   const driver={id:'police:'+u.id,x:u.pos.x,y:u.pos.y,z:u.pos.z,heading:u.heading,halfW:.68,halfL:1.4,vx:Math.sin(u.heading)*u.speed,vz:Math.cos(u.heading)*u.speed,mass:1600},hit=this.physics.solve(driver,before,dt),wall=clipBuildings(this.world,before,driver,u.heading,.68,1.4)
   if(hit.hits||wall){u.pos.set(wall?.x??driver.x,driver.y,wall?.z??driver.z);u.s=Math.max(0,Math.min(len,((u.pos.x-a.x)*(b.x-a.x)+(u.pos.z-a.z)*(b.z-a.z))/len));u.speed=wall?0:Math.max(0,driver.vx*Math.sin(u.heading)+driver.vz*Math.cos(u.heading));u.stun=.35}
   this.dummy.position.copy(u.pos);this.dummy.rotation.set(0,u.heading,0);this.dummy.updateMatrix();this.mesh.setMatrixAt(index,this.dummy.matrix);this.dummy.position.y+=.43;this.dummy.updateMatrix();this.lights.setMatrixAt(index,this.dummy.matrix);this.tint.set(chasing?(Math.floor(this.time*6+index)%2?'#ff364b':'#438bff'):'#788899');this.lights.setColorAt(index,this.tint)
  }this.mesh.count=this.lights.count=this.units.length;this.mesh.instanceMatrix.needsUpdate=this.lights.instanceMatrix.needsUpdate=true;if(this.lights.instanceColor)this.lights.instanceColor.needsUpdate=true
 }
 bodies():Body[]{return this.units.map(u=>({id:'police:'+u.id,x:u.pos.x,y:u.pos.y,z:u.pos.z,heading:u.heading,halfW:.68,halfL:1.4,vx:Math.sin(u.heading)*u.speed,vz:Math.cos(u.heading)*u.speed,mass:1600,push:(vx,vz,dx,dz)=>{u.speed=Math.max(0,u.speed+(vx*Math.sin(u.heading)+vz*Math.cos(u.heading)));u.s=Math.max(0,u.s+dx*Math.sin(u.heading)+dz*Math.cos(u.heading));u.stun=Math.min(2,Math.hypot(vx,vz)/8)}}))}
 get active(){return ['stop','pursuit','search'].includes(this.state)}
 dispose(){for(const m of [this.mesh,this.lights]){m.geometry.dispose();(m.material as THREE.Material).dispose()}this.units=[];this.group.clear()}
}
