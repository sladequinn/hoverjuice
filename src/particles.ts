import * as THREE from 'three'
/** Fixed allocation trail, steam and impact pool, one WebGL draw call. */
export class ParticlePool {
 mesh:THREE.Points
 private positions=new Float32Array(768*3)
 private colors=new Float32Array(768*3)
 private life=new Float32Array(768)
 private cursor=0
 constructor(){
  this.positions.fill(1e7)
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(this.positions,3));geo.setAttribute('color',new THREE.BufferAttribute(this.colors,3))
  this.mesh=new THREE.Points(geo,new THREE.PointsMaterial({size:0.6,vertexColors:true,transparent:true,opacity:0.55,depthWrite:false,blending:THREE.AdditiveBlending}))
  this.mesh.frustumCulled=false
 }
 emit(x:number,y:number,z:number,amber=false){const i=this.cursor++%this.life.length;this.life[i]=1;this.positions.set([x,y,z],i*3);this.colors.set(amber?[1,0.4,0]:[0,0.8,1],i*3)}
 update(dt:number){for(let i=0;i<this.life.length;i++){if(this.life[i]<=0)continue;this.life[i]-=dt;this.positions[i*3+1]+=dt*1.5;if(this.life[i]<=0)this.positions[i*3+1]=1e7}this.mesh.geometry.attributes.position.needsUpdate=true;this.mesh.geometry.attributes.color.needsUpdate=true}
 dispose(){this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose()}
}
