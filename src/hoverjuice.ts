import * as THREE from 'three'

/** Droplets and ground ripples share one fixed-size instanced draw call. */
export class HoverjuiceSpray {
 readonly capacity = 512
 readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
 private offsets = new Float32Array(this.capacity * 3)
 private appearance = new Float32Array(this.capacity * 4)
 private velocity = new Float32Array(this.capacity * 3)
 private floor = new Float32Array(this.capacity)
 private age = new Float32Array(this.capacity)
 private alive = new Uint8Array(this.capacity)
 private clocks = new WeakMap<object, number>()
 private cursor = 0
 constructor() {
  const plane = new THREE.PlaneGeometry(1, 1)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.index = plane.index
  geometry.setAttribute('position', plane.attributes.position)
  geometry.setAttribute('uv', plane.attributes.uv)
  geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(this.offsets, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('appearance', new THREE.InstancedBufferAttribute(this.appearance, 4).setUsage(THREE.DynamicDrawUsage))
  geometry.instanceCount = this.capacity
  const material = new THREE.ShaderMaterial({
   transparent: true, depthWrite: false, side: THREE.DoubleSide,
   blending: THREE.AdditiveBlending,
   vertexShader: `attribute vec3 offset;
    attribute vec4 appearance;
    varying vec2 vUv; varying vec4 vEffect;
    void main(){
     vUv=uv; vEffect=appearance;
     vec4 center=modelViewMatrix*vec4(offset,1.);
     if(appearance.z>.5){
      center=modelViewMatrix*vec4(offset+vec3(position.x,0.,position.y)*appearance.x,1.);
     }else{center.xy+=position.xy*vec2(.6,1.5)*appearance.x;}
     gl_Position=projectionMatrix*center;
    }`,
   fragmentShader: `varying vec2 vUv; varying vec4 vEffect;
    void main(){
     vec2 p=vUv*2.-1.; float r=length(p);
     float drop=1.-smoothstep(.25,1.,r);
     float ring=(1.-smoothstep(.08,.23,abs(r-.7)))*(1.-smoothstep(.85,1.,r));
     float alpha=mix(drop,ring,vEffect.z)*vEffect.y;
     if(alpha<.008)discard;
     gl_FragColor=vec4(mix(vec3(0.,.62,.7),vec3(.12,.94,1.),drop*.4),alpha);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
    }`,
  })
  this.mesh = new THREE.Mesh(geometry, material)
  this.mesh.name = 'hoverjuice-splashes'
  this.mesh.frustumCulled = false
 }
 get activeCount() { return this.alive.reduce((sum, n) => sum + n, 0) }
 emit(key: object, dt: number, pos: THREE.Vector3, heading: number, speed: number,
      halfW: number, halfL: number, surfaceY: number, boosting = false, density = 1) {
  if (dt <= 0) return
  const rate = (3 + Math.min(36, Math.abs(speed) * .9)) * (boosting ? 1.7 : 1) * density
  const credit = (this.clocks.get(key) ?? 0) + Math.min(dt, .1) * rate
  const count = Math.min(10, Math.floor(credit))
  this.clocks.set(key, credit - Math.floor(credit))
  const forwardX = Math.sin(heading), forwardZ = Math.cos(heading)
  for (let n = 0; n < count; n++) {
   const i = this.cursor++ % this.capacity, j = i * 3, k = i * 4
   const side = Math.random() < .5 ? -1 : 1
   const lateral = halfW * .8 * side
   this.offsets[j] = pos.x + forwardZ * lateral - forwardX * halfL * .75
   this.offsets[j+1] = Math.max(surfaceY + .12, pos.y - .55)
   this.offsets[j+2] = pos.z - forwardX * lateral - forwardZ * halfL * .75
   const rear = 1.5 + Math.min(7, Math.abs(speed) * .16), fan = side * (1 + Math.random() * 2)
   this.velocity[j] = -forwardX * rear + forwardZ * fan
   this.velocity[j+1] = -.7 - Math.random() * 1.2
   this.velocity[j+2] = -forwardZ * rear - forwardX * fan
   this.floor[i] = surfaceY + .055
   this.age[i] = 0; this.alive[i] = 1
   this.appearance[k] = .13 + Math.random() * .14
   this.appearance[k+1] = .65; this.appearance[k+2] = 0
  }
 }
 update(dt: number) {
  if (dt <= 0) return
  dt = Math.min(dt, .1)
  for (let i = 0; i < this.capacity; i++) {
   if (!this.alive[i]) continue
   const j = i * 3, k = i * 4
   this.age[i] += dt
   if (this.appearance[k+2] === 0) {
    this.velocity[j+1] -= 12 * dt
    for (let axis=0; axis<3; axis++) this.offsets[j+axis] += this.velocity[j+axis] * dt
    this.appearance[k+1] = .65 * Math.max(0, 1 - this.age[i] / .8)
    if (this.offsets[j+1] <= this.floor[i]) {
     this.offsets[j+1] = this.floor[i]; this.appearance[k+2] = 1; this.age[i] = 0
    }
   } else {
    this.appearance[k] = .25 + this.age[i] * 2.3
    this.appearance[k+1] = .42 * Math.max(0, 1 - this.age[i] / .42)
   }
   if (this.age[i] >= (this.appearance[k+2] ? .42 : .8)) {
    this.alive[i] = 0; this.appearance[k+1] = 0
   }
  }
  this.mesh.geometry.attributes.offset.needsUpdate = true
  this.mesh.geometry.attributes.appearance.needsUpdate = true
 }
 clear() {
  this.alive.fill(0); this.appearance.fill(0); this.clocks = new WeakMap(); this.cursor = 0
  this.mesh.geometry.attributes.appearance.needsUpdate = true
 }
 dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose() }
}
