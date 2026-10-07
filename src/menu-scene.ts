import * as THREE from 'three'
import { buildVehicleMesh } from './vehicle'
import { vehicleById } from './data'
import { grain, softDisc } from './art'

// A single rendered garage frame, refreshed only on resize. No menu animation cost.
export function renderGaragePreview(renderer: THREE.WebGLRenderer, width: number, height: number) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x111c24)
  scene.fog = new THREE.FogExp2(0x111c24, .035)
  const camera = new THREE.PerspectiveCamera(38, width / height, .1, 100)
  camera.position.set(8, 5, -10)
  camera.lookAt(0, .8, 0)
  camera.setViewOffset(width, height, width > 760 ? -width * .23 : 0, width > 760 ? 0 : height * .24, width, height)
  scene.add(new THREE.HemisphereLight(0x9cbcd3, 0x151b21, 2))
  const key = new THREE.DirectionalLight(0xffcc88, 4)
  key.position.set(-4, 7, -2); scene.add(key)
  const rim = new THREE.DirectionalLight(0x80afc4, 3)
  rim.position.set(5, 3, 4); scene.add(rim)
  const fineGrain=grain.clone();fineGrain.repeat.set(24,24);fineGrain.needsUpdate=true
  const concrete = new THREE.MeshStandardMaterial({ color: 0x34404a, roughness: .9, map: fineGrain })
  const metal = new THREE.MeshStandardMaterial({ color: 0x263540, roughness: .6, metalness: .4 })
  const amber = new THREE.MeshBasicMaterial({ color: 0xd7b681 })
  function box(w:number,h:number,d:number,x:number,y:number,z:number,material:THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material)
    mesh.position.set(x,y,z);scene.add(mesh)
  }
  box(35,.2,35,0,-.2,0,concrete)
  box(30,10,.5,0,4.8,7,concrete)
  for(let i=-2;i<=2;i++){
    box(.6,10,.8,i*5,4.8,6.5,metal)
    box(3.4,.06,.12,i*5,3.8,6,amber)
    for(let j=0;j<8;j++)box(4.2,.06,.12,i*5,.3+j*.4,6.3,metal)
  }
  const car=buildVehicleMesh(vehicleById('neonic'))
  car.position.y=.55
  car.getObjectByName('pad')?.removeFromParent()
  car.getObjectByName('contact-shadow')?.removeFromParent()
  scene.add(car)
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(3.5,5.5),new THREE.MeshBasicMaterial({map:softDisc,color:0x000000,transparent:true,opacity:.8,depthWrite:false}))
  shadow.rotation.x=-Math.PI/2;shadow.position.y=.01;scene.add(shadow)
  for(const x of [-2.3,2.3])box(.07,.02,6,x,.02,0,amber)
  renderer.render(scene,camera)
  const materials=new Set<THREE.Material>()
  scene.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material)}})
  materials.forEach(material=>material.dispose())
  fineGrain.dispose()
}
