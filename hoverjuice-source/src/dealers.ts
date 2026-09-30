import * as THREE from 'three'
import type { World } from './world'

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

const DEALER_NAMES = ['Auntie Voltage', 'Mister Glass', 'Zero Cool', 'Dr. Mantis', 'Velvet Hex', 'Saint Static']
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

function signTexture(name: string, color: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 150
  const g = canvas.getContext('2d')!
  const hex = `#${color.toString(16).padStart(6, '0')}`
  g.fillStyle = 'rgba(4,2,12,.94)'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.strokeStyle = hex
  g.lineWidth = 8
  g.shadowColor = hex
  g.shadowBlur = 18
  g.strokeRect(8, 8, 496, 134)
  g.font = '900 54px Orbitron, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#fff'
  g.fillText(name.toUpperCase(), 256, 62)
  g.font = '700 24px Rajdhani, sans-serif'
  g.fillStyle = hex
  g.fillText('NIGHT MARKET', 256, 112)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function dealerStall(dealer: Dealer) {
  const group = new THREE.Group()
  group.position.set(dealer.x, 0, dealer.z)
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a0714, metalness: 0.75, roughness: 0.3 })
  const glow = new THREE.MeshBasicMaterial({ color: dealer.color })
  const kiosk = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.6, 2.2), dark)
  kiosk.position.y = 1.3
  group.add(kiosk)
  const counter = new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.22, 1), glow)
  counter.position.set(0, 1.35, 1.25)
  group.add(counter)
  for (const x of [-2.35, 2.35]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.2, 8), glow)
    post.position.set(x, 3.2, 0)
    group.add(post)
  }
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.16, 3.4), dark)
  canopy.position.y = 5.2
  group.add(canopy)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(6.5, 0.18, 8, 48),
    new THREE.MeshBasicMaterial({ color: dealer.color, transparent: true, opacity: 0.65 }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.25
  ring.name = 'dealer-ring'
  group.add(ring)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(dealer.name, dealer.color), transparent: true }))
  sprite.scale.set(8.5, 2.5, 1)
  sprite.position.y = 6.5
  group.add(sprite)
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 80, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: dealer.color, transparent: true, opacity: 0.08, depthWrite: false }),
  )
  beacon.position.y = 40
  group.add(beacon)
  return group
}

/** Six deterministic physical dealers plus stable, time-sliced local market prices. */
export class DealerSystem {
  group = new THREE.Group()
  dealers: Dealer[] = []
  private world: World
  private time = 0

  constructor(world: World) {
    this.world = world
    this.placeDealers()
  }

  private placeDealers() {
    const city = this.world.city
    const candidates = city.nodes
      .map((node, i) => ({ node, i }))
      .filter(({ node }) => node.main && node.adj.length > 1 && Math.hypot(node.x, node.z) > 120)
      .sort((a, b) => hash(`${city.key}:${a.i}`) - hash(`${city.key}:${b.i}`))
    const chosen: typeof candidates = []
    while (chosen.length < 6 && candidates.length) {
      let best = candidates[0], bestDistance = -1
      for (const candidate of candidates.slice(0, 600)) {
        const spacing = chosen.length
          ? Math.min(...chosen.map((other) => Math.hypot(candidate.node.x - other.node.x, candidate.node.z - other.node.z)))
          : Math.hypot(candidate.node.x, candidate.node.z)
        if (spacing > bestDistance) {
          best = candidate
          bestDistance = spacing
        }
      }
      chosen.push(best)
      const index = candidates.indexOf(best)
      candidates.splice(index, 1)
    }
    chosen.forEach(({ node, i }, index) => {
      const specialty = CONTRABAND[(index + hash(city.key)) % CONTRABAND.length]
      const adjacent = city.nodes[node.adj[0]]
      const length = adjacent ? Math.hypot(adjacent.x - node.x, adjacent.z - node.z) || 1 : 1
      const sideX = adjacent ? (adjacent.z - node.z) / length * 10 : 0
      const sideZ = adjacent ? -(adjacent.x - node.x) / length * 10 : 0
      const dealer: Dealer = {
        id: `${city.key}:dealer:${index}`,
        name: DEALER_NAMES[index],
        node: i,
        x: node.x + sideX,
        z: node.z + sideZ,
        specialty: specialty.id,
        color: specialty.color,
      }
      this.dealers.push(dealer)
      this.group.add(dealerStall(dealer))
    })
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

  update(dt: number) {
    this.time += dt
    this.group.children.forEach((stall, i) => {
      const ring = stall.getObjectByName('dealer-ring')
      if (ring) {
        ring.rotation.z += dt * (0.45 + i * 0.04)
        const scale = 1 + Math.sin(this.time * 2.2 + i) * 0.05
        ring.scale.setScalar(scale)
      }
    })
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
