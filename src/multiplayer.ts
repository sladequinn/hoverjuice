import * as THREE from 'three'
import {buildVehicleMesh,type Player} from './vehicle'
import {PAINTS} from './customization'
import {vehicleById} from './data'
import {worldToLatLon,type CityData} from './map'
import type {World} from './world'
import type {HoverjuiceSpray} from './hoverjuice'
import {RealtimeConnection} from './multiplayer-transport'
import {samplePeer,type TimedPresence} from './peer-motion'
import {distance,wrapLon,validMove,validId,validName,validRace,VIEW_METRES,type Presence,type RaceView} from '../shared/multiplayer'
interface Peer {group:THREE.Group;history:TimedPresence[];appearance:string;pending:boolean;label:THREE.Sprite|null;epoch:number;seq:number;name:string;built:boolean;initialized:boolean}
/** Render ghosts share local terrain but never apply network latency to local physics. */
export class Multiplayer {
 group=new THREE.Group()
 private checkpoint=new THREE.Mesh(new THREE.TorusGeometry(12,.5,6,32),new THREE.MeshBasicMaterial({color:0x73ffcb}))
 raceStatus=''
 status='CONNECTING'
 race:RaceView|null=null
 notice=''
 id=''
 private peers=new Map<string,Peer>()

 private queue=new Map<string,()=>void>()
 private meshTimer:ReturnType<typeof setInterval>
 private disposed=false
 private maxPeers=matchMedia('(pointer: coarse)').matches?12:24
 private city:CityData
 connection:RealtimeConnection
 private visibility=()=>{if(document.hidden)this.connection.pause();else void this.connection.start()}
 constructor(city:CityData){
  this.city=city
  this.checkpoint.rotation.x=-Math.PI/2;this.checkpoint.visible=false;this.group.add(this.checkpoint)
  this.connection=new RealtimeConnection(city,{peerLimit:this.maxPeers,fetch:fetch.bind(globalThis),socket:url=>new WebSocket(url),origin:location.origin,status:status=>this.status=status,message:data=>this.receive(data)})
  this.meshTimer=setInterval(()=>{const next=this.queue.entries().next().value;if(next){this.queue.delete(next[0]);next[1]()}},40)
  document.addEventListener('visibilitychange',this.visibility)
  void this.connection.start()
 }
 private receive(data:any){
  if(data.type==='freight'){window.dispatchEvent(new CustomEvent('hoverghini:freight',{detail:data.freight}));return}
  if(data.type==='property-changed'){window.dispatchEvent(new Event('hoverghini:property-changed'));return}
  if(data.type==='welcome'&&validId(data.id)){
   this.id=data.id
   for(const id of [...this.peers.keys()])this.remove(id)
   const race=localStorage.getItem('hoverghini.race')
   if(validId(race))setTimeout(()=>{if(!this.disposed)this.connection.send({type:'race-join',id:race})},500)
   return
  }
  if(data.type==='status'||data.type==='rejected'){this.notice=String(data.message??'');return}
  if(data.type==='race'&&(data.race===null||validRace(data.race))){
   this.race=data.race
   if(this.race)localStorage.setItem('hoverghini.race',this.race.id);else localStorage.removeItem('hoverghini.race')
   return
  }
  if(data.type==='remove'){const p=this.peers.get(data.id);if(p?.epoch===data.epoch)this.remove(data.id);return}
  const state=data.peer as Presence
  if(data.type!=='peer'||!state||!validId(state.id)||state.id===this.id||!validName(state.name)||!Number.isSafeInteger(state.epoch)||!Number.isFinite(state.at))return
  const {id:_,name:__,epoch:___,at:____,crewTag:_____,...move}=state
  if(!validMove(move)||(state.crewTag!==undefined&&!/^[A-Z0-9]{2,5}$/.test(state.crewTag)))return
  let peer=this.peers.get(state.id)
  if(peer&&(state.epoch<peer.epoch||(state.epoch===peer.epoch&&state.seq<=peer.seq)))return
  if(!peer){
   if(this.peers.size>=this.maxPeers){const oldest=[...this.peers].sort((a,b)=>a[1].history.at(-1)!.received-b[1].history.at(-1)!.received)[0];this.remove(oldest[0])}
   peer={group:new THREE.Group(),history:[],appearance:'',pending:false,label:null,epoch:state.epoch,seq:-1,name:state.name,built:false,initialized:false};this.peers.set(state.id,peer);this.group.add(peer.group)
  }
  if(peer.epoch!==state.epoch){peer.history=[];peer.initialized=false}
  peer.epoch=state.epoch;peer.seq=state.seq;peer.name=state.name
  peer.history.push({state,received:performance.now()});if(peer.history.length>8)peer.history.shift()
  const appearance=`${state.chassis}:${state.mask}:${state.paint}:${state.name}:${state.crewTag??''}`
  if(peer.appearance!==appearance&&!peer.pending){peer.pending=true;const target=peer;this.queue.set(state.id,()=>{if(this.disposed||this.peers.get(state.id)!==target)return;target.pending=false;this.build(target,state,appearance)})}
 }
 private build(peer:Peer,state:Presence,appearance:string){
  const spec={...vehicleById(state.chassis)},paint=PAINTS.find(p=>p.id===state.paint);if(paint)spec.body=paint.color
  this.disposeMesh(peer.group)
  peer.group.clear();peer.group.add(buildVehicleMesh(spec,state.mask));peer.appearance=appearance;peer.built=true
  const canvas=document.createElement('canvas');canvas.width=384;canvas.height=64
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='rgba(5,12,20,.8)';ctx.fillRect(0,0,384,64);ctx.fillStyle='#c5fff0';ctx.font='bold 28px sans-serif';ctx.textAlign='center';ctx.fillText(`${state.crewTag?'['+state.crewTag+'] ':''}${state.name} · ${state.id.slice(0,4)}`,192,42,370)
  const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthWrite:false}))
  label.position.y=3;label.scale.set(9,1.5,1);peer.group.add(label);peer.label=label
 }
 private remove(id:string){const p=this.peers.get(id);if(!p)return;p.group.removeFromParent();this.queue.delete(id);this.disposeMesh(p.group);this.peers.delete(id)}
 update(dt:number,player:Player,spray?:HoverjuiceSpray,world?:World,sprayDt=dt,paint='factory'){
  if(!world)return
  const pos=worldToLatLon(this.city,player.pos.x,player.pos.z),ground=world.groundHeightAt(player.pos.x,player.pos.z,player.pos.y)
  const velocity=player.mode==='mag'?{x:Math.sin(player.heading)*player.speed,z:Math.cos(player.heading)*player.speed}:{x:player.vel.x,z:player.vel.y}
  const round=(n:number,d=100)=>Math.round(n*d)/d
  this.connection.sample({type:'move',v:1,lat:round(pos.lat,1e7),lon:round(wrapLon(pos.lon),1e7),y:round(player.pos.y+(this.city.terrain?.datum??0)),clearance:Math.max(0,round(player.pos.y-ground)),yaw:round(Math.atan2(Math.sin(player.heading),Math.cos(player.heading)),1000),vx:round(velocity.x,10),vz:round(velocity.z,10),chassis:player.spec.id,mask:player.mask,paint,boost:player.boosting})
  const now=performance.now()
  this.checkpoint.visible=false;this.raceStatus=''
  const race=this.race,entry=race?.racers.find(p=>p.id===this.id)
  if(race&&entry){
   const point=race.course[entry.checkpoint],countdown=Math.ceil((race.startsAt-Date.now())/1000)
   this.raceStatus=entry.finished!==null?`FINISH ${(entry.finished/1000).toFixed(1)}s`:race.status==='waiting'?'RACE LOBBY':countdown>0?`START IN ${countdown}`:`CHECKPOINT ${entry.checkpoint+1}/${race.course.length}`
   if(point&&race.status!=='finished'){
    const x=wrapLon(point.lon-this.city.lon)*111320*Math.cos(this.city.lat*Math.PI/180),z=(this.city.lat-point.lat)*110540
    this.checkpoint.position.set(x,world.groundHeightAt(x,z,player.pos.y)+1,z);this.checkpoint.visible=true
    const bearing=Math.atan2(x-player.pos.x,z-player.pos.z)-player.heading
    this.raceStatus+=` · ${Math.round(distance(pos,point))}m ${Math.cos(bearing)>.8?'↑':Math.cos(bearing)<-.8?'↓':Math.sin(bearing)>0?'→':'←'}`
   }
  }
  for(const [id,peer]of this.peers){
   const latest=peer.history.at(-1)!,age=now-latest.received
   if(age>5000){this.remove(id);continue}
   const p=samplePeer(peer.history,now)!,near=distance(pos,p)
   peer.group.visible=near<VIEW_METRES&&age<3500&&peer.built
   if(!peer.group.visible)continue
   const x=wrapLon(p.lon-this.city.lon)*111320*Math.cos(this.city.lat*Math.PI/180),z=(this.city.lat-p.lat)*110540,ref=p.y-(this.city.terrain?.datum??0)
   const height=world.groundHeightAt(x,z,ref),y=p.clearance<5?height+p.clearance:Math.max(height+.3,ref)
   const target=new THREE.Vector3(x,y,z)
   // Do not extrapolate a ghost through a nearby building; hold the last render pose.
   if(world.hitBuilding(x,z,y)<0||!peer.initialized){if(!peer.initialized){peer.group.position.copy(target);peer.initialized=true}else peer.group.position.lerp(target,1-Math.exp(-18*dt))}
   peer.group.rotation.y=p.yaw
   if(peer.label)peer.label.visible=near<160
   if(near<55)spray?.emit(peer,sprayDt,peer.group.position,p.yaw,Math.hypot(p.vx,p.vz),.6,1.2,height,p.boost,.3)
  }
 }
 get count(){return this.peers.size}
 reconnect(){this.connection.pause();void this.connection.start()}

 private disposeMesh(mesh:THREE.Group){
  const rider=mesh.getObjectByName('rider');if(rider){rider.removeFromParent();rider.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose()})}
  const materials=new Set<THREE.Material>();mesh.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Sprite){if(o instanceof THREE.Mesh)o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)}})
  materials.forEach(m=>{if(m instanceof THREE.SpriteMaterial)m.map?.dispose();m.dispose()})
 }
 dispose(){this.disposed=true;clearInterval(this.meshTimer);document.removeEventListener('visibilitychange',this.visibility);this.connection.dispose();this.checkpoint.geometry.dispose();this.checkpoint.material.dispose();this.queue.clear();for(const id of [...this.peers.keys()])this.remove(id)}
}
