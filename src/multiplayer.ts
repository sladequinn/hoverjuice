import * as THREE from 'three'
import type { CityData } from './map'
import { worldToLatLon } from './map'
import { buildMask } from './character'
import type { Player } from './vehicle'
import { crewInvite, mercator, nearbyTiles, tileKey, unproject, validTelemetry, type Telemetry } from './spatial'

interface Peer {mesh:THREE.Group; state:Telemetry|null; received:number; mask:string}
/** Fixed render pool; only the owning tile receives 20Hz telemetry. Halo rooms are subscriptions. */
export class Multiplayer {
  group=new THREE.Group()
  status='OFFLINE'
  private sockets=new Map<string,WebSocket>()
  private peers=new Map<string,Peer>()
  private pool:Peer[]=[]
  private id=crypto.randomUUID()
  private seq=0
  private sendClock=0
  private roomClock=0
  private viewClock=0
  private disposed=false
  private crew=crewInvite(location.hash).crew
  private host=import.meta.env.VITE_PARTYKIT_HOST as string|undefined
  private geometry=new THREE.BoxGeometry(2.1,1.1,4.6)
  private material=new THREE.MeshStandardMaterial({color:0x34383d,roughness:0.6,metalness:0.5})
  constructor(privateCity:CityData) {
    this.city=privateCity
    for(let i=0;i<32;i++) {
      const mesh=new THREE.Group();mesh.add(new THREE.Mesh(this.geometry,this.material));mesh.visible=false
      this.group.add(mesh);this.pool.push({mesh,state:null,received:0,mask:''})
    }
    if(this.host)this.status='CONNECTING'
  }
  private city:CityData
  private connect(key:string) {
    if(!this.host||this.sockets.has(key)||this.disposed)return
    const base=this.host.replace(/^https?:\/\//,'').replace(/^wss?:\/\//,'').replace(/\/$/,'')
    const local=base.startsWith('localhost:')||base.startsWith('127.0.0.1:')
    const ws=new WebSocket(`${local?'ws':'wss'}://${base}/parties/main/${encodeURIComponent(key)}?peer=${this.id}`)
    this.sockets.set(key,ws)
    ws.onopen=()=>{this.status=this.crew?`CREW ${this.crew}`:'LOCAL PEERS'}
    ws.onmessage=e=>{
      let data:unknown;try{data=JSON.parse(String(e.data))}catch{return}
      if(!validTelemetry(data)||data.id===this.id)return
      let peer=this.peers.get(data.id)
      if(!peer){peer=this.pool.find(p=>!p.state);if(!peer)return;this.peers.set(data.id,peer)}
      if(peer.state&&data.seq<=peer.state.seq)return
      const first=!peer.state
      peer.state=data;peer.received=performance.now();peer.mesh.visible=true
      if(peer.mask!==data.maskId){const old=peer.mesh.getObjectByName('mask');if(old){old.traverse(o=>(o as THREE.Mesh).geometry?.dispose());peer.mesh.remove(old)}const mask=buildMask(data.maskId);mask.name='mask';mask.position.set(0,0.9,1);peer.mesh.add(mask);peer.mask=data.maskId}
      peer.mesh.scale.setScalar(data.chassisId==='board'?0.6:data.chassisId==='z150'?1.4:1)
      if(first)peer.mesh.position.copy(this.local(data))
    }
    ws.onerror=()=>{this.status='RECONNECTING'}
    ws.onclose=()=>{if(this.sockets.get(key)===ws)this.sockets.delete(key);if(!this.disposed)this.status='RECONNECTING'}
  }
  private local(p:{x:number;y:number;z:number}) {
    const ll=unproject(p.x,p.z)
    return new THREE.Vector3((ll.lon-this.city.lon)*111320*Math.cos(this.city.lat*Math.PI/180),p.y,(this.city.lat-ll.lat)*110540)
  }
  update(dt:number,player:Player) {
    if(!this.host)return
    const ll=worldToLatLon(this.city,player.pos.x,player.pos.z),world=mercator(ll.lat,ll.lon)
    const own=this.crew?`crew_${this.crew}`:tileKey(ll.lat,ll.lon)
    this.roomClock-=dt
    if(this.roomClock<=0){
      this.roomClock=2
      const keys=this.crew?[own]:nearbyTiles(ll.lat,ll.lon)
      // Polar latitudes can create hundreds of subscriptions; explicitly disable ambient mode there.
      if(keys.length>128){this.status='AMBIENT UNAVAILABLE AT THIS LATITUDE';for(const ws of this.sockets.values())ws.close();this.sockets.clear();return}
      const wanted=new Set(keys)
      for(const [key,ws]of this.sockets)if(!wanted.has(key)){this.sockets.delete(key);ws.close()}
      for(const key of wanted)this.connect(key)
    }
    this.viewClock-=dt
    if(this.viewClock<=0){this.viewClock=1;const view=JSON.stringify({type:'view',...world});for(const ws of this.sockets.values())if(ws.readyState===WebSocket.OPEN)ws.send(view)}
    this.sendClock+=dt
    if(this.sendClock>=0.05){this.sendClock%=0.05;const ws=this.sockets.get(own);if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({id:this.id,...world,y:player.pos.y,rotY:player.heading,laneIndex:player.laneIndex,velocity:player.groundSpeed,maskId:player.mask,chassisId:player.spec.id,boost:player.boosting,seq:this.seq++} satisfies Telemetry))}
    const now=performance.now()
    for(const [id,peer]of this.peers){
      const age=(now-peer.received)/1000,p=peer.state!
      if(age>4){peer.mesh.visible=false;peer.state=null;this.peers.delete(id);continue}
      const target=this.local(p),ahead=Math.min(0.2,age)
      target.x+=Math.sin(p.rotY)*p.velocity*ahead;target.z+=Math.cos(p.rotY)*p.velocity*ahead
      peer.mesh.position.lerp(target,1-Math.exp(-12*dt))
      peer.mesh.rotation.y+=Math.atan2(Math.sin(p.rotY-peer.mesh.rotation.y),Math.cos(p.rotY-peer.mesh.rotation.y))*(1-Math.exp(-12*dt))
    }
  }
  dispose(){this.disposed=true;for(const ws of this.sockets.values())ws.close();this.sockets.clear();this.geometry.dispose();this.material.dispose();for(const p of this.pool)p.mesh.getObjectByName('mask')?.traverse(o=>(o as THREE.Mesh).geometry?.dispose());this.peers.clear()}
}
