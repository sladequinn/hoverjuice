import * as THREE from 'three'
import type { VehicleSpec } from './data'
import type { World } from './world'
import { buildCharacter, poseCharacter, setCharacterMask } from './character'

export interface Input {
  throttle: number
  brake: number
  steer: number
  boost: boolean
  up: boolean
  down: boolean
}

export type FlightMode = 'mag' | 'free'

const HOVER = 1.3
const SWAY_MAX = 3.2

function wedge(w: number, h: number, l: number, taper: number) {
  const g = new THREE.BoxGeometry(w, h, l, 1, 1, 4)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i)
    if (y > 0 && z > 0) p.setY(i, y - (z / (l / 2)) * h * taper)
  }
  g.computeVertexNormals()
  return g
}

export function buildVehicleMesh(spec: VehicleSpec, maskId = 'rooster') {
  const g = new THREE.Group()
  const body = new THREE.MeshStandardMaterial({ color: spec.body, metalness: 0.7, roughness: 0.3 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0d18, metalness: 0.4, roughness: 0.2 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a2a40, metalness: 0.9, roughness: 0.05, emissive: 0x06202a })
  const glow = new THREE.MeshBasicMaterial({ color: spec.glow })
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    g.add(m)
    return m
  }
  let halfW = 1, halfL = 2
  switch (spec.kind) {
    case 'board': {
      add(new THREE.BoxGeometry(0.75, 0.12, 2.1), body, 0, 0, 0)
      add(new THREE.BoxGeometry(0.8, 0.04, 2.15), glow, 0, -0.08, 0)
      const rider = buildCharacter(maskId)
      poseCharacter(rider, 0, 0)
      const u = rider.userData
      u.legL.rotation.set(-0.35, 0, 0.1)
      u.legR.rotation.set(0.25, 0, -0.1)
      u.armL.rotation.set(-0.2, 0, 0.9)
      u.armR.rotation.set(-0.2, 0, -0.9)
      rider.rotation.y = 0.9
      rider.position.y = 0.1
      rider.name = 'rider'
      g.add(rider)
      halfW = 0.4; halfL = 1
      break
    }
    case 'compact': {
      add(new THREE.BoxGeometry(1.8, 0.75, 3.6), body, 0, 0.4, 0)
      add(new THREE.BoxGeometry(1.5, 0.6, 1.7), glass, 0, 1.05, -0.2)
      add(new THREE.BoxGeometry(1.9, 0.08, 0.1), glow, 0, 0.55, 1.82)
      add(new THREE.BoxGeometry(1.9, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0xff1e3c }), 0, 0.55, -1.82)
      add(new THREE.BoxGeometry(0.3, 0.3, 0.3), dark, 0.6, 0.95, -1.5).rotation.z = 0.4
      halfW = 0.9; halfL = 1.8
      break
    }
    case 'truck': {
      add(new THREE.BoxGeometry(2.4, 1.7, 2.2), body, 0, 1.0, 2.4)
      add(new THREE.BoxGeometry(2.2, 0.7, 0.1), glass, 0, 1.4, 3.52)
      add(new THREE.BoxGeometry(2.6, 2.6, 5.2), dark, 0, 1.45, -1.4)
      add(new THREE.BoxGeometry(2.62, 0.12, 5.22), glow, 0, 2.2, -1.4)
      add(new THREE.BoxGeometry(2.62, 0.12, 5.22), glow, 0, 0.6, -1.4)
      add(new THREE.BoxGeometry(2.5, 0.1, 0.1), glow, 0, 0.5, 3.52)
      halfW = 1.3; halfL = 4
      break
    }
    case 'luxury': {
      add(wedge(2.0, 0.8, 5.0, 0.25), body, 0, 0.45, 0)
      add(new THREE.BoxGeometry(1.6, 0.55, 2.3), glass, 0, 1.1, -0.4)
      add(new THREE.BoxGeometry(1.2, 0.35, 0.08), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.1 }), 0, 0.55, 2.52)
      add(new THREE.BoxGeometry(2.05, 0.05, 4.6), glow, 0, 0.12, 0)
      add(new THREE.BoxGeometry(0.4, 0.07, 0.05), glow, 0.7, 0.62, 2.5)
      add(new THREE.BoxGeometry(0.4, 0.07, 0.05), glow, -0.7, 0.62, 2.5)
      halfW = 1; halfL = 2.5
      break
    }
    case 'super': {
      add(wedge(2.2, 0.75, 4.8, 0.7), body, 0, 0.4, 0)
      const canopy = add(wedge(1.2, 0.45, 1.8, 0.8), glass, 0, 0.95, -0.3)
      canopy.scale.set(1, 1, 1)
      add(new THREE.BoxGeometry(2.3, 0.1, 0.5), dark, 0, 1.0, -2.3)
      add(new THREE.BoxGeometry(0.1, 0.4, 0.1), dark, 0.8, 0.8, -2.3)
      add(new THREE.BoxGeometry(0.1, 0.4, 0.1), dark, -0.8, 0.8, -2.3)
      add(new THREE.BoxGeometry(2.25, 0.05, 4.4), glow, 0, 0.08, 0)
      add(new THREE.BoxGeometry(0.1, 0.05, 1.8), glow, 1.1, 0.45, 1.0).rotation.y = -0.2
      add(new THREE.BoxGeometry(0.1, 0.05, 1.8), glow, -1.1, 0.45, 1.0).rotation.y = 0.2
      add(new THREE.BoxGeometry(1.8, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0xff1e3c }), 0, 0.6, -2.42)
      halfW = 1.1; halfL = 2.4
      break
    }
  }
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: spec.glow, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  pad.rotation.x = -Math.PI / 2
  pad.scale.set(halfW * 1.6, halfL * 1.2, 1)
  pad.name = 'pad'
  g.add(pad)
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(halfW * 0.5, 3, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: spec.glow, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  flame.rotation.x = -Math.PI / 2
  flame.position.set(0, 0.5, -halfL - 1.5)
  flame.name = 'flame'
  flame.visible = false
  g.add(flame)
  g.userData.halfL = halfL
  return g
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export class Player {
  spec: VehicleSpec
  mesh: THREE.Group
  mask: string
  pos = new THREE.Vector3()
  vel = new THREE.Vector2()
  heading = 0
  speed = 0
  mode: FlightMode = 'mag'
  edgeA = 0
  edgeB = 0
  edgeS = 0
  nextNode = -1
  targetAlt = HOVER
  bank = 0
  boosting = false
  bump = 0
  lastBurn = 0
  /** lateral offset from the conduit centreline in Mag-Lock (metres, + is left) */
  sway = 0
  private swayV = 0
  private hopY = 0
  private hopV = 0
  private reverseLatch = false
  private lastHeading = 0

  constructor(spec: VehicleSpec, mask: string) {
    this.spec = spec
    this.mask = mask
    this.mesh = buildVehicleMesh(spec, mask)
  }

  setSpec(spec: VehicleSpec) {
    const parent = this.mesh.parent
    const riderVisible = this.mesh.getObjectByName('rider')?.visible ?? true
    parent?.remove(this.mesh)
    this.mesh = buildVehicleMesh(spec, this.mask)
    parent?.add(this.mesh)
    this.spec = spec
    this.showRider(riderVisible)
  }

  setMask(id: string) {
    this.mask = id
    const rider = this.mesh.getObjectByName('rider') as THREE.Group | undefined
    if (rider) setCharacterMask(rider, id)
  }

  showRider(v: boolean) {
    const rider = this.mesh.getObjectByName('rider')
    if (rider) rider.visible = v
  }

  get groundSpeed() {
    return this.mode === 'mag' ? Math.abs(this.speed) : this.vel.length()
  }

  get parked() {
    return this.groundSpeed < 3 && this.pos.y < 4
  }

  placeAtNode(world: World, node: number) {
    const n = world.city.nodes[node]
    const b = n.adj[0] ?? node
    this.edgeA = node
    this.edgeB = b
    this.edgeS = 0
    this.speed = 0
    this.sway = this.swayV = 0
    this.vel.set(0, 0)
    this.mode = 'mag'
    this.pos.set(n.x, HOVER, n.z)
    const m = world.city.nodes[b]
    this.heading = Math.atan2(m.x - n.x, m.z - n.z)
    this.targetAlt = HOVER
  }

  /** Snap onto the closest conduit segment. Returns false if none is close enough. */
  snap(world: World, range = 45) {
    const nodes = world.city.nodes
    let best = -1, bestB = -1, bd = range, bt = 0
    const px = this.pos.x, pz = this.pos.z
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      if (Math.abs(a.x - px) > 400 || Math.abs(a.z - pz) > 400) continue
      for (const j of a.adj) {
        if (j < i) continue
        const b = nodes[j]
        const dx = b.x - a.x, dz = b.z - a.z
        const l2 = dx * dx + dz * dz || 1
        const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2))
        const d = Math.hypot(a.x + dx * t - px, a.z + dz * t - pz)
        if (d < bd) { bd = d; best = i; bestB = j; bt = t }
      }
    }
    if (best < 0) return false
    const a = nodes[best], b = nodes[bestB]
    const dir = Math.atan2(b.x - a.x, b.z - a.z)
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const fwd = Math.abs(wrap(dir - this.heading)) < Math.PI / 2
    if (fwd) { this.edgeA = best; this.edgeB = bestB; this.edgeS = bt * len }
    else { this.edgeA = bestB; this.edgeB = best; this.edgeS = (1 - bt) * len }
    this.speed = Math.max(0, this.vel.length() * Math.cos(wrap(dir - this.heading)) * (fwd ? 1 : -1))
    const cx = a.x + (b.x - a.x) * bt, cz = a.z + (b.z - a.z) * bt
    const h = fwd ? dir : dir + Math.PI
    const side = (this.pos.x - cx) * Math.cos(h) - (this.pos.z - cz) * Math.sin(h)
    this.sway = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, side))
    this.swayV = 0
    this.mode = 'mag'
    return true
  }

  /** Leave the conduit. Returns true if the exit was fast enough to slingshot. */
  unsnap() {
    this.mode = 'free'
    const sling = this.speed > 12
    const v = this.speed * (sling ? 1.25 : 1)
    this.vel.set(Math.sin(this.heading) * v, Math.cos(this.heading) * v)
    this.vel.x += Math.cos(this.heading) * this.swayV
    this.vel.y -= Math.sin(this.heading) * this.swayV
    this.targetAlt = Math.max(this.pos.y, HOVER)
    this.hopY = this.hopV = 0
    return sling
  }

  private chooseNext(world: World, steer: number) {
    const nodes = world.city.nodes
    const a = nodes[this.edgeA], b = nodes[this.edgeB]
    const inAng = Math.atan2(b.x - a.x, b.z - a.z)
    const opts = b.adj.filter((c) => c !== this.edgeA)
    if (!opts.length) return this.edgeA
    let best = opts[0], bestScore = -Infinity
    for (const c of opts) {
      const n = nodes[c]
      const rel = wrap(Math.atan2(n.x - b.x, n.z - b.z) - inAng)
      const score = steer > 0.3 ? rel : steer < -0.3 ? -rel : -Math.abs(rel)
      if (score > bestScore) { bestScore = score; best = c }
    }
    return best
  }

  /** Returns a descriptor for the upcoming junction turn: -1 right, 0 straight, 1 left, 2 dead end. */
  nextTurn(world: World) {
    const nodes = world.city.nodes
    const b = nodes[this.edgeB]
    if (this.nextNode < 0) return { dir: 0, junction: false }
    if (this.nextNode === this.edgeA) return { dir: 2, junction: false }
    const a = nodes[this.edgeA], c = nodes[this.nextNode]
    const rel = wrap(Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z))
    return { dir: rel > 0.45 ? 1 : rel < -0.45 ? -1 : 0, junction: b.adj.length > 2 }
  }

  update(dt: number, input: Input, world: World, hasJuice: boolean) {
    const s = this.spec
    const power = hasJuice ? 1 : 0.4
    const cap = hasJuice ? 1 : 0.45
    this.boosting = false
    let burn = 0.02

    if (this.mode === 'mag') {
      const boost = input.boost && hasJuice && input.throttle > 0
      this.boosting = boost
      const top = s.maxSpeed * 1.1 * cap * (boost ? s.boost : 1)
      this.speed += input.throttle * s.accel * 1.1 * power * (boost ? s.boost * 1.4 : 1) * dt
      burn += input.throttle * (boost ? 2.2 : 0.7)
      if (input.brake === 0) this.reverseLatch = false
      if (input.brake > 0 && !this.reverseLatch) {
        if (this.speed > 0.6) this.speed -= s.accel * 1.8 * dt
        else {
          this.reverseLatch = true
          const t = this.edgeA
          this.edgeA = this.edgeB
          this.edgeB = t
          const na = world.city.nodes[this.edgeA], nb = world.city.nodes[this.edgeB]
          this.edgeS = Math.hypot(nb.x - na.x, nb.z - na.z) - this.edgeS
          this.speed = 0
          this.sway = -this.sway
          this.swayV = 0
        }
      }
      this.speed *= Math.pow(0.8, dt)
      if (this.speed > top) this.speed += (top - this.speed) * Math.min(1, dt * 2)
      this.speed = Math.max(this.speed, 0)
      this.nextNode = this.chooseNext(world, input.steer)
      let remaining = this.speed * dt
      const nodes = world.city.nodes
      for (let guard = 0; guard < 20; guard++) {
        const a = nodes[this.edgeA], b = nodes[this.edgeB]
        const len = Math.hypot(b.x - a.x, b.z - a.z)
        if (this.edgeS + remaining < len) { this.edgeS += remaining; break }
        remaining -= len - this.edgeS
        const next = this.chooseNext(world, input.steer)
        this.edgeA = this.edgeB
        this.edgeB = next
        this.edgeS = 0
      }
      const a = nodes[this.edgeA], b = nodes[this.edgeB]
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
      const t = this.edgeS / len
      const target = Math.atan2(b.x - a.x, b.z - a.z)
      const diff = wrap(target - this.heading)
      this.heading += diff * Math.min(1, dt * 7)
      const turnRate = wrap(this.heading - this.lastHeading) / Math.max(dt, 1e-4)
      this.lastHeading = this.heading

      // Elastic tether: steer pulls you across the conduit, corners fling you outward, the spring snaps you back.
      const pull = input.steer * SWAY_MAX * 0.85
      const acc = (pull - this.sway) * 26 - this.swayV * 4.2 - turnRate * this.speed * 0.55
      this.swayV += acc * dt
      this.sway += this.swayV * dt
      if (Math.abs(this.sway) > SWAY_MAX) {
        this.sway = Math.sign(this.sway) * SWAY_MAX
        if (Math.abs(this.swayV) > 6) this.bump = Math.min(1, this.bump + Math.abs(this.swayV) / 30)
        this.swayV *= -0.45
      }
      const lx = Math.cos(this.heading), lz = -Math.sin(this.heading)
      this.pos.x = a.x + (b.x - a.x) * t + lx * this.sway
      this.pos.z = a.z + (b.z - a.z) * t + lz * this.sway
      this.bank += (Math.max(-0.7, Math.min(0.7, -diff * 1.2 - this.swayV * 0.06)) - this.bank) * Math.min(1, dt * 8)

      if (input.up && this.hopY <= 0.01 && hasJuice) this.hopV = 8
      this.hopV -= 26 * dt
      this.hopY = Math.max(0, this.hopY + this.hopV * dt)
      if (this.hopY === 0) this.hopV = Math.max(0, this.hopV)
      const hoverY = (hasJuice ? HOVER : 0.55) + this.hopY + Math.sin(performance.now() / 300) * 0.05
      this.pos.y += (hoverY - this.pos.y) * Math.min(1, dt * (this.hopY > 0 ? 20 : 4))
      this.vel.set(Math.sin(this.heading) * this.speed, Math.cos(this.heading) * this.speed)
    } else {
      const spd = this.vel.length()
      const turnScale = 0.55 + 0.45 * Math.min(1, spd / 10)
      this.heading += input.steer * s.turn * turnScale * dt
      this.lastHeading = this.heading
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading)
      const boost = input.boost && hasJuice && input.throttle > 0
      this.boosting = boost
      const thrust = input.throttle * s.accel * power * (boost ? s.boost * 1.6 : 1)
      this.vel.x += fx * thrust * dt
      this.vel.y += fz * thrust * dt
      burn += input.throttle * (boost ? 2.6 : 1)
      let fwd = this.vel.x * fx + this.vel.y * fz
      let lat = this.vel.x * fz - this.vel.y * fx
      lat *= Math.pow(s.drift * 0.35, dt)
      fwd *= Math.pow(0.82, dt)
      if (input.brake > 0) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), s.accel * 1.6 * input.brake * dt)
      const top = s.maxSpeed * (boost ? s.boost : 1) * cap
      if (fwd > top) fwd += (top - fwd) * Math.min(1, dt * 2)
      if (fwd < -top * 0.3) fwd = -top * 0.3
      this.vel.set(fx * fwd + fz * lat, fz * fwd - fx * lat)
      this.bank += (Math.max(-0.6, Math.min(0.6, -input.steer * 0.35 - lat * 0.03)) - this.bank) * Math.min(1, dt * 5)

      if (hasJuice) {
        if (input.up) { this.targetAlt += 14 * dt; burn += 0.6 }
        if (input.down) this.targetAlt -= 18 * dt
      } else this.targetAlt -= 3 * dt
      this.targetAlt = Math.max(HOVER, Math.min(this.targetAlt, s.maxAlt))

      const nx = this.pos.x + this.vel.x * dt
      const nz = this.pos.z + this.vel.y * dt
      const hit = world.hitBuilding(nx, nz, this.pos.y - 0.5)
      if (hit >= 0) {
        const hx = world.hitBuilding(nx, this.pos.z, this.pos.y - 0.5) >= 0
        const hz = world.hitBuilding(this.pos.x, nz, this.pos.y - 0.5) >= 0
        if (!hx) { this.pos.x = nx; this.vel.y *= -0.25; this.vel.x *= 0.7 }
        else if (!hz) { this.pos.z = nz; this.vel.x *= -0.25; this.vel.y *= 0.7 }
        else this.vel.multiplyScalar(-0.3)
        this.bump = Math.min(1, this.bump + spd / 25)
      } else {
        this.pos.x = nx
        this.pos.z = nz
      }
      const lim = world.city.radius * 1.25
      const r = Math.hypot(this.pos.x, this.pos.z)
      if (r > lim) {
        this.pos.x *= lim / r
        this.pos.z *= lim / r
        this.vel.multiplyScalar(0.5)
      }
      const floor = world.groundHeightAt(this.pos.x, this.pos.z, this.pos.y) + HOVER
      const y = Math.max(this.targetAlt, floor) + Math.sin(performance.now() / 300) * 0.06
      this.pos.y += (y - this.pos.y) * Math.min(1, dt * 3)
      this.speed = this.vel.length()
      this.nextNode = -1
    }

    this.bump = Math.max(0, this.bump - dt * 2)
    this.lastBurn = burn
    this.mesh.position.copy(this.pos)
    this.mesh.rotation.set(0, this.heading, 0)
    this.mesh.rotateZ(this.bank)
    this.mesh.rotateX(-Math.min(0.12, input.throttle * 0.08) + (this.bump > 0 ? Math.sin(performance.now() / 30) * this.bump * 0.1 : 0))
    const flame = this.mesh.getObjectByName('flame')
    if (flame) {
      flame.visible = this.boosting
      flame.scale.setScalar(0.8 + Math.random() * 0.5)
    }
    const pad = this.mesh.getObjectByName('pad') as THREE.Mesh | undefined
    if (pad) {
      pad.position.y = -this.pos.y + 0.15
      ;(pad.material as THREE.MeshBasicMaterial).opacity = (hasJuice ? 0.14 + Math.random() * 0.05 : 0.04) * (this.spec.kind === 'board' ? 0.5 : 1)
    }
  }
}
