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

function dealerCar(dealer: Dealer, index: number) {
  const leader=SYNDICATE_LEADERS[index]
  const car=buildVehicleMesh({...vehicleById(leader.chassis),body:leader.body,glow:leader.color})
  car.name=`dealer-car-${dealer.gang}`
  car.position.set(dealer.x,dealer.y+0.7,dealer.z)
  car.rotation.y=dealer.heading
  const flame=car.getObjectByName('flame');if(flame)flame.visible=false
  const pad=car.getObjectByName('pad');if(pad)pad.visible=false
  return car
}

/** Four syndicate leaders trade from parked vehicles; no kiosks or sign textures. */
export class DealerSystem {
  group = new THREE.Group()
  dealers: Dealer[] = []
  private world: World

  constructor(world: World) {
    this.world = world
    this.placeDealers()
  }

  private centerX=0
  private centerZ=0
  refresh(x=0,z=0) {
    this.centerX=x;this.centerZ=z
    this.placeDealers()
  }

  private placeDealers() {
    const city = this.world.city
    const missing=SYNDICATE_LEADERS.map((leader,index)=>({leader,index})).filter(({leader})=>!this.dealers.some(d=>d.gang===leader.gang && Math.hypot(d.x-this.centerX,d.z-this.centerZ)<2600))
    if(!missing.length)return
    const candidates = city.nodes.map((node,i)=>({node,i}))
      .filter(({node,i})=>node.adj.length>0 && Math.hypot(node.x-this.centerX,node.z-this.centerZ)<2300 && !node.tunnel && Math.abs(node.y??0)<0.5 &&
        !this.dealers.some(d=>d.node===i) && this.world.eligibleAt(node.x,node.z))
      .sort((a,b)=>Math.hypot(a.node.x,a.node.z)-Math.hypot(b.node.x,b.node.z) || hash(`${city.key}:${a.i}`)-hash(`${city.key}:${b.i}`))
    for(const {leader,index} of missing) {
      const angle=index*Math.PI/2+Math.PI/4
      const tx=this.centerX+Math.cos(angle)*1100,tz=this.centerZ+Math.sin(angle)*1100
      candidates.sort((a,b)=>Math.hypot(a.node.x-tx,a.node.z-tz)-Math.hypot(b.node.x-tx,b.node.z-tz))
      let parked: {node:typeof city.nodes[number];i:number;x:number;z:number;heading:number}|undefined
      // Try every candidate before giving up; one blocked parking spot must not lose a leader.
      for(const spacing of [750,450]) {
        for(const {node,i} of candidates) {
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
              this.world.hitBuilding(x+Math.sin(heading)*l+Math.cos(heading)*w,z+Math.cos(heading)*l-Math.sin(heading)*w,1)<0))
            if(clear){parked={node,i,x,z,heading};break}
          }
          if(parked)break
        }
        if(parked)break
      }
      if(!parked)continue
      const {node,i,x,z,heading}=parked
      const specialty = CONTRABAND[(index + hash(city.key)) % CONTRABAND.length]
      const dealer: Dealer = {
        id: `${city.key}:dealer:${index}`,
        name: leader.name,
        gang: leader.gang,
        bio: leader.bio,
        heading,
        y: node.y??0,
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
