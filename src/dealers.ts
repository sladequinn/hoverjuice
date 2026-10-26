import * as THREE from 'three'
import type { World } from './world'
import type { Gang } from './filter'
import { vehicleById } from './data'
import { buildVehicleMesh } from './vehicle'

export interface Contraband {
  id: string
  name: string
  base: number
  unit: string
  color: number
  blurb: string
}

export interface Dealer {
  id: string
  name: string
  node: number
  x: number
  z: number
  specialty: string
  gang: Gang
  bio: string
  heading: number
  y: number
  color: number
}

export interface Quote {
  ask: number
  bid: number
}

export interface MarketEvent {
  good: Contraband
  kind: 'shortage' | 'glut'
  headline: string
}

export const CONTRABAND: Contraband[] = [
  { id: 'cyanade', name: 'Cyan-ade', base: 85, unit: 'vial', color: 0x00f0ff, blurb: 'Street-cut HJ-77 stimulant. Unstable and extremely blue.' },
  { id: 'neondust', name: 'Neon Dust', base: 210, unit: 'gram', color: 0xff2e88, blurb: 'Club powder that leaves a fluorescent fingerprint.' },
  { id: 'ghostchips', name: 'Ghost Chips', base: 540, unit: 'chip', color: 0x9d4dff, blurb: 'Hot memory wafers scrubbed of their corporate serials.' },
  { id: 'synthglands', name: 'Synth Glands', base: 1250, unit: 'case', color: 0x39ff6a, blurb: 'Wetware harvested from discontinued medical androids.' },
  { id: 'blackice', name: 'Black ICE', base: 3100, unit: 'shard', color: 0xff3b5c, blurb: 'Weaponized intrusion code in a single-use crystal.' },
  { id: 'sunblood', name: 'Sunblood', base: 7200, unit: 'ampoule', color: 0xffc400, blurb: 'Designer immortality serum. Mostly designer.' },
]

export const SYNDICATE_LEADERS = [
  {gang:'SHINOBI' as Gang,name:'SLADE',color:0x399fa4,body:0x334e59,chassis:'hovercedes',bio:'SHINOBI leader. Quiet deals, sharp exits.'},
  {gang:'LIARS' as Gang,name:'WHITE LIE',color:0xd3d3c5,body:0x737b7e,chassis:'neonic',bio:'LIARS leader. Nothing he sells comes with the whole story.'},
  {gang:'HYENAS' as Gang,name:'FASA',color:0xb69265,body:0x685342,chassis:'z150',bio:'HYENAS leader. Salvage, muscle and street leverage.'},
  {gang:'JESTERS' as Gang,name:'FRECKLES',color:0xa34d7f,body:0x57384c,chassis:'hoverarrari',bio:'JESTERS leader. She is the clown with the keys to the market.'},
]
const MARKET_MS = 150_000

function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rand(text: string) {
  let x = hash(text) || 1
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return (x >>> 0) / 4294967296
}

