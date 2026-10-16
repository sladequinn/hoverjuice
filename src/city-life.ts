import * as THREE from 'three'
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {hashName,type Gang} from './filter'
import {pointInPoly,worldToLatLon} from './map'
import type {World} from './world'
export type DistrictMood='residential'|'commercial'|'industrial'|'nightlife'
export interface LifeContext {gang:Gang;reputation:number;friendlyControl:boolean;contested:boolean;crewColor?:string}
export interface StreetIncident {kind:'breakdown'|'delivery'|'meet'|'patrol';x:number;z:number;remaining:number;id:string;helped?:boolean;engaged?:boolean;announcement?:string}
export function solarHour(lon:number,now=Date.now()){return ((new Date(now).getUTCHours()+new Date(now).getUTCMinutes()/60+lon/15)%24+24)%24}
export function landMood(tags:Record<string,unknown>):DistrictMood|null {
 const t=Object.values(tags).join(' ').toLowerCase()
 if(/industrial|warehouse|railway|dock|port/.test(t))return 'industrial'
 if(/nightclub|bar|pub/.test(t))return 'nightlife'
 if(/retail|commercial|shop|restaurant|cafe|university/.test(t))return 'commercial'
 if(/residential|apartments|house/.test(t))return 'residential'
 return null
}
export function routine(mood:DistrictMood,hour:number){const night=hour<6||hour>=21,rush=hour>=7&&hour<9||hour>=16&&hour<19;return {speed:mood==='residential'?.68:mood==='commercial'?.82:1,walkers:mood==='industrial'?6:mood==='nightlife'?(night?24:8):night?6:rush?24:18,dwell:mood==='industrial'?30:mood==='residential'?22:14,label:mood==='industrial'?'Freight shift':mood==='nightlife'?(night?'After-hours crowd':'Quiet venues'):mood==='residential'?(rush?'Neighbours coming home':night?'Quiet backstreets':'Neighbourhood errands'):rush?'Rush-hour errands':'Shopfront activity'}}
function pedestrianGeometry(){
 const parts:THREE.BufferGeometry[]=[];let part=0
 for(const [x,y,z,w,h,d]of [[0,.65,0,.32,.32,.3],[0,.12,0,.48,.65,.28],[-.31,.1,0,.12,.6,.14],[.31,.1,0,.12,.6,.14],[-.14,-.48,0,.16,.57,.18],[.14,-.48,.06,.16,.57,.18]]){const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);const c=new THREE.Color(part===0?'#d5ae87':part>=4?'#263747':'#ffffff'),colors=new Float32Array(g.attributes.position.count*3);for(let i=0;i<colors.length;i+=3){colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b}g.setAttribute('color',new THREE.BufferAttribute(colors,3));parts.push(g);part++}
 const merged=mergeGeometries(parts)!;parts.forEach(g=>g.dispose());return merged
}
/** Ambient consequences only. Never read by wallet, inventory or contest authority. */
export class IncidentMemory {
 private seen:Record<string,number>={}
 private storage?:Pick<Storage,'getItem'|'setItem'>
 constructor(storage?:Pick<Storage,'getItem'|'setItem'>){this.storage=storage;try{const raw=JSON.parse(storage?.getItem('hoverghini.city-life.v1')??'{}');if(raw&&typeof raw==='object')for(const [k,v]of Object.entries(raw).slice(-64))if(k.length<100&&typeof v==='number'&&Number.isFinite(v))this.seen[k]=v}catch{}}
 available(id:string,now:number){return !(this.seen[id]>now-600000&&this.seen[id]<=now+600000)}
 mark(id:string,now:number){this.seen[id]=now;this.seen=Object.fromEntries(Object.entries(this.seen).sort((a,b)=>b[1]-a[1]).slice(0,64));try{this.storage?.setItem('hoverghini.city-life.v1',JSON.stringify(this.seen))}catch{}}
}
interface Walker {a:THREE.Vector3;b:THREE.Vector3;t:number;dir:number;wait:number;seed:number}
/** One pooled draw call; 10 Hz movement, bounded incremental road discovery, no network or startup work. */
export class CityLife {
 group=new THREE.Group();mood:DistrictMood='residential';incident:StreetIncident|null=null;label='Neighbourhood errands';notice='';context:LifeContext={gang:'HYENAS',reputation:0,friendlyControl:false,contested:false}
 stats={walkers:0,roadChecks:0,zoneChecks:0,updates:0};private walkers:Walker[]=[];private mesh:THREE.InstancedMesh;private dummy=new THREE.Object3D();private tint=new THREE.Color();private clock=0;private sample=0;private nextIncident=18;private helping=0;private cursor=0;roadCandidates:readonly number[]|null=null;private zoneCursor=0;private scanX=Infinity;private scanZ=Infinity;private found=false;private bestArea=Infinity;private memory:IncidentMemory;private currentRoutine=routine('residential',12)
 private world:World
 constructor(world:World,storage?:Pick<Storage,'getItem'|'setItem'>){this.world=world;this.memory=new IncidentMemory(storage);this.mesh=new THREE.InstancedMesh(pedestrianGeometry(),new THREE.MeshStandardMaterial({roughness:.9,vertexColors:true}),24);this.mesh.count=0;this.mesh.frustumCulled=false;this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(this.mesh)}
 get schedule(){return this.currentRoutine}
 private profile(player:THREE.Vector3,now:number){
  const city=this.world.city,zones=city.zones??[]
  if(Math.hypot(player.x-this.scanX,player.z-this.scanZ)>100){this.scanX=player.x;this.scanZ=player.z;this.zoneCursor=0;this.found=false;this.bestArea=Infinity;this.mood='residential'}
  // Visit at most 32 polygons per tick; streamed additions are picked up without rebuilding an index.
  this.stats.zoneChecks=0
  for(let k=0;k<Math.min(32,zones.length);k++){const zone=zones[this.zoneCursor++%zones.length];this.stats.zoneChecks++;if(zone.poly.length>512)continue;const mood=landMood(zone.tags);if(!mood||!pointInPoly(player.x,player.z,zone.poly))continue;let area=0;for(let i=0;i<zone.poly.length;i++){const a=zone.poly[i],b=zone.poly[(i+1)%zone.poly.length];area+=a[0]*b[1]-b[0]*a[1]}area=Math.abs(area);if(area<this.bestArea){this.bestArea=area;this.mood=mood;this.found=true}}
  if(!this.found){const venues=city.venues??[];let nearest=120;for(const v of venues.slice(0,256)){const d=Math.hypot(v.x-player.x,v.z-player.z),m=landMood(v.tags);if(m&&d<nearest){nearest=d;this.mood=m}}}
  this.currentRoutine=routine(this.mood,solarHour(city.lon||0,now));this.label=this.currentRoutine.label+(this.context.friendlyControl?' · Crew regulars':this.context.reputation>=10?' · Familiar faces':this.context.contested?' · District on edge':'')
 }
 update(dt:number,player:THREE.Vector3,speed:number,heat:number,now=Date.now()){
  if(dt<=0)return;dt=Math.min(.1,dt);this.clock+=dt;if(this.clock<.1)return;const step=this.clock;this.clock=0;this.stats.updates++
  this.sample-=step;if(this.sample<=0){this.sample=1;this.profile(player,now)}
  if(this.incident?.kind==='breakdown'&&this.incident.engaged&&!this.incident.helped){this.helping=speed<3&&Math.hypot(player.x-this.incident.x,player.z-this.incident.z)<18?this.helping+step:0;if(this.helping>=3){this.incident.helped=true;this.incident.remaining=Math.min(4,this.incident.remaining);this.notice='Driver waves thanks · the lane is clearing';this.helping=0}}else this.helping=0
  this.nextIncident-=step;if(this.incident){this.incident.remaining-=step;if(this.incident.remaining<=0||Math.hypot(this.incident.x-player.x,this.incident.z-player.z)>650)this.incident=null}
  this.stats.roadChecks=0;const nodes=this.world.city.nodes
  // Recycle only beyond the visible neighbourhood; nearby walkers finish their existing paths.
  this.walkers=this.walkers.filter(w=>Math.min(w.a.distanceToSquared(player),w.b.distanceToSquared(player))<180**2)
  for(let budget=0;budget<12&&nodes.length;budget++){
   const index=this.roadCandidates?.length?this.roadCandidates[this.cursor++%this.roadCandidates.length]:this.cursor++%nodes.length,a=nodes[index];this.stats.roadChecks++
   const d=Math.hypot(a.x-player.x,a.z-player.z);if(d<25||d>145||a.tunnel||!a.adj.length)continue
   const b=nodes[a.adj[0]],len=Math.hypot(b.x-a.x,b.z-a.z);if(len<18||len>250||b.tunnel||Math.abs((b.y??0)-(a.y??0))/len>.12)continue
   if(!this.incident&&this.nextIncident<=0&&d>45){
    const geo=worldToLatLon(this.world.city,a.x,a.z),id=`${Math.floor(geo.lat*1000)}:${Math.floor(geo.lon*1000)}:${this.mood}`,seed=hashName(id+Math.floor(now/600000))
    if(this.memory.available(id,now)){const kind=this.context.contested||heat>1?'patrol':this.mood==='industrial'?'delivery':this.mood==='nightlife'?'meet':seed%3===0?'breakdown':this.mood==='commercial'?'delivery':'patrol';this.incident={kind,x:a.x,z:a.z,remaining:35,id};this.memory.mark(id,now);this.nextIncident=65+seed%35;this.incident.announcement=kind==='breakdown'?'Hazard lights ahead · stop nearby to help clear the lane':kind==='delivery'?'Local delivery arriving · watch the loading bay':kind==='meet'?'After-hours meet · cars gathering by the curb':this.context.friendlyControl?'Local patrol passing through crew turf':'Patrol checking the neighbourhood'}
   }
   if(this.walkers.length>=this.currentRoutine.walkers||this.walkers.some(w=>Math.hypot(w.a.x-a.x,w.a.z-a.z)<12))continue
   const dx=(b.x-a.x)/len,dz=(b.z-a.z)/len,offset=Math.max(a.width??5,b.width??5)/2+1.4,side=index%2?1:-1,start=new THREE.Vector3(a.x+dx*4+dz*offset*side,0,a.z+dz*4-dx*offset*side),end=start.clone().add(new THREE.Vector3(dx*Math.min(22,len-8),0,dz*Math.min(22,len-8)))
   let clear=true
   for(let k=0;k<=8;k++){const x=start.x+(end.x-start.x)*k/8,z=start.z+(end.z-start.z)*k/8,y=this.world.city.terrain?.heightAt(x,z)??0;if(this.world.isWater(x,z)||this.world.hitBuilding(x,z,y+1)>=0||Math.abs(y-(a.y??0))>2){clear=false;break}}
   if(clear){start.y=(this.world.city.terrain?.heightAt(start.x,start.z)??a.y??0)+.8;end.y=(this.world.city.terrain?.heightAt(end.x,end.z)??b.y??0)+.8;this.walkers.push({a:start,b:end,t:(index*.618)%1,dir:1,wait:index%4,seed:index})}
  }
  let count=0
  for(const w of this.walkers){const length=w.a.distanceTo(w.b)||1;this.dummy.position.lerpVectors(w.a,w.b,w.t);const distance=this.dummy.position.distanceTo(player),alarmed=distance<15&&(speed>18||heat>1);if(w.wait>0&&!alarmed)w.wait-=step;else {if(alarmed)w.dir=((this.dummy.position.x-player.x)*(w.b.x-w.a.x)+(this.dummy.position.z-player.z)*(w.b.z-w.a.z))>=0?1:-1;w.t+=w.dir*step*(alarmed?3:1.1)/length;if(w.t>=1||w.t<=0){w.t=Math.max(0,Math.min(1,w.t));w.dir*=-1;w.wait=3+w.seed%5}}
   this.dummy.position.lerpVectors(w.a,w.b,w.t);this.dummy.position.y+=w.wait<=0?Math.sin(w.t*length*5)*.035:0;this.dummy.rotation.y=Math.atan2(w.b.x-w.a.x,w.b.z-w.a.z)+(w.dir<0?Math.PI:0);this.dummy.rotation.z=w.wait<=0?Math.sin(w.t*length*5)*.025:0;this.dummy.scale.set(.9,alarmed?.85:1,.9);this.dummy.updateMatrix();this.mesh.setMatrixAt(count,this.dummy.matrix);this.tint.set(this.context.crewColor&&w.seed%3===0?this.context.crewColor:['#d1a86e','#729b9e','#b98cbd','#b4b9a8'][w.seed%4]);this.mesh.setColorAt(count++,this.tint)
  }
  this.mesh.count=count;this.mesh.instanceMatrix.needsUpdate=true;if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;this.stats.walkers=count
 }
 dispose(){this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose();this.walkers=[];this.group.clear()}
}
