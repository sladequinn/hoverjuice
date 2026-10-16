import * as THREE from 'three'
import type {World} from './world'
import type {Body,Point} from './physical'
interface Prop {id:number;kind:number;pos:THREE.Vector3;vx:number;vz:number;vy:number;angle:number;spin:number;broken:boolean}
/** Bounded physical roadside props. Debris reuses the original instance and never creates money. */
export class StreetObjects {
 group=new THREE.Group();items:Prop[]=[];private meshes:THREE.InstancedMesh[]=[];private dummy=new THREE.Object3D();private world:World;private clock=0;private cursor=0;
 constructor(world:World){this.world=world;const geometries=[new THREE.ConeGeometry(.32,.75,5),new THREE.CylinderGeometry(.35,.3,.8,6),new THREE.BoxGeometry(.65,1.4,.12),new THREE.BoxGeometry(1.8,.7,.6),new THREE.BoxGeometry(1.5,.5,.6)];for(let i=0;i<5;i++){const m=new THREE.InstancedMesh(geometries[i],new THREE.MeshStandardMaterial({color:[0xff8e35,0x53746c,0xd5b64f,0x979d9a,0x7d5844][i],roughness:.8}),48);m.count=0;m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.meshes.push(m);this.group.add(m)}}
 update(dt:number,p:Point,candidates:readonly number[]){if(dt<=0)return;dt=Math.min(.05,dt);this.clock-=dt;const nodes=this.world.city.nodes
  this.items=this.items.filter(item=>Math.hypot(item.pos.x-p.x,item.pos.z-p.z)<230)
  if(this.clock<=0){this.clock=.5;for(let k=0;k<8&&candidates.length&&this.items.length<48;k++){const id=candidates[this.cursor++%candidates.length],n=nodes[id];if(this.items.some(i=>i.id===id)||n.tunnel||!n.adj.length||Math.hypot(n.x-p.x,n.z-p.z)<30)continue;const b=nodes[n.adj[0]],heading=Math.atan2(b.x-n.x,b.z-n.z),off=(n.width??5)/2+1.1,x=n.x+Math.cos(heading)*off,z=n.z-Math.sin(heading)*off,y=this.world.city.terrain?.heightAt(x,z)??0;if(Math.abs((n.y??0)-y)>1||this.world.isWater(x,z)||[-.9,0,.9].some(dx=>this.world.hitBuilding(x+dx,z,y+.5)>=0))continue;this.items.push({id,kind:(id*7)%5,pos:new THREE.Vector3(x,y+.5,z),vx:0,vz:0,vy:0,angle:0,spin:0,broken:false});}}
  const counts=[0,0,0,0,0]
  for(const item of this.items){const x=item.pos.x+item.vx*dt,z=item.pos.z+item.vz*dt;if(this.world.hitBuilding(x,z,item.pos.y)<0){item.pos.x=x;item.pos.z=z}else {item.vx*=-.2;item.vz*=-.2}item.vx*=Math.exp(-3*dt);item.vz*=Math.exp(-3*dt);const floor=(this.world.city.terrain?.heightAt(item.pos.x,item.pos.z)??0)+(item.broken?.12:.5);item.vy-=15*dt;item.pos.y=Math.max(floor,item.pos.y+item.vy*dt);if(item.pos.y<=floor)item.vy=0;item.angle+=item.spin*dt;item.spin*=Math.exp(-2*dt);this.dummy.position.copy(item.pos);this.dummy.rotation.set(item.broken?Math.PI/2:item.angle,0,item.angle*.4);this.dummy.updateMatrix();this.meshes[item.kind].setMatrixAt(counts[item.kind]++,this.dummy.matrix)}
  for(let i=0;i<5;i++){this.meshes[i].count=counts[i];this.meshes[i].instanceMatrix.needsUpdate=true}
 }
 bodies():Body[]{return this.items.filter(p=>!p.broken).map(p=>({id:'prop:'+p.id,x:p.pos.x,y:p.pos.y,z:p.pos.z,heading:p.kind>=3?Math.PI/2:0,halfW:p.kind===3?.38:.3,halfL:p.kind>=3?.9:.35,vx:p.vx,vz:p.vz,mass:p.kind===3?Infinity:p.kind===4?120:35,push:(vx,vz,dx,dz)=>{if(p.kind===3)return;p.vx=Math.max(-25,Math.min(25,p.vx+vx));p.vz=Math.max(-25,Math.min(25,p.vz+vz));p.pos.x+=dx;p.pos.z+=dz;const force=Math.hypot(vx,vz);p.vy=Math.min(4,force*.1);p.spin=Math.min(8,force*.2);if(p.kind===2&&force>10)p.broken=true}}))}
 dispose(){for(const m of this.meshes){m.geometry.dispose();(m.material as THREE.Material).dispose()}this.items=[];this.group.clear()}
}
