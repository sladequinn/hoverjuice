import * as THREE from 'three'
/** Fixed allocation trail, steam and impact pool, one WebGL draw call. */
export class ParticlePool {
 mesh:THREE.Points
 private positions=new Float32Array(768*3)
 private velocities=new Float32Array(768*3)
 private colors=new Float32Array(768*3)
 private life=new Float32Array(768)
 private cursor=0
 constructor(){
  this.positions.fill(1e7)
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(this.positions,3));geo.setAttribute('color',new THREE.BufferAttribute(this.colors,3))
  this.mesh=new THREE.Points(geo,new THREE.PointsMaterial({size:0.65,vertexColors:true,transparent:true,opacity:0.72,depthWrite:false,blending:THREE.AdditiveBlending}))
  this.mesh.frustumCulled=false
 }
 emit(x:number,y:number,z:number,amber=false,vx=0,vy=1.5,vz=0){
  const i=this.cursor++%this.life.length
  this.life[i]=1
  this.positions.set([x,y,z],i*3)
  this.velocities.set([vx,vy,vz],i*3)
  this.colors.set(amber?[1,0.48,0.08]:[0.05,0.92,1],i*3)
 }
 emitBurst(x:number,y:number,z:number,count=20,amber=true){
  for(let n=0;n<count;n++){
   const ang=(n/count)*Math.PI*2+Math.random()*0.5
   const spd=2.5+Math.random()*9.5
   const vy=2.0+Math.random()*6.5
   const isAmber=amber?(n%3!==0):(n%4===0)
   this.emit(x+(Math.random()-0.5)*0.6,y+0.2+Math.random()*0.4,z+(Math.random()-0.5)*0.6,isAmber,Math.cos(ang)*spd,vy,Math.sin(ang)*spd)
  }
 }
 update(dt:number){
  for(let i=0;i<this.life.length;i++){
   if(this.life[i]<=0)continue
   this.life[i]-=dt*1.35
   const o=i*3
   this.positions[o]+=this.velocities[o]*dt
   this.positions[o+1]+=this.velocities[o+1]*dt
   this.positions[o+2]+=this.velocities[o+2]*dt
   if(Math.abs(this.velocities[o])+Math.abs(this.velocities[o+2])>0.1)this.velocities[o+1]-=14*dt
   if(this.life[i]<=0)this.positions[o+1]=1e7
  }
  this.mesh.geometry.attributes.position.needsUpdate=true
  this.mesh.geometry.attributes.color.needsUpdate=true
 }
 dispose(){this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose()}
}