function makeHoloMaterial(hex: number, opacity: number) {
  const mat = new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
  mat.userData.uTime = { value: 0 }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = mat.userData.uTime
    shader.vertexShader = `varying vec3 vHoloPos;\n` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvHoloPos = position;',
    )
    shader.fragmentShader = `uniform float uTime;\nvarying vec3 vHoloPos;\n` + shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      float scan = 0.62 + 0.38 * sin(vHoloPos.y * 18.0 - uTime * 11.0);
      float band = step(0.14, fract(sin(floor(vHoloPos.y * 2.2 - uTime * 3.5) * 43758.5453)));
      float flicker = 0.84 + 0.16 * sin(uTime * 23.0 + vHoloPos.x * 3.0);
      float fade = clamp(1.0 - (vHoloPos.y / 38.0), 0.12, 1.0);
      gl_FragColor.a *= scan * (0.45 + 0.55 * band) * flicker * fade;
      #include <dithering_fragment>
      `,
    )
  }
  return mat
}

function dealerCar(dealer: Dealer, index: number) {
  const leader=SYNDICATE_LEADERS[index]
  const car=buildVehicleMesh({...vehicleById(leader.chassis),body:leader.body,glow:leader.color})
  car.name=`dealer-car-${dealer.gang}`
  car.position.set(dealer.x,dealer.y+0.7,dealer.z)
  car.rotation.y=dealer.heading
  const flame=car.getObjectByName('flame');if(flame)flame.visible=false
  const pad=car.getObjectByName('pad') as THREE.Mesh|undefined
  if(pad){
    pad.visible=true
    const pm=pad.material as THREE.MeshBasicMaterial
    pm.opacity=0.36
  }
  const holo=new THREE.Group()
  holo.name='dealer-holo'
  const beamMat=makeHoloMaterial(dealer.color,0.28)
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(1.1,2.2,34,12,1,true),beamMat)
  beam.position.y=17.5
  beam.name='holo-beam'
  const ringMat=new THREE.MeshBasicMaterial({color:dealer.color,wireframe:true,transparent:true,opacity:0.75,blending:THREE.AdditiveBlending,depthWrite:false})
  const ring=new THREE.Mesh(new THREE.TorusGeometry(2.8,0.12,6,16),ringMat)
  ring.rotation.x=Math.PI/2
  ring.position.y=3.2
  ring.name='holo-ring'
  const prism=new THREE.Mesh(new THREE.OctahedronGeometry(1.35,0),ringMat)
  prism.position.y=6.2
  prism.name='holo-prism'
  holo.add(beam,ring,prism)
  car.add(holo)
  return car
}

/** Four syndicate leaders trade from parked vehicles; no kiosks or sign textures. */
export class DealerSystem {
  group = new THREE.Group()
  dealers: Dealer[] = []
  private world: World
  private time = 0

  constructor(world: World) {
    this.world = world
    this.placeDealers()
  }

  private centerX=0
  private centerZ=0
  refresh(x=0,z=0) {
    this.centerX=x;this.centerZ=z
    this.placeDealers()
    this.syncHeights()
  }

  syncHeights() {
    for (const dealer of this.dealers) {
      const ground = this.world.groundHeightAt(dealer.x, dealer.z, dealer.y + 1.3)
      if (Number.isFinite(ground)) dealer.y = ground
      const car = this.group.getObjectByName(`dealer-car-${dealer.gang}`)
      if (car) {
        car.position.set(dealer.x, dealer.y + 0.7, dealer.z)
        car.visible = true
      }
    }
  }

  update(dt: number) {
    this.time += dt
    for (const dealer of this.dealers) {
      const car = this.group.getObjectByName(`dealer-car-${dealer.gang}`)
      if (!car) continue
      const ground = this.world.groundHeightAt(dealer.x, dealer.z, dealer.y + 1.3)
      if (Number.isFinite(ground)) {
        dealer.y = ground
        car.position.y = dealer.y + 0.7
      }
      const beam = car.getObjectByName('holo-beam') as THREE.Mesh | undefined
      if (beam) {
        const mat = beam.material as THREE.MeshBasicMaterial
        if (mat.userData.uTime) mat.userData.uTime.value = this.time
      }
      const ring = car.getObjectByName('holo-ring')
      if (ring) ring.rotation.z = this.time * 1.4
      const prism = car.getObjectByName('holo-prism')
      if (prism) {
        prism.rotation.y = -this.time * 1.8
        prism.position.y = 6.2 + Math.sin(this.time * 2.6 + dealer.x * 0.01) * 0.45
      }
    }
  }

  private placeDealers() {
    const city = this.world.city
    const missing=SYNDICATE_LEADERS.map((leader,index)=>({leader,index})).filter(({leader})=>!this.dealers.some(d=>d.gang===leader.gang && Math.hypot(d.x-this.centerX,d.z-this.centerZ)<9000))
    if(!missing.length)return
    const candidates = city.nodes.map((node,i)=>({node,i}))
      .filter(({node,i})=>node.adj.length>0 && Math.hypot(node.x-this.centerX,node.z-this.centerZ)<3800 && !node.tunnel && Math.abs((node.y??0)-(this.world.city.terrain?.heightAt(node.x,node.z)??0))<0.5 &&
        !this.dealers.some(d=>d.node===i) && this.world.eligibleAt(node.x,node.z))
      .sort((a,b)=>Math.hypot(a.node.x,a.node.z)-Math.hypot(b.node.x,b.node.z) || hash(`${city.key}:${a.i}`)-hash(`${city.key}:${b.i}`))
    for(const {leader,index} of missing) {
      const angle=index*Math.PI/2+Math.PI/4
      const tx=this.centerX+Math.cos(angle)*1650,tz=this.centerZ+Math.sin(angle)*1650
      candidates.sort((a,b)=>Math.hypot(a.node.x-tx,a.node.z-tz)-Math.hypot(b.node.x-tx,b.node.z-tz))
      let parked: {node:typeof city.nodes[number];i:number;x:number;z:number;heading:number}|undefined
      // Try every candidate before giving up; one blocked parking spot must not lose a leader.
      for(const spacing of [1600,1100,650,320]) {
        for(const {node,i} of candidates) {
          if(spacing===1600 && ((node.x-this.centerX)*Math.cos(angle)<0 || (node.z-this.centerZ)*Math.sin(angle)<0))continue
          if(this.dealers.some(d=>d.gang!==leader.gang && (d.node===i || Math.hypot(d.x-node.x,d.z-node.z)<spacing)))continue
          const adjacent=city.nodes[node.adj[0]]
          const heading=Math.atan2(adjacent.x-node.x,adjacent.z-node.z)
          const offset=(node.width??5)/2+1.6
          for(const side of [1,-1]) {
            const x=node.x+Math.cos(heading)*offset*side,z=node.z-Math.sin(heading)*offset*side
            if(this.dealers.some(d=>d.gang!==leader.gang && Math.hypot(d.x-x,d.z-z)<spacing))continue
            if(this.world.isWater(x,z) || !this.world.eligibleAt(x,z))continue
            // Check the parked car envelope, not just its centre.
            const spec=vehicleById(leader.chassis),halfL=spec.kind==='truck'?3.2:2.1
            const clear=[-halfL,0,halfL].every(l=>[-1,0,1].every(w=>
              this.world.hitBuilding(x+Math.sin(heading)*l+Math.cos(heading)*w,z+Math.cos(heading)*l-Math.sin(heading)*w,(city.terrain?.heightAt(x,z)??0)+1)<0))
            if(clear){parked={node,i,x,z,heading};break}
          }
          if(parked)break
        }
        if(parked)break
      }
      if(!parked)continue
      const {node,i,x,z,heading}=parked
      const specialty = CONTRABAND[(index + hash(city.key)) % CONTRABAND.length]
      const baseH = city.terrain?.heightAt(x,z)??node.y??0
      const groundH = this.world.groundHeightAt(x,z,baseH+1.3)
      const dealer: Dealer = {
        id: `${city.key}:dealer:${index}`,
        name: leader.name,
        gang: leader.gang,
        bio: leader.bio,
        heading,
        y: Number.isFinite(groundH) ? groundH : baseH,
        node: i,
        x,
        z,
        specialty: specialty.id,
        color: leader.color,
      }
      const previous=this.dealers.findIndex(d=>d.gang===leader.gang)
      if(previous<0){this.dealers.push(dealer);this.group.add(dealerCar(dealer,index))}
      else {
        this.dealers[previous]=dealer
        const car=this.group.getObjectByName(`dealer-car-${dealer.gang}`)!
        car.position.set(dealer.x,dealer.y+0.7,dealer.z);car.rotation.y=dealer.heading
      }
    }
  }

  get epoch() {
    return Math.floor(Date.now() / MARKET_MS)
  }

  timeRemaining() {
    return Math.ceil((MARKET_MS - (Date.now() % MARKET_MS)) / 1000)
  }

  quote(dealer: Dealer, good: Contraband): Quote {
    const key = `${this.world.city.key}:${dealer.id}:${good.id}:${this.epoch}`
    const local = 0.58 + rand(`${key}:local`) * 1.08
    const specialty = dealer.specialty === good.id ? 0.72 : 1
    const event = this.event(dealer)
    const shock = event?.good.id === good.id ? (event.kind === 'shortage' ? 2.35 : 0.42) : 1
    const ask = Math.max(5, Math.round(good.base * local * specialty * shock / 5) * 5)
    const bid = Math.max(1, Math.round(ask * (0.68 + rand(`${key}:spread`) * 0.1) / 5) * 5)
    return { ask, bid }
  }

  event(dealer: Dealer): MarketEvent | null {
    const key = `${this.world.city.key}:${dealer.id}:${this.epoch}:event`
    if (rand(key) > 0.34) return null
    const good = CONTRABAND[Math.floor(rand(`${key}:good`) * CONTRABAND.length)]
    const kind = rand(`${key}:kind`) > 0.5 ? 'shortage' : 'glut'
    return {
      good,
      kind,
      headline: kind === 'shortage'
        ? `${good.name} supply got intercepted. Prices are radioactive.`
        : `A cargo drone spilled ${good.name} across the district. Buyers are spoiled.`,
    }
  }

  nearest(x: number, z: number) {
    let dealer: Dealer | null = null, dist = Infinity
    for (const candidate of this.dealers) {
      const d = Math.hypot(candidate.x - x, candidate.z - z)
      if (d < dist) {
        dealer = candidate
        dist = d
      }
    }
    return { dealer, dist }
  }

  dispose() {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const materials = mesh.material
      if (Array.isArray(materials)) materials.forEach((material) => material.dispose())
      else {
        const material = materials as THREE.MeshBasicMaterial | undefined
        material?.map?.dispose()
        material?.dispose()
      }
    })
  }
}
