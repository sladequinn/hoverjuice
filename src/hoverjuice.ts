import * as THREE from 'three'

interface Emitter { credit:number; distance:number; idle:number; x:number; z:number; y:number }
/** Airborne spray, impact splashes and persistent liquid share one bounded draw call. */
export class HoverjuiceSpray {
 readonly capacity = 1536
 readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
 private offsets = new Float32Array(this.capacity * 3)
 private appearance = new Float32Array(this.capacity * 4)
 private velocity = new Float32Array(this.capacity * 3)
 private floor = new Float32Array(this.capacity)
 private age = new Float32Array(this.capacity)
 private alive = new Uint8Array(this.capacity)
 private clocks = new WeakMap<object, Emitter>()
 private duration = new Float32Array(this.capacity)
 private size = new Float32Array(this.capacity)
 private poolCursor = [0, 0]
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
   blending: THREE.NormalBlending,
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
     float angle=atan(p.y,p.x);
     float edge=.82+.07*sin(angle*7.+vEffect.w)+.05*sin(angle*11.-vEffect.w);
     float drop=1.-smoothstep(.3,1.,r);
     float filled=1.-smoothstep(edge-.16,edge,r);
     float rim=1.-smoothstep(.025,.09,abs(r-edge+.09));
     float fingers=(1.-smoothstep(.06,.17,abs(r-(.62+.13*sin(angle*9.+vEffect.w)))));
     float shape=vEffect.z>1.5 ? filled*.68+rim*.3 : (vEffect.z>.5 ? filled*.25+fingers*.75 : drop);
     float alpha=shape*vEffect.y;
     if(alpha<.008)discard;
     vec3 liquid=mix(vec3(0.,.48,.55),vec3(.12,1.,.93),vEffect.z>1.5 ? rim : .65);
     gl_FragColor=vec4(liquid,alpha);
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
  let state=this.clocks.get(key)
  if(!state){state={credit:0,distance:0,idle:0,x:pos.x,z:pos.z,y:surfaceY};this.clocks.set(key,state)}
  const travel=Math.hypot(pos.x-state.x,pos.z-state.z)
  const connected=travel<30&&Math.abs(surfaceY-state.y)<1.5
  const nearGround=pos.y-surfaceY<3
  // Stamp by distance, not frames, so a fast vehicle leaves an unbroken wet wake.
  const spacing=Math.max(.55,halfW*.9)
  if(nearGround){
   if(connected&&travel>.001){
    let along=spacing-state.distance
    let budget=24
    while(along<=travel&&budget-->0){
     const t=along/travel
     this.puddle(state.x+(pos.x-state.x)*t,state.z+(pos.z-state.z)*t,
       state.y+(surfaceY-state.y)*t,halfW,boosting,density)
     along+=spacing
    }
    state.distance=(state.distance+travel)%spacing
    state.idle=0
   }else{
    state.distance=0;state.idle+=dt
    if(state.idle>=.16){this.puddle(pos.x,pos.z,surfaceY,halfW,boosting,density);state.idle%=.16}
   }
  }else{state.distance=0;state.idle=0}
  state.x=pos.x;state.z=pos.z;state.y=surfaceY
  const rate = (28 + Math.min(110, Math.abs(speed) * 2.7)) * (boosting ? 1.65 : 1) * density
  const credit = state.credit + Math.min(dt, .1) * rate
  const count = Math.min(24, Math.floor(credit))
  state.credit=credit-Math.floor(credit)
  const forwardX = Math.sin(heading), forwardZ = Math.cos(heading)
  for (let n = 0; n < count; n++) {
   const i = this.cursor++ % 768, j = i * 3, k = i * 4
   const side = Math.random() < .5 ? -1 : 1
   const lateral = halfW * (.6+Math.random()*.4) * side
   const longitudinal = (Math.random()<.3 ? .5 : -.8)*halfL
   this.offsets[j] = pos.x + forwardZ * lateral + forwardX * longitudinal
   this.offsets[j+1] = Math.max(surfaceY + .12, pos.y - .55)
   this.offsets[j+2] = pos.z - forwardX * lateral + forwardZ * longitudinal
   const rear = 1.5 + Math.min(7, Math.abs(speed) * .16), fan = side * (2 + Math.random() * 3.5)
   this.velocity[j] = -forwardX * rear + forwardZ * fan
   this.velocity[j+1] = -.7 - Math.random() * 1.2
   this.velocity[j+2] = -forwardZ * rear - forwardX * fan
   this.floor[i] = surfaceY + .055
   this.age[i] = 0; this.alive[i] = 1
   this.appearance[k] = .22 + Math.random() * .28
   this.appearance[k+1] = .9; this.appearance[k+2] = 0; this.appearance[k+3]=Math.random()*6.28
  }
 }
 private puddle(x:number,z:number,y:number,halfW:number,boosting:boolean,density:number){
  // Reserve half the wet trail for the player/boss, so traffic cannot erase it.
  const lane=density>=1?0:1
  const i=768+lane*384+(this.poolCursor[lane]++%384),j=i*3,k=i*4
  this.offsets[j]=x;this.offsets[j+1]=y+.045;this.offsets[j+2]=z
  this.age[i]=0;this.alive[i]=1;this.duration[i]=lane===0?6:2.8
  this.size[i]=Math.max(.9,halfW*2.8)*(boosting?1.2:1)
  this.appearance[k]=this.size[i];this.appearance[k+1]=.78
  this.appearance[k+2]=2;this.appearance[k+3]=Math.random()*6.28
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
    this.appearance[k+1] = .9 * Math.max(0, 1 - this.age[i] / .8)
    if (this.offsets[j+1] <= this.floor[i]) {
     this.offsets[j+1] = this.floor[i]; this.appearance[k+2] = 1; this.age[i] = 0
    }
   } else if(this.appearance[k+2]===2){
    const t=this.age[i]/this.duration[i]
    this.appearance[k]=this.size[i]*(1+Math.min(1,this.age[i])* .4)
    this.appearance[k+1]=.78*Math.pow(Math.max(0,1-t),.65)
   } else {
    this.appearance[k] = .45 + this.age[i] * 4.5
    this.appearance[k+1] = .85 * Math.max(0, 1 - this.age[i] / .65)
   }
   if (this.age[i] >= (this.appearance[k+2]===2 ? this.duration[i] : this.appearance[k+2]===1 ? .65 : .8)) {
    this.alive[i] = 0; this.appearance[k+1] = 0
   }
  }
  this.mesh.geometry.attributes.offset.needsUpdate = true
  this.mesh.geometry.attributes.appearance.needsUpdate = true
 }
 clear() {
  this.alive.fill(0); this.appearance.fill(0); this.clocks = new WeakMap(); this.cursor = 0;this.poolCursor=[0,0]
  this.mesh.geometry.attributes.appearance.needsUpdate = true
 }
 dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose() }
}
