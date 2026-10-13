import * as THREE from 'three'
import { buildVehicleMesh } from './vehicle'
import { vehicleById } from './data'
import { grain, softDisc } from './art'

/** Small persistent title set. No city, shadows, postprocessing or additional renderer. */
export class AlleyPreview {
 private scene=new THREE.Scene()
 private camera=new THREE.PerspectiveCamera(40,1,.1,100)
 private car=buildVehicleMesh(vehicleById('hoverghini'))
 private texture=grain.clone()
 private ripples:THREE.Mesh[]=[]
 private rain:THREE.LineSegments
 private disposed=false
 constructor(){
  const scene=this.scene
  scene.background=new THREE.Color(0x080e14);scene.fog=new THREE.FogExp2(0x080e14,.032)
  scene.add(new THREE.HemisphereLight(0x9aadc6,0x151018,1.3))
  const key=new THREE.DirectionalLight(0xffbf7b,2.6);key.position.set(-3,7,3);scene.add(key)
  const rim=new THREE.DirectionalLight(0x85c6db,2.1);rim.position.set(3,4,-4);scene.add(rim)
  const spill=new THREE.PointLight(0x00dfed,5,5,2);spill.position.set(0,.6,0);scene.add(spill)
  this.texture.repeat.set(7,7);this.texture.needsUpdate=true
  const concrete=new THREE.MeshStandardMaterial({color:0x30343c,roughness:.94,map:this.texture})
  const asphalt=new THREE.MeshStandardMaterial({color:0x11191e,roughness:.62,metalness:.2,map:this.texture})
  const iron=new THREE.MeshStandardMaterial({color:0x17202a,roughness:.6,metalness:.65})
  const amber=new THREE.MeshBasicMaterial({color:0xffbc6c})
  const box=(w:number,h:number,d:number,x:number,y:number,z:number,m:THREE.Material)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);mesh.position.set(x,y,z);scene.add(mesh);return mesh}
  box(12,.2,60,0,-.15,-12,asphalt)
  box(.8,17,52,-4.6,8,-12,concrete);box(.8,17,52,4.6,8,-12,concrete)
  box(10,14,1,0,7,-32,concrete)
  for(const side of [-1,1]){
   box(.35,.18,55,side*4,.02,-12,concrete)
   for(let z=-27;z<8;z+=7){
    box(.12,2.8,1.6,side*4.13,1.5,z,iron)
    box(.3,.08,1.4,side*3.94,3,z,amber)
    for(let y=5;y<15;y+=3){box(.15,1.4,1,side*4.1,y,z,iron);if((z+y)%3===0)box(.17,.5,.8,side*4,y,z,amber)}
   }
   const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,14,6),iron);pipe.position.set(side*4,7,-6);scene.add(pipe)
  }
  // Loading bay, bins and a fire escape frame the car without filling the alley.
  box(.9,1.2,2,-3.2,.6,-3,iron);box(.7,.9,1.2,-3.3,.45,-1.2,iron)
  for(let i=0;i<7;i++)box(1.2,.09,.3,3.5,3+i*.35,-9-i*.45,iron)
  box(1.4,.12,4,3.45,5.5,-13,iron)
  // Hero finish and mechanical detail; the driving mesh remains unchanged.
  this.car.traverse(o=>{if(o instanceof THREE.Mesh&&o.material instanceof THREE.MeshStandardMaterial){const m=o.material;if(m.color.getHex()===0x517b8c){m.color.setHex(0x10212b);m.emissive.setHex(0x030809)}else if(m.color.getHex()===0x7b1fa2){m.color.setHex(0x68224f);m.metalness=.45}}})
  const detail=(geo:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number)=>{const mesh=new THREE.Mesh(geo,m);mesh.position.set(x,y,z);this.car.add(mesh);return mesh}
  const cyan=new THREE.MeshBasicMaterial({color:0x40bfc9})
  for(const x of [-1.04,1.04])for(const z of [-1.5,1.45]){
   detail(new THREE.CylinderGeometry(.38,.3,.16,16),iron,x,.04,z)
   const turbine=detail(new THREE.TorusGeometry(.26,.035,6,20),cyan,x,-.05,z);turbine.rotation.x=Math.PI/2
  }
  detail(new THREE.BoxGeometry(1.6,.1,.03),iron,0,.17,2.41)
  for(const x of [-.74,.74])detail(new THREE.BoxGeometry(.36,.065,.045),amber,x,.34,2.3)
  for(let i=0;i<5;i++)detail(new THREE.BoxGeometry(.44,.035,.065),iron,.64,.77,-1.45-i*.12)
  this.car.scale.setScalar(1);this.car.position.set(.3,.58,0);this.car.rotation.y=-.16
  this.car.getObjectByName('pad')?.removeFromParent();this.car.getObjectByName('contact-shadow')?.removeFromParent();scene.add(this.car)
  const disc=(x:number,z:number,w:number,h:number,color:number,opacity:number)=>{
   const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:softDisc,color,transparent:true,opacity,depthWrite:false}));mesh.rotation.x=-Math.PI/2;mesh.position.set(x,.015,z);scene.add(mesh);return mesh
  }
  disc(.3,0,3.5,6,0x000000,.9)
  disc(.3,0,4.2,6.4,0x00aab4,.22)
  for(let i=0;i<10;i++)disc(Math.sin(i*17)*1.1+.3,Math.cos(i*8)*2.2,1.1,.6,0x05b5c2,.3)
  for(let i=0;i<4;i++){
   const ring=new THREE.Mesh(new THREE.RingGeometry(.22,.24,32),new THREE.MeshBasicMaterial({color:0x4edce4,transparent:true,opacity:.3,depthWrite:false,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set((i%2?1:-1)*.8+.3,.028,(i<2?-1:1)*1.5);scene.add(ring);this.ripples.push(ring)
  }
  const points:number[]=[];for(let i=0;i<100;i++){const x=Math.sin(i*32)*4,z=Math.cos(i*17)*14,y=(i*.73)%12;points.push(x,y,z,x-.03,y-.3,z)}
  this.rain=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3)),new THREE.LineBasicMaterial({color:0x799da9,transparent:true,opacity:.17}));scene.add(this.rain)
 }
 resize(width:number,height:number){
  this.camera.aspect=width/height
  const mobile=width<=760
  this.camera.position.set(mobile?3.3:3.4,mobile?2.6:2.0,mobile?14:9.8)
  this.camera.lookAt(.3,.9,0)
  this.camera.setViewOffset(width,height,mobile?0:-width*.19,mobile?height*.12:0,width,height)
  this.camera.updateProjectionMatrix()
 }
 render(renderer:THREE.WebGLRenderer,time:number){
  if(this.disposed)return
  const t=matchMedia('(prefers-reduced-motion: reduce)').matches?0:time
  this.car.position.y=.58+Math.sin(t*1.5)*.055;this.car.rotation.z=Math.sin(t*.8)*.008
  this.rain.position.y=-(t*4%3)
  this.ripples.forEach((ring,i)=>{const phase=(t*.65+i*.25)%1;ring.scale.setScalar(.4+phase*2.6);(ring.material as THREE.MeshBasicMaterial).opacity=(1-phase)*.28})
  renderer.render(this.scene,this.camera)
 }
 dispose(){
  if(this.disposed)return;this.disposed=true
  const materials=new Set<THREE.Material>()
  this.scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)}})
  materials.forEach(m=>m.dispose());this.texture.dispose()
 }
}
